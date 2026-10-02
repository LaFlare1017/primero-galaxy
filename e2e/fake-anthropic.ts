import { createServer, type Server } from 'http';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve as resolvePath } from 'path';

/**
 * An Anthropic-compatible endpoint that answers from a recorded transcript.
 *
 * Why this exists, and why it is not simply "the mock agent": the cold-process
 * chat spec exists to prove that a restarted server recovered a conversation
 * from the store rather than answering from its own prompt. The workshop's mock
 * agent answers from the message text, so it would satisfy that assertion with
 * no history in it at all — which is why the spec was behind `ANTHROPIC_API_KEY`
 * and skipped everywhere else. That left the single most valuable assertion in
 * the suite running on whatever machines happened to have a key, which is none
 * of CI's.
 *
 * This is the seam the agent already has: `AnthropicProvider` reads
 * `ANTHROPIC_BASE_URL` and POSTs to `${baseUrl}/v1/messages`. Point that at a
 * server like this one and the spec exercises the real provider, the real
 * request shape and the real tool loop — everything except the model's
 * judgement.
 *
 * And the transcript is MATCHED AGAINST THE REQUEST, not handed out in order.
 * That is the whole trick, and it is what keeps the assertion worth anything: a
 * sequential fixture answers the cold turn identically whether the transcript
 * arrived or was lost, so the spec would pass in the case it exists to catch.
 * Here, the answer that carries the word "reconcile" is served only when the
 * first turn's text is present in the request — which is only true if the
 * restarted process read it back out of the store. Lose the history and the
 * fallback turn answers instead, saying exactly that it has nothing, and the
 * spec fails on the thing it was written for.
 *
 * The same design is why `when` is matched against the LAST PLAIN-STRING user
 * message rather than anywhere in the body: after a tool call the body also
 * contains the tool results and the whole prior transcript, so a loose match
 * would serve every turn from the first entry.
 */

export interface TranscriptHop {
  content: unknown[];
  stop_reason: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface TranscriptTurn {
  id: string;
  when: string;
  /** When set, this string must appear somewhere in the request body. */
  requires?: string;
  hops: TranscriptHop[];
}

export interface Transcript {
  turns: TranscriptTurn[];
}

/** The transcript the cold-chat spec replays, loaded from the repo. */
export function loadTranscript(file: string): Transcript {
  return JSON.parse(readFileSync(file, 'utf8')) as Transcript;
}

/**
 * The last user message that is a plain string — i.e. the question a person
 * actually asked, as opposed to the tool-result array the agent appends after a
 * tool call. This is what a turn is matched on.
 */
function lastUserText(body: { messages?: Array<{ role: string; content: unknown }> }): string {
  const messages = body.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user' && typeof message.content === 'string') return message.content;
  }
  return '';
}

export interface FakeAnthropic {
  /** The base to hand the agent as `ANTHROPIC_BASE_URL`. */
  url: string;
  /** Every request the agent made, so a check can assert what it was actually sent. */
  requests: Array<{ asked: string; serialized: string; turnId: string }>;
  /** Which turn each request was served from, in order. */
  served: string[];
  /** Where the candidate was written, when this run was recording. `null` otherwise. */
  recorded: () => string | null;
  close: () => Promise<void>;
}

/**
 * Stand up the endpoint. Returns its URL and a record of what it was asked, so
 * a spec can say not only that the answer was right but that it was the answer
 * this transcript gives only when the history is there.
 *
 * With `RECORD_TRANSCRIPT` set it stops being the model's answer and becomes a
 * PASSTHROUGH: every request is forwarded to the real Anthropic API and the
 * exchange is recorded, so the run exercises a real model and leaves behind a
 * candidate fixture shaped like the one this file replays. That is the only way
 * to get the expensive half of a fixture — the real tool calls and the real
 * answer text — without typing them, and the half that cannot be typed is the
 * `requires` clause, which is why the recording derives it and admits when it
 * could not.
 */
export async function startFakeAnthropic(
  transcript: Transcript,
  { root, env = process.env }: { root?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<FakeAnthropic> {
  const requests: FakeAnthropic['requests'] = [];
  const served: string[] = [];
  const recordedHops: RecordedHop[] = [];
  const recording = recordingRequested(env);
  // Refused HERE rather than at the first request, so a recording run cannot
  // spend a real key and only then discover it has nowhere safe to write.
  const destination = recording && root !== undefined ? candidatePath(root, env) : null;
  if (recording && destination === null) {
    throw new Error(
      'RECORD_TRANSCRIPT is set but this fake was started without a `root`, so the committed fixture cannot be ' +
        'identified and a candidate cannot be written somewhere it is safe. Pass the repository root.',
    );
  }
  if (recording && (env.ANTHROPIC_API_KEY ?? '').trim() === '') {
    throw new Error(
      'RECORD_TRANSCRIPT is set but ANTHROPIC_API_KEY is not. Recording forwards to the real API, so without a ' +
        'key there is nothing to record and the run would write an empty fixture that reads like a real one.',
    );
  }
  const upstream = (env.ANTHROPIC_UPSTREAM_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const upstreamKey = env.ANTHROPIC_API_KEY ?? '';
  let wrote: string | null = null;
  // One cursor per turn: a turn that calls a tool takes two hops, and the
  // second hop has to come from the same turn as the first.
  const cursors = new Map<string, number>();

  /**
   * One request to the real API, recorded on the way back.
   *
   * Only a SUCCESSFUL response is recorded. An error from the real API is a
   * fact about the key or the quota rather than a turn somebody asked for, and
   * recording one would put a 429 into a fixture that then replays it as though
   * the model had said it — which is the kind of thing that reads as coverage
   * until the day it is not.
   */
  const forward = async (asked: string, serialized: string, path: string) => {
    const response = await fetch(`${upstream}${path}`, {
      method: 'POST',
      headers: {
        'x-api-key': upstreamKey,
        'anthropic-version': env.ANTHROPIC_VERSION ?? '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: serialized,
    });
    const text = await response.text();
    if (response.ok) {
      let parsed: { content?: unknown; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } } = {};
      try {
        parsed = text ? (JSON.parse(text) as typeof parsed) : {};
      } catch {
        parsed = {};
      }
      if (Array.isArray(parsed.content)) {
        recordedHops.push({
          when: asked,
          body: serialized,
          content: parsed.content,
          stop_reason: parsed.stop_reason ?? 'end_turn',
          ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
        });
      }
    }
    return { status: response.status, text };
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      // The upstream's body verbatim, because a passthrough that re-serialises
      // it is not a passthrough: an error from the real API carries a shape the
      // provider is written to read, and rewriting it would change what the run
      // is able to notice.
      const sendRaw = (status: number, text: string) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(text);
      };

      if (!req.url?.endsWith('/v1/messages')) {
        send(404, { error: { message: `no route for ${req.method} ${req.url}` } });
        return;
      }

      let body: { messages?: Array<{ role: string; content: unknown }> };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        send(400, { error: { message: 'the request body was not JSON' } });
        return;
      }

      const asked = lastUserText(body);
      const serialized = JSON.stringify(body);
      requests.push({ asked, serialized, turnId: '' });

      // ── recording: forward to the real API, and watch both sides ────────
      //
      // Ahead of the transcript, because in this mode the transcript is not the
      // answer — a real model's is. Serving the recorded turns here would record
      // a conversation with ourselves and call it a candidate.
      if (recording) {
        void forward(asked, serialized, req.url ?? '/v1/messages')
          .then((upstream_) => sendRaw(upstream_.status, upstream_.text))
          .catch((error: Error) =>
            send(502, {
              error: {
                message:
                  `recording could not reach the real API at ${upstream}: ${error.message} — ` +
                  'nothing was recorded, and no candidate was written',
              },
            }),
          );
        return;
      }

      const turn = transcript.turns.find(
        (candidate) =>
          asked.includes(candidate.when) &&
          (candidate.requires === undefined || serialized.includes(candidate.requires)),
      );
      if (!turn) {
        // Loud rather than a default answer: a request nothing matches means the
        // agent sent something the transcript was not written for, and a
        // fallback reply here would hide that behind a passing spec.
        send(409, {
          error: {
            message: `no transcript turn matches a turn beginning "${asked.slice(0, 80)}" — add one, or fix the question the spec asks`,
          },
        });
        return;
      }

      const cursor = cursors.get(turn.id) ?? 0;
      const hop = turn.hops[Math.min(cursor, turn.hops.length - 1)];
      cursors.set(turn.id, cursor + 1);
      requests[requests.length - 1].turnId = turn.id;
      served.push(turn.id);
      send(200, {
        id: `msg_fx_${turn.id}_${cursor}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: hop.content,
        stop_reason: hop.stop_reason,
        usage: hop.usage ?? { input_tokens: 100, output_tokens: 20 },
      });
    });
  });

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the OS handed back no TCP port for the fake Anthropic endpoint');
  }

  return {
    // Loopback, so the spawned Next servers can reach it as readily as this
    // process can.
    url: `http://127.0.0.1:${address.port}`,
    requests,
    served,
    recorded: () => wrote,
    /**
     * Stop answering, and — when recording — write the candidate FIRST.
     *
     * A recording run that recorded nothing writes nothing rather than an empty
     * fixture: a file of zero turns is indistinguishable from a legitimate one
     * to whatever reads it next, and the whole point of writing one is that a
     * person reads it.
     */
    close: async () => {
      if (destination !== null && recordedHops.length > 0) {
        const { turns, unproven } = turnsFrom(recordedHops);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, candidateTranscript(turns, unproven, new Date().toISOString()));
        wrote = destination;
      }
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/** The transcript this spec uses, resolved against the repo root. */
export function coldChatTranscriptPath(root: string): string {
  return join(root, 'e2e', 'fixtures', 'cold-chat-transcript.json');
}

// ───────────────────────────── recording ──────────────────────────────────────

/**
 * The file that must never be written by a recording run.
 *
 * Named here rather than derived, because the refusal below compares against
 * it: a recorder that is one path from being able to overwrite the fixture the
 * whole cold-chat spec rests on is a recorder nobody should point at a
 * transcript directory without a second thought, and the second thought is
 * exactly what this makes unnecessary.
 */
const COMMITTED_NAME = 'cold-chat-transcript.json';

/** Where a recording goes when nobody says otherwise: beside it, and obviously not it. */
export const DEFAULT_CANDIDATE_NAME = 'cold-chat-transcript.candidate.json';

/**
 * Whether this run is asked to record, and where.
 *
 * `RECORD_TRANSCRIPT=1` (or `true`, or `yes`) records to the default candidate
 * beside the committed fixture. Any other non-empty value is taken as the path
 * to record to, so a run can write somewhere outside the working tree without a
 * second variable — and a path is the escape hatch that makes the refusal
 * below worth having rather than a nuisance.
 *
 * `0`, `false`, `no` and empty all mean off. Anything unrecognised as a boolean
 * is a PATH, on purpose: guessing that a typo meant "on" would start sending
 * real requests and writing a file, which is not what a typo should do.
 */
export function recordingRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.RECORD_TRANSCRIPT ?? '').trim();
  if (raw === '') return false;
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
}

/** The candidate path for this run, resolved. Never the committed fixture. */
export function candidatePath(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.RECORD_TRANSCRIPT ?? '').trim();
  const named = raw !== '' && !['0', 'false', 'no', 'off', '1', 'true', 'yes', 'on'].includes(raw.toLowerCase())
    ? resolvePath(process.cwd(), raw)
    : join(root, 'e2e', 'fixtures', DEFAULT_CANDIDATE_NAME);
  return refuseCommitted(named, root);
}

/**
 * Refuse any destination that is the committed fixture, under any spelling.
 *
 * Two comparisons, because they catch different mistakes. The resolved paths
 * catch the obvious one — pointing the variable at the file. The BASENAME catches
 * the one nobody types on purpose: copying a candidate out of the fixtures
 * directory under the committed name, or writing into a checkout where the two
 * are different files and the names are the same.
 *
 * Throwing rather than warning, because the outcome of ignoring it is a fixture
 * that differs from the one every cold-chat run has been proving, with a diff
 * nobody asked for and a spec that keeps passing either way.
 */
function refuseCommitted(target: string, root: string): string {
  const committed = coldChatTranscriptPath(root);
  const why =
    basename(target) === COMMITTED_NAME
      ? `it is named ${COMMITTED_NAME}`
      : 'it is the committed fixture itself';
  if (resolvePath(target) === resolvePath(committed) || basename(target) === COMMITTED_NAME) {
    throw new Error(
      `refusing to record to ${target}: ${why}. Recording writes a CANDIDATE, which a person reads and promotes. ` +
        `Set RECORD_TRANSCRIPT to a different path, or leave it as 1 to write ${DEFAULT_CANDIDATE_NAME} instead.`,
    );
  }
  return target;
}

/** One recorded request/response pair, before it is grouped into a turn. */
interface RecordedHop {
  when: string;
  body: string;
  content: unknown[];
  stop_reason: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Group recorded hops into the turns a transcript is written in.
 *
 * A turn that calls a tool is SEVERAL requests carrying the same last plain
 * user message — the tool results arrive as a different message shape — so the
 * grouping key is that message and consecutive equal keys are one turn. That is
 * the same rule the matcher replays by, so a recording of a real run is shaped
 * like a fixture rather than like a log.
 *
 * `requires` is DERIVED where it can be, and that derivation is the point: for
 * any turn after the first, the earliest earlier question that appears anywhere
 * in this request's body is precisely the history that answer depends on, and
 * naming it is what stops a recorded turn from matching when the history is
 * missing — which is the whole property the fixture exists to have.
 *
 * A turn with NO earlier question in its body gets none, and is listed in
 * `$unproven` instead. That is not a nicety: a turn committed without a
 * `requires` answers whether or not the history came back, which is the one
 * thing this fixture must never do.
 */
export function turnsFrom(hops: RecordedHop[]): { turns: TranscriptTurn[]; unproven: string[] } {
  const turns: TranscriptTurn[] = [];
  const unproven: string[] = [];
  let index = 0;
  for (let i = 0; i < hops.length; i += 1) {
    if (i === 0 || hops[i].when !== hops[i - 1].when) index += 1;
    let turn = turns.find((candidate) => candidate.id === `turn-${index}`);
    if (turn === undefined) {
      turn = { id: `turn-${index}`, when: hops[i].when, hops: [] };
      turns.push(turn);
    }
    turn.hops.push({
      content: hops[i].content,
      stop_reason: hops[i].stop_reason,
      ...(hops[i].usage === undefined ? {} : { usage: hops[i].usage }),
    });
  }
  // Second pass, so every turn exists before any of them looks for history.
  for (const turn of turns) {
    const first = hops.find((hop) => hop.when === turn.when);
    const earlier = turns.find((candidate) => candidate.id < turn.id && first !== undefined && first.body.includes(candidate.when));
    if (earlier !== undefined) turn.requires = earlier.when;
    else if (turn.id !== 'turn-1') unproven.push(turn.id);
  }
  return { turns, unproven };
}

/** The candidate file's contents, with the notes a reader needs to promote it. */
export function candidateTranscript(turns: TranscriptTurn[], unproven: string[], recordedAt: string): string {
  const file = {
    $note:
      'A CANDIDATE, recorded from a live model. Nothing is committed by this file and the committed ' +
      `${COMMITTED_NAME} is never written by a recording run. Read it before promoting it: a recorded ` +
      'answer is a real one, but a recorded FIXTURE is only a fixture once somebody has read it.',
    $format: {
      turns:
        'Same shape as the committed transcript. `when` is the last plain-string user message and `requires`, ' +
        'where present, must appear in the request body for the turn to answer at all.',
      whyRequiresMatters:
        'A turn with no `requires` answers whether or not the restarted process recovered the conversation. ' +
        'That is what the cold-chat spec exists to rule out, so a turn below with none is the one to look at ' +
        'hardest — it is listed in $unproven.',
    },
    $unproven:
      unproven.length === 0
        ? []
        : [...unproven, 'these turns recorded no earlier question in their request body, so no `requires` could be derived.'],
    $recordedAt: recordedAt,
    turns,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}
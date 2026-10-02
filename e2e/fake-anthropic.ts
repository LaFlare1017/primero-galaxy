import { createServer, type Server } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';

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
  close: () => Promise<void>;
}

/**
 * Stand up the endpoint. Returns its URL and a record of what it was asked, so
 * a spec can say not only that the answer was right but that it was the answer
 * this transcript gives only when the history is there.
 */
export async function startFakeAnthropic(transcript: Transcript): Promise<FakeAnthropic> {
  const requests: FakeAnthropic['requests'] = [];
  const served: string[] = [];
  // One cursor per turn: a turn that calls a tool takes two hops, and the
  // second hop has to come from the same turn as the first.
  const cursors = new Map<string, number>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
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
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** The transcript this spec uses, resolved against the repo root. */
export function coldChatTranscriptPath(root: string): string {
  return join(root, 'e2e', 'fixtures', 'cold-chat-transcript.json');
}
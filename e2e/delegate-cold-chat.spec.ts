import { expect, test } from './worker-server';
import type { Page } from '@playwright/test';
import { rmSync } from 'fs';
import { join } from 'path';
import {
  assertBuildIsCurrent,
  COLD_DIST,
  portReleased,
  ROOT,
  startServerOnAnyPort,
  stopServer,
  storeRows,
  type ManagedServer,
} from './cold-process';
import {
  coldChatTranscriptPath,
  loadTranscript,
  recordingRequested,
  startFakeAnthropic,
  type FakeAnthropic,
} from './fake-anthropic';

/**
 * The cold-process path for the CHAT route, across a real restart.
 *
 * The sibling spec proves the ledger and the score survive a process boundary.
 * The chat route is the one that needs more than the run row: a turn is not
 * just "resolve the run", it is resolve the run, read every prior turn back to
 * give the model its context, and append four or five events to the store
 * before answering. Each of those is a per-process thing that a deployment has
 * to get from somewhere else, and each was silently satisfied by the registry
 * on a laptop — which is the whole reason this file is separate rather than one
 * more step in the other one.
 *
 * Why the real agent, and why a key gates the file.
 *
 * With the mock provider a cold chat turn is nearly free to fake: the mock
 * answers from the message text, so a process that lost the history would still
 * produce a plausible reply. The one thing that genuinely cannot survive a
 * process boundary is the conversation itself, and only a model that is given
 * the history produces evidence about it. So this spec asks the second process
 * a question only the first turn can answer, and the answer is the assertion.
 *
 * That costs money and is not available to every checkout, so the whole file
 * is behind ANTHROPIC_API_KEY: absent, it skips and says why, rather than
 * running against a mock and reporting a pass that proves nothing. The key is
 * never read here — the spawned server inherits it from this process's
 * environment, which is also how the CI job passes it in.
 */

const DATA_DIR = `${COLD_DIST}/delegate-data-cold-chat`;
const STAMP = Date.now().toString(36).slice(-5);
const PARTICIPANT = `E2E Cold Chat ${STAMP}`;
const SCENARIO = 's1';

/** A real key means a real model. Without one, the recorded transcript answers instead. */
const LIVE = Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * A recording run, which is neither of the two paths above on its own.
 *
 * With `RECORD_TRANSCRIPT` set the fake is stood up EVEN WITH a key, because in
 * that mode it forwards to the real API and the point is to capture a real
 * exchange — the transcript is not what answers. So `LIVE` stops deciding where
 * the requests go and only decides what answers them.
 */
const RECORD = recordingRequested();

/** The replay path is the only one whose answers come from the transcript. */
const REPLAY = !LIVE && !RECORD;

/**
 * The env the spawned servers need to reach whichever Anthropic is in play.
 *
 * With a key: the real API, untouched. Without one: `ANTHROPIC_BASE_URL` pointed
 * at the fixture endpoint and a syntactically real key, because the provider
 * refuses to be constructed without one and the whole point is to exercise the
 * real provider rather than the workshop's mock.
 */
const FAKE_KEY = 'sk-ant-api03-replay-fixture-not-a-real-key-0000000000000000000000000000000000000000000000000000000000000000';

/** A real multi-hop turn is slow by nature; the route's own ceiling is 60s. */
const TURN_TIMEOUT = 120_000;

const FIRST_TURN = 'Reconcile the March operating bank account and tell me what does not tie.';
const SECOND_TURN = 'In one short sentence, what did I just ask you to do? Nothing else.';

/** The word the first turn plants and the second turn's answer must carry. */
const CARRIED = /reconcil/i;

interface TurnResponse {
  reply?: string;
  provider?: string;
  usage?: { modelCalls?: number; budgetExceeded?: boolean };
  error?: string;
}

interface StoredEvent {
  id: number;
  runId: string;
  type: string;
  ts: string;
}

async function startRun(page: Page, url: string): Promise<{ sessionId: string; runId: string }> {
  const res = await page.request.post(`${url}/api/delegate/session`, {
    data: { participantLabel: PARTICIPANT, scenarioId: SCENARIO },
  });
  expect(res.ok(), 'the session route should start a run').toBeTruthy();
  return (await res.json()) as { sessionId: string; runId: string };
}

/** One agentic turn, with the timeout this route's latency actually needs. */
async function sendTurn(page: Page, url: string, runId: string, message: string) {
  return page.request.post(`${url}/api/delegate/chat`, {
    data: { runId, message },
    timeout: TURN_TIMEOUT,
  });
}

function eventsFor(runId: string): StoredEvent[] {
  return storeRows<StoredEvent>(DATA_DIR, 'events.json').filter((e) => e.runId === runId);
}

test.describe('Delegate cold process (chat)', () => {
  let first: ManagedServer | null = null;
  let second: ManagedServer | null = null;
  let fake: FakeAnthropic | null = null;

  /**
   * The servers' Anthropic environment, decided once for the file.
   *
   * `ANTHROPIC_BASE_URL` is the seam the agent already has
   * (`AnthropicProvider` reads it), so pointing it at a transcript on localhost
   * is enough to exercise the real provider, the real request shape and the real
   * tool loop with no account and no spend. A key, when there is one, still wins:
   * the live path is not downgraded to make the replay easier to run.
   */
  function agentEnv(): Record<string, string> {
    if (LIVE && !RECORD) return { DELEGATE_AGENT: 'anthropic' };
    return {
      DELEGATE_AGENT: 'anthropic',
      // A recording run forwards to the real API, so it needs the REAL key; the
      // fake's only job is to watch. Handing it the replay key here would make
      // every request 401 upstream and the candidate empty.
      ANTHROPIC_API_KEY: LIVE ? (process.env.ANTHROPIC_API_KEY as string) : FAKE_KEY,
      ANTHROPIC_BASE_URL: fake!.url,
    };
  }

  test.beforeAll(async () => {
    assertBuildIsCurrent();
    rmSync(join(ROOT, DATA_DIR), { recursive: true, force: true });
    if (!LIVE || RECORD) {
      fake = await startFakeAnthropic(loadTranscript(coldChatTranscriptPath(ROOT)), { root: ROOT });
    }
  });

  test.afterAll(async () => {
    await stopServer(second);
    await stopServer(first);
    await fake?.close();
    // Named in the log rather than left in a temp file: a candidate nobody
    // finds is a real model's answer spent for nothing, and this is the only
    // line that says where it went.
    if (fake?.recorded()) console.log(`      recorded a candidate transcript at ${fake.recorded()}`);
  });

  test('a turn on a process that never saw the run still knows what came before it', async ({ page }, testInfo) => {
    // Two process starts, a restart, and two model turns. Generous on purpose:
    // the model is the slowest thing here by an order of magnitude — and it is
    // only ever that slow against a real API, so the replay path needs a
    // fraction of this and finishes long before it.
    test.setTimeout(360_000);

    // Which of the two this was, recorded in the report rather than only in the
    // log: a CI reader looking at a green run cannot otherwise tell a real model
    // from a transcript, and those are very different things to be true.
    testInfo.annotations.push({
      type: 'agent',
      description: RECORD ? 'live model, recording a candidate fixture' : LIVE ? 'live model' : 'recorded transcript',
    });

    let runId = '';
    let firstPid = 0;
    let coldUrl = '';

    await test.step('a warm process takes the first turn with the real agent', async () => {
      first = await startServerOnAnyPort(DATA_DIR, agentEnv());
      const seeded = await startRun(page, first.url);
      runId = seeded.runId;
      expect(runId).toMatch(/^run-/);

      const warm = await sendTurn(page, first.url, runId, FIRST_TURN);
      const warmText = await warm.text();
      expect(warm.ok(), `the warm turn answered ${warm.status()}: ${warmText.slice(0, 300)}`).toBeTruthy();
      const body = JSON.parse(warmText) as TurnResponse;
      // The control has to be the REAL agent, or the rest of the test says
      // nothing: a mock would answer the second turn from its own text and the
      // history assertion would pass with no history in it.
      expect(body.provider, 'the warm turn must be served by the real provider').toBe('anthropic');
      expect((body.reply ?? '').length).toBeGreaterThan(0);
    });

    await test.step('the transcript was consulted, not just the last prompt', async () => {
      // The transcript served nothing in a recording run, so `served` is empty and these
      // assertions are about a mode that is not in play.
      if (!REPLAY) return;
      // Not decoration. It is what makes the replay path worth trusting: the
      // cold answer is only reachable from the turn that REQUIRES the first
      // question to be present, so seeing that turn served means the fixture
      // took the branch the assertion depends on.
      expect(fake!.served, 'the warm turn is answered from the transcript').toContain('warm');
    });

    await test.step('the first process is stopped, and its port comes back', async () => {
      firstPid = first!.pid;
      const firstPort = Number(new URL(first!.url).port);
      await stopServer(first);
      first = null;
      // Without this, "the second process" could be the first one still
      // answering under a new name and the whole test a no-op.
      await expect
        .poll(() => portReleased(firstPort), { timeout: 20_000, intervals: [200, 500, 1_000] })
        .toBe(true);
    });

    await test.step('a different process starts, on a port of its own', async () => {
      second = await startServerOnAnyPort(DATA_DIR, agentEnv());
      coldUrl = second.url;
      expect(second.pid, 'the second server must not be the first one').not.toBe(firstPid);
    });

    await test.step('the cold process answers with the history, not just a reply', async () => {
      const cold = await sendTurn(page, coldUrl, runId, SECOND_TURN);
      const text = await cold.text();
      // The pre-fix failure mode, named so a regression says what regressed.
      expect(text, 'the cold process must not answer with the no-runtime refusal').not.toContain(
        'no runtime for run',
      );
      expect(cold.ok(), `the cold turn answered ${cold.status()}: ${text.slice(0, 300)}`).toBeTruthy();
      const body = JSON.parse(text) as TurnResponse;
      // Still the real agent after the restart: a provider that silently
      // degraded to the mock here would satisfy the recall assertion below for
      // the wrong reason.
      expect(body.provider).toBe('anthropic');
      expect(body.usage?.modelCalls ?? 0).toBeGreaterThan(0);
      // THE assertion. Only a process that read the first turn back out of the
      // store can answer this; the prompt itself does not say it.
      expect(
        body.reply ?? '',
        'the cold process answered from its own prompt rather than from the transcript',
      ).toMatch(CARRIED);
    });

    await test.step('the cold answer came from the turn that needs the history', async () => {
      // The transcript served nothing in a recording run, so `served` is empty and these
      // assertions are about a mode that is not in play.
      if (!REPLAY) return;
      // The fallback turn is the one that says it has nothing. If THAT is what
      // answered, the spec has just caught the regression it was written for —
      // so its presence here would be a failure, not a detail.
      expect(
        fake!.served,
        'the cold turn fell through to the has-no-history fallback, so the transcript was not recovered',
      ).not.toContain('cold-without-history');
      expect(fake!.served, 'the cold turn was answered from the turn that requires the first question').toContain(
        'cold-with-history',
      );
    });

    await test.step('the cold process wrote both turns to the store', async () => {
      // Answering is not persisting: the chat route flushes its log in a
      // `finally`, and the transcript a later participant would read is those
      // rows. Read the file, so the assertion is about the store rather than
      // about the API that produced it.
      const events = eventsFor(runId);
      const prompts = events.filter((e) => e.type === 'prompt_sent');
      const replies = events.filter((e) => e.type === 'agent_response');
      expect(prompts.length, 'both prompts are in the store').toBeGreaterThanOrEqual(2);
      expect(replies.length, 'both replies are in the store').toBeGreaterThanOrEqual(2);
      // Append order is asserted on event IDs, not on `ts`. The log's ids are
      // the order it was written in; `ts` has millisecond resolution, so a
      // prompt and its reply can share a timestamp and a `ts` comparison would
      // call that out of order — the same tie that used to drop tool calls out
      // of a turn's window. A live model turn takes seconds, so this was never
      // observed to fail, but it is asserting order with the wrong instrument.
      expect(prompts[0].id < (replies[0]?.id ?? 0), 'events are in append order').toBe(true);
      // The cold turn logged at least one real tool call, which is the part of
      // the turn that is only reachable through the scenario-gated runtime the
      // cold process had to rebuild.
      expect(
        events.filter((e) => e.type === 'tool_call').length,
        'the rebuilt runtime gated tools the cold process had never seen',
      ).toBeGreaterThan(0);
    });

    await test.step('the transcript the participant sees is whole on the cold process', async () => {
      const state = await page.request.get(`${coldUrl}/api/delegate/run/${runId}/state`);
      expect(state.ok(), 'the state route reads the run from the store').toBeTruthy();
      const body = (await state.json()) as { messages?: Array<{ role: string; content: string }> };
      const mine = (body.messages ?? []).filter((m) => m.content !== '');
      const users = mine.filter((m) => m.role === 'user');
      expect(users.length, 'both turns are in the rebuilt thread').toBeGreaterThanOrEqual(2);
      expect(users[0].content).toContain('Reconcile the March operating bank account');
    });
  });
});
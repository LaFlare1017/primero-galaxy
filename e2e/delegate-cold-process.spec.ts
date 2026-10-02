/**
 * The cold-process path for the LEDGER and the score, over real HTTP,
 * across a real restart. The restart machinery itself — and why a test has
 * to kill a server to get this state at all — lives in ./cold-process.ts,
 * which the chat spec uses too.
 *
 * Two routes used to answer 404 on a process that had not seen the run:
 * `/api/delegate/view` and `/api/delegate/submit`, which is to say the
 * ledger pane and the score itself.
 *
 * The shape of the proof, in order:
 *   1. the viewer answers on the WARM process — the control. Without it, a
 *      failure after the restart would be ambiguous between "the cold path
 *      is broken" and "this viewer call was never going to work".
 *   2. the same viewer call, byte for byte, on the COLD process.
 *   3. the submit scores the run on the cold process, and the score is in
 *      the store afterwards — so the cold process did not merely answer, it
 *      wrote.
 *   4. the participant's own page restores from the cold process, read-only,
 *      showing the same debrief note the cold submit returned.
 */

import { expect, test } from './worker-server';
import type { APIResponse, Page } from '@playwright/test';
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

const DATA_DIR = `${COLD_DIST}/delegate-data-cold`;

const STAMP = Date.now().toString(36).slice(-5);
const PARTICIPANT = `E2E Cold ${STAMP}`;
const SCENARIO = 's1';

/** A bank line from the shared ledger, and the viewer action that reads it. */
const BANK_LINE = { id: 'BK-IN-INV-00001', type: 'bank_line' };

/** Over the server's own 40-word gate (delegate/src/api/validate.ts). */
const ANSWER =
  'WHAT I CONCLUDED: the reconciliation break is the supplier invoice booked ' +
  'against the wrong entity, and the bank line alone does not explain it. ' +
  'WHAT I CHECKED: I opened the bank feed, the matching journal entries, and ' +
  'the counterparty accounts for the period. WHAT I AM UNSURE ABOUT: whether ' +
  'the duplicate payment was reversed in the following week.';

async function startRun(page: Page, url: string): Promise<{ sessionId: string; runId: string }> {
  const res = await page.request.post(`${url}/api/delegate/session`, {
    data: { participantLabel: PARTICIPANT, scenarioId: SCENARIO },
  });
  expect(res.ok(), 'the session route should start a run').toBeTruthy();
  return (await res.json()) as { sessionId: string; runId: string };
}

/** One viewer action. The response body is compared warm against cold. */
async function openBankLine(page: Page, url: string, runId: string): Promise<APIResponse> {
  return page.request.post(`${url}/api/delegate/view`, {
    data: { runId, action: 'get_record', args: BANK_LINE },
  });
}

function scoreRows(): Array<{ runId: string; dimension: string; value: number }> {
  return storeRows<{ runId: string; dimension: string; value: number }>(DATA_DIR, 'scores.json');
}

test.describe('Delegate cold process', () => {
  let first: ManagedServer | null = null;
  let second: ManagedServer | null = null;

  test.beforeAll(() => {
    // globalSetup builds .next-e2e before any worker starts, so a missing
    // build is only reachable if the suite was pointed elsewhere — but a STALE
    // one is easy to reach, and it fails as behaviour rather than as setup.
    assertBuildIsCurrent();
    // One store for both servers, which is the whole point: the second process
    // finds the run here and nowhere else.
    rmSync(join(ROOT, DATA_DIR), { recursive: true, force: true });
  });

  test.afterAll(async () => {
    await stopServer(second);
    await stopServer(first);
  });

  test('a run started on one process is viewable and submittable on the next one', async ({ page }) => {
    // Two process starts and a restart, on top of a browser and a build that may
    // be cold on the first run of the day.
    test.setTimeout(240_000);

    let runId = '';
    let sessionId = '';
    let firstPid = 0;
    let warmBody = '';
    // Held as a URL rather than as the server handle: the steps after the
    // restart only need somewhere to send a request, and a handle that
    // TypeScript cannot narrow across a closure is a handle somebody will
    // eventually use before it is set.
    let coldUrl = '';

    await test.step('a run is started, and the viewer answers, on a warm process', async () => {
      first = await startServerOnAnyPort(DATA_DIR);
      const seeded = await startRun(page, first.url);
      runId = seeded.runId;
      sessionId = seeded.sessionId;
      expect(runId).toMatch(/^run-/);

      const warm = await openBankLine(page, first.url, runId);
      expect(warm.ok(), 'the control: the viewer route works while the process is warm').toBeTruthy();
      warmBody = JSON.stringify(await warm.json());
      expect(warmBody).toContain(BANK_LINE.id);
    });

    await test.step('the first process is stopped, and its port comes back', async () => {
      firstPid = first!.pid;
      const firstPort = Number(new URL(first!.url).port);
      await stopServer(first);
      first = null;
      // The port must actually be free, or "the second process" would be the
      // first one still answering under a new name and the whole test a no-op.
      await expect
        .poll(() => portReleased(firstPort), { timeout: 20_000, intervals: [200, 500, 1_000] })
        .toBe(true);
    });

    await test.step('a different process starts, on a port of its own', async () => {
      // Its own port rather than the same one: the proof here is the pid, and
      // reusing the port would add a race (something else could take it between
      // the release above and the bind) to a step whose job is only to be a
      // different process.
      second = await startServerOnAnyPort(DATA_DIR);
      coldUrl = second.url;
      // Distinct pids is what makes the rest of the test a cold-process test: a
      // new process has an empty `globalThis`, so the registry this deployment
      // path depends on cannot have survived it.
      expect(second.pid).toBeGreaterThan(0);
      expect(second.pid, 'the second server must not be the first one').not.toBe(firstPid);
    });

    await test.step('the run is still there — the store outlived the process', async () => {
      const state = await page.request.get(`${coldUrl}/api/delegate/run/${runId}/state`);
      expect(state.ok(), 'the state route reads the run from the store').toBeTruthy();
      const body = (await state.json()) as { sessionId?: string; scenarioId?: string; submittedAt?: string };
      expect(body.scenarioId).toBe(SCENARIO);
      expect(body.submittedAt ?? '').toBe('');
    });

    await test.step('the viewer answers on a process that has never seen the run', async () => {
      const cold = await openBankLine(page, coldUrl, runId);
      const text = await cold.text();
      // The pre-fix failure was a 404 reading "no runtime for run …" — named
      // here so a regression says what regressed rather than just "not 200".
      expect(text, 'the cold process must not answer with the no-runtime refusal').not.toContain(
        'no runtime for run',
      );
      expect(cold.ok(), `the cold viewer call answered ${cold.status()}: ${text.slice(0, 300)}`).toBeTruthy();
      // Same bytes as the warm control: the ledger is deterministic, so a
      // difference would mean this process built a different world.
      expect(JSON.stringify(JSON.parse(text))).toBe(warmBody);
    });

    let debrief = '';
    await test.step('submit scores the run from the cold process', async () => {
      const submit = await page.request.post(`${coldUrl}/api/delegate/submit`, {
        data: { runId, answer: ANSWER },
      });
      const text = await submit.text();
      expect(text, 'the cold process must not answer with the no-runtime refusal').not.toContain(
        'no runtime for run',
      );
      expect(submit.ok(), `the cold submit answered ${submit.status()}: ${text.slice(0, 300)}`).toBeTruthy();
      const body = JSON.parse(text) as { detected?: boolean; debriefNote?: string; scored?: number };
      expect(typeof body.detected).toBe('boolean');
      expect(body.debriefNote ?? '').not.toBe('');
      expect(body.scored ?? 0).toBeGreaterThan(0);
      debrief = body.debriefNote ?? '';

      // …and the score is in the store, so the cold process wrote rather than
      // merely answered. Read through the file the suite's server backend uses.
      const rows = scoreRows().filter((row) => row.runId === runId);
      expect(rows.length, 'the cold process persisted score rows for this run').toBeGreaterThan(0);
      expect(rows.every((row) => typeof row.value === 'number')).toBe(true);
    });

    await test.step("the participant's page restores from the cold process, read-only", async () => {
      await page.goto(`${coldUrl}/delegate?run=${runId}&session=${sessionId}`);
      // The preview reads the run off the cold process before any consent, and
      // states the submitted state — a page that cannot find the run would
      // offer "start fresh" instead.
      const preview = page.getByRole('region', { name: 'Run preview' });
      await expect(preview.getByText('submitted — reopens read-only')).toBeVisible();

      await page.getByRole('button', { name: 'Reopen previous session' }).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get('run'), { timeout: 15_000 })
        .toBe(runId);

      // The composer is disabled on a submitted run, so the run cannot be
      // polluted by whatever the cold process did or did not remember.
      await expect(page.locator('input[placeholder="Scenario submitted"]')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Submit answer' })).toHaveCount(0);
      // The note the cold submit returned is the note on screen: the same
      // process scored it and the same process served the page.
      await expect(page.getByText(debrief.slice(0, 60), { exact: false })).toBeVisible();
    });
  });
});

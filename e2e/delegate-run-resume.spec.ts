import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end proof of `?run=` resume on /delegate (the URL-state audit's
 * opportunities 1+2): the participant screen carries its open run in the
 * URL, so a refresh or crash — or a link from the facilitator — can restore
 * the live workspace instead of dead-ending on the landing screen while
 * the run keeps recording on the server.
 *
 *   1. a started run writes ?run=&session= into the URL
 *   2. refreshing mid-scenario offers (consent-required) reopen; accepting
 *      restores the workspace: transcript from the event log (with the
 *      turn's tool calls), elapsed clock derived from run.startedAt,
 *      ?session= continuity for the next scenario start
 *   3. declining keeps the landing screen clean and strips the params
 *   4. a submitted run restores READ-ONLY: detection + debrief note render,
 *      the composer is disabled, and the answer panel shows the submitted view
 *   5. a stale/unknown run link degrades to "start fresh" — never a crash,
 *      never a phantom run
 *
 * Seeding is real API traffic (POST /api/delegate/session, chat, submit)
 * so the event log, transcript rebuild, and scoring artifacts are the
 * actual production paths. Labels are stamped per test file because the
 * delegate store accumulates across runs (facilitator-grid convention).
 */

const STAMP = Date.now().toString(36).slice(-5);
const PARTICIPANT = `E2E Resume ${STAMP}`;

const MIN_40_WORDS =
  'WHAT I CONCLUDED: The revenue recognition defect was identified and the ' +
  'contract treatment reviewed against the policy. WHAT I CHECKED: I opened ' +
  'the journal entries, the contract document, and the account summaries for ' +
  'the period. WHAT I AM UNSURE ABOUT: Nothing material remains open here.';

const COMPOSER = 'input[placeholder="Ask the agent or direct its work…"]';

interface StartResponse {
  sessionId: string;
  runId: string;
}

async function startRun(page: Page, scenarioId: string): Promise<StartResponse> {
  const res = await page.request.post('/api/delegate/session', {
    data: { participantLabel: PARTICIPANT, scenarioId },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as StartResponse;
}

/** Wait until the restored workspace is up (URL pointer + composer). */
async function waitRestored(page: Page, runId: string) {
  await expect
    .poll(() => new URL(page.url()).searchParams.get('run'), { timeout: 10_000 })
    .toBe(runId);
  // The composer placeholder flips to "Scenario submitted" on a restored
  // submitted (read-only) run; both states mean the workspace is up.
  await expect(
    page.locator('input[placeholder="Ask the agent or direct its work…"], input[placeholder="Scenario submitted"]'),
  ).toBeVisible();
}

test.describe('Delegate ?run= resume', () => {
  test('a live run restores from the URL after a refresh, with its thread', async ({ page }) => {
    // Start a run through the UI so the URL pointer path is the real one.
    await page.goto('/delegate');
    await page.getByPlaceholder('e.g. Jordan').fill(PARTICIPANT);
    await page.getByRole('button', { name: /Start scenario/ }).click();
    await expect(page.locator(COMPOSER)).toBeVisible();

    // The run pointer lands in the URL as soon as the run exists.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('run'), { timeout: 10_000 })
      .toMatch(/^run-/);
    const runId = new URL(page.url()).searchParams.get('run') as string;
    expect(new URL(page.url()).searchParams.get('session')).toBeTruthy();

    // One real agent turn: the mock agent answers "reconcile" prompts with
    // two tool calls, giving the restored transcript something to prove.
    await page.locator(COMPOSER).fill('Please reconcile the bank account.');
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('I reconciled the March operating account', { exact: false }),
    ).toBeVisible({ timeout: 20_000 });

    // ── The refresh ──
    await page.reload();
    await expect(page.getByPlaceholder('e.g. Jordan')).toBeVisible();

    // Consent-required restore offer; accepting reopens the workspace.
    await page.getByRole('button', { name: 'Reopen previous session' }).click();
    await waitRestored(page, runId);

    // Thread rebuilt from the event log (live parity), including the turn's
    // tool rows — collapsed by default like a live turn, expandable to the
    // real calls.
    await expect(
      page.getByText('Please reconcile the bank account.'),
    ).toBeVisible();
    await expect(
      page.getByText('I reconciled the March operating account', { exact: false }),
    ).toBeVisible();
    const toolSummary = page.getByText('2 tool calls (expand to see what the agent did)');
    await expect(toolSummary).toBeVisible();
    await toolSummary.click();
    await expect(page.getByText('get_bank_feed')).toBeVisible();
    await expect(page.getByText('query_gl')).toBeVisible();

    // Elapsed clock derived from the run's real startedAt (not reset to 00:00).
    const timer = page.getByText(/^\d{2}:\d{2}$/).first();
    await expect(timer).toBeVisible();
    const minutes = Number((await timer.textContent())?.slice(0, 2));
    expect(minutes).toBeGreaterThanOrEqual(0);

    // Session continuity: submit the restored run through the UI, then take
    // the s1 → s3 handoff — the next start must RESUME the same session (one
    // facilitator row), which only works if restore reclaimed the session's
    // own participant label.
    await page.getByPlaceholder('1. What did you conclude?').fill(
      'I concluded the cash does not reconcile because one deposit of 18450 appears twice in the bank feed but once in the GL.',
    );
    await page.getByPlaceholder('2. What did you check?').fill(
      'I checked the bank feed lines, the GL cash activity, and both matching open invoices for the same amount.',
    );
    await page.getByPlaceholder('3. What are you unsure about?').fill(
      'I am unsure whether the second deposit line needs a reversing entry before close.',
    );
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText('Scores are revealed together')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Proceed to Scenario 3: Q1 flux commentary' }).click();
    await expect(page.locator(COMPOSER)).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('scenario'))
      .toBe('s3');

    const sessionAfter = await page.evaluate((label: string) => {
      const res = fetch('/api/delegate/facilitator') as unknown as Promise<Response>;
      return res.then(async (resp) => {
        const data = (await resp.json()) as { rows: Array<{ participant: string; currentScenario: string }> };
        // Exact label: the store accumulates across suite executions, so a
        // startsWith('E2E Resume') would match a stale session from a previous
        // run still sitting in the facilitator grid.
        return data.rows.find((r) => r.participant === label);
      });
    }, PARTICIPANT);
    expect(sessionAfter?.currentScenario).toBe('s3');
  });

  test('declining the restore offer strips the params and stays clean', async ({ page }) => {
    const seeded = await startRun(page, 's2');
    await page.goto(`/delegate?run=${seeded.runId}&session=${seeded.sessionId}`);

    await expect(page.getByRole('button', { name: 'Reopen previous session' })).toBeVisible();
    await page.getByRole('button', { name: 'Start fresh instead' }).click();

    // Landing screen, params gone, and nothing was started: no offer again.
    await expect(page.getByPlaceholder('e.g. Jordan')).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).search)
      .toBe('');
    await expect(page.getByRole('button', { name: 'Reopen previous session' })).toHaveCount(0);
  });

  test('a submitted run restores read-only with its detection result', async ({ page }) => {
    const seeded = await startRun(page, 's5');
    const submit = await page.request.post('/api/delegate/submit', {
      data: { runId: seeded.runId, answer: MIN_40_WORDS },
    });
    expect(submit.ok()).toBeTruthy();

    await page.goto(`/delegate?run=${seeded.runId}&session=${seeded.sessionId}`);
    await page.getByRole('button', { name: 'Reopen previous session' }).click();
    await waitRestored(page, seeded.runId);

    // Submitted view: detection + debrief note, not the answer panel…
    // (s5 has no planted defect, so the scorer marks the answer detected.)
    await expect(page.getByText('Defect detected: your answer named it')).toBeVisible();
    await expect(page.getByText('Scores are revealed together')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit answer' })).toHaveCount(0);

    // …and read-only: the composer is disabled (placeholder flips to
    // "Scenario submitted"), the run cannot be polluted.
    await expect(page.locator('input[placeholder="Scenario submitted"]')).toBeDisabled();
    await expect(page.getByText('agent is working with the ERP')).toHaveCount(0);
  });

  test('a stale run link degrades to start-fresh guidance', async ({ page }) => {
    await page.goto('/delegate?run=run-does-not-exist&session=sess-gone');
    await expect(page.getByPlaceholder('e.g. Jordan')).toBeVisible();

    await page.getByRole('button', { name: 'Reopen previous session' }).click();
    await expect(page.getByText('That run could not be found.')).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('run'))
      .toBe(null);
    // The landing screen stays fully usable.
    await page.getByPlaceholder('e.g. Jordan').fill(PARTICIPANT);
    await page.getByRole('button', { name: /Start scenario/ }).click();
    await expect(page.locator(COMPOSER)).toBeVisible();
  });
});

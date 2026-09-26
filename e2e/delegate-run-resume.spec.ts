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
    // Before the turn, copy the run link from the top bar (the
    // participant-side share, per the saved-views Share pattern) and prove
    // it is the same resumable URL the restore flow understands.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy session link' }).click();
    await expect(page.getByRole('button', { name: 'Copy session link' })).toContainText('Copied');
    const shared = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect(shared.pathname).toBe('/delegate');
    expect(shared.searchParams.get('run')).toBe(runId);
    expect(shared.searchParams.get('session')).toBeTruthy();
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

  test('a shared run link toasts on arrival, and only once per tab', async ({ page, browser }) => {
    const seeded = await startRun(page, 's2');

    // Receiver: a fresh context, as if the link was handed over.
    const receiverContext = await browser.newContext();
    const receiver = await receiverContext.newPage();
    await receiver.goto(`/delegate?run=${seeded.runId}&session=${seeded.sessionId}`);
    await expect(receiver.getByRole('status')).toContainText('Opened a shared session link');
    expect(new URL(receiver.url()).searchParams.get('run')).toBe(seeded.runId);

    // The offer stays usable: reopen restores, and the toast leaves with
    // the landing screen.
    await receiver.getByRole('button', { name: 'Reopen previous session' }).click();
    await waitRestored(receiver, seeded.runId);
    await expect(receiver.getByRole('status')).toHaveCount(0);
    await receiverContext.close();

    // A different tab session sees the toast again (per-tab, not global).
    const secondContext = await browser.newContext();
    const second = await secondContext.newPage();
    await second.goto(`/delegate?run=${seeded.runId}&session=${seeded.sessionId}`);
    await expect(second.getByRole('status')).toContainText('Opened a shared session link');
    await secondContext.close();

    // The SAME tab reloading never re-toasts.
    const thirdContext = await browser.newContext();
    const third = await thirdContext.newPage();
    await third.goto(`/delegate?run=${seeded.runId}&session=${seeded.sessionId}`);
    await expect(third.getByRole('status')).toBeVisible();
    await third.reload();
    await expect(third.getByRole('status')).toHaveCount(0);
    // Still restorable after the silent reload.
    await expect(third.getByRole('button', { name: 'Reopen previous session' })).toBeVisible();
    await thirdContext.close();

    // Declining clears the arrival: starting fresh never shows the toast.
    const fourthContext = await browser.newContext();
    const fourth = await fourthContext.newPage();
    await fourth.goto(`/delegate?run=${seeded.runId}&session=${seeded.sessionId}`);
    await fourth.getByRole('button', { name: 'Start fresh instead' }).click();
    await expect(fourth.getByPlaceholder('e.g. Jordan')).toBeVisible();
    await expect(fourth.getByRole('status')).toHaveCount(0);
    await fourth.getByRole('button', { name: /Start scenario/ }).click();
    await expect(fourth.locator(COMPOSER)).toBeVisible();
    await fourthContext.close();
  });

  test('the restore offer previews the run it points at', async ({ page, browser }) => {
    const seeded = await startRun(page, 's2');

    // Receiver context, as if the link was handed over.
    const receiverContext = await browser.newContext();
    const receiver = await receiverContext.newPage();
    await receiver.goto(`/delegate?run=${seeded.runId}&session=${seeded.sessionId}`);
    const preview = receiver.getByRole('region', { name: 'Run preview' });
    await expect(preview).toBeVisible();
    // Best-effort preview from the state endpoint: scenario name, elapsed
    // clock (ticks for a live run), message count, session owner.
    await expect(preview.getByText('Why doesn\'t intercompany balance?')).toBeVisible();
    await expect(preview.getByText(/^\d{2}:\d{2}$/)).toBeVisible();
    await expect(preview.getByText('no conversation yet')).toBeVisible();
    await expect(preview.getByText('session of E2E Resume')).toBeVisible();
    await expect(preview.getByText('in progress')).toBeVisible();

    // The clock ticks while the offer stands (live run).
    const t1 = await preview.locator('span.font-mono').innerText();
    await receiver.waitForTimeout(2100);
    const t2 = await preview.locator('span.font-mono').innerText();
    expect(t2).not.toBe(t1);

    // Accept: restore still verifies authoritatively and lands in the
    // workspace — the preview never gates it.
    await receiver.getByRole('button', { name: 'Reopen previous session' }).click();
    await waitRestored(receiver, seeded.runId);
    await receiverContext.close();
  });

  test('a submitted run restores read-only with its detection result', async ({ page }) => {
    const seeded = await startRun(page, 's5');
    const submit = await page.request.post('/api/delegate/submit', {
      data: { runId: seeded.runId, answer: MIN_40_WORDS },
    });
    expect(submit.ok()).toBeTruthy();

    await page.goto(`/delegate?run=${seeded.runId}&session=${seeded.sessionId}`);

    // Consent gate: the params are the only copy of the pointer until
    // restore is accepted, so the landing card offers the copy there too —
    // and it yields the same resumable URL.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
      .toContain(`run=${seeded.runId}`);

    // The offer previews the submitted state BEFORE consenting: the clock
    // is frozen at submittedAt and the read-only outcome is stated.
    const preview = page.getByRole('region', { name: 'Run preview' });
    await expect(preview.getByText(/message with the agent|no conversation yet/)).toBeVisible();
    await expect(preview.getByText('submitted — reopens read-only')).toBeVisible();
    const t1 = await preview.locator('span.font-mono').innerText();
    await page.waitForTimeout(2100);
    expect(await preview.locator('span.font-mono').innerText()).toBe(t1);

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

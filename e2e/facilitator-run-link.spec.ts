import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end proof of the facilitator grid's copy-run-link action (the
 * URL-state audit's sequencing §7.4 — "the two surfaces then share state
 * end to end"): each row offers a one-click copy of that participant's
 * resumable `/delegate?run=…&session=…` link, the same pointer the
 * participant screen writes when a run starts.
 *
 * The receiver side is proven for real, not by URL-shape inspection alone:
 * the copied link is opened in a FRESH browser context (no session state,
 * as if handed to another tab or machine) and must land on the
 * consent-required restore offer — accepting restores the live workspace,
 * and a submitted run restores read-only. Each row also offers an Open
 * action (the same URL as a real anchor, new tab): the popup flows prove
 * it restores the same way, live transcript included.
 *
 * Seeding is real API traffic (POST /api/delegate/session, chat, submit);
 * labels are stamped per run because the delegate store accumulates
 * (facilitator-grid convention). Clipboard assertions follow the
 * facilitator-saved-views pattern: grant clipboard permissions, then read
 * the pasteboard through page.evaluate.
 */

const STAMP = Date.now().toString(36).slice(-5);
const LIVE = `E2E LinkLive ${STAMP}`;
const SUBMITTED = `E2E LinkSub ${STAMP}`;
// The watch tests seed their own sessions: the store accumulates rows
// across tests in this file, and a shared label would match two rows.
const WATCH_LIVE = `E2E LinkWatch ${STAMP}`;
const WATCH_SUB = `E2E LinkWatchS ${STAMP}`;
const WATCH_RESULT = `E2E LinkWatchR ${STAMP}`;
const WATCH_NODEFECT = `E2E LinkWatchN ${STAMP}`;

const MIN_40_WORDS =
  'WHAT I CONCLUDED: The revenue recognition defect was identified and the ' +
  'contract treatment reviewed against the policy. WHAT I CHECKED: I opened ' +
  'the journal entries, the contract document, and the account summaries for ' +
  'the period. WHAT I AM UNSURE ABOUT: Nothing material remains open here.';

const COMPOSER = 'input[placeholder="Ask the agent or direct its work…"]';

/** Watch a participant's run from the grid row; wait for the mirror. */
async function watchRun(page: Page, participant: string): Promise<void> {
  await page
    .getByRole('row')
    .filter({ hasText: participant })
    .getByRole('button', { name: `Watch ${participant}` })
    .click();
  await expect(page.getByRole('region', { name: `Watching run for ${participant}` })).toBeVisible();
}

/** One real agent turn through the chat API (mirrors as two messages). */
async function chatTurn(page: Page, runId: string, message: string): Promise<void> {
  const res = await page.request.post('/api/delegate/chat', {
    data: { runId, message },
  });
  expect(res.ok()).toBeTruthy();
}

interface StartResponse {
  sessionId: string;
  runId: string;
}

async function startRun(page: Page, participantLabel: string, scenarioId: string): Promise<StartResponse> {
  const res = await page.request.post('/api/delegate/session', {
    data: { participantLabel, scenarioId },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as StartResponse;
}

/** Copy a participant's run link from the grid row and return it. */
async function copyRunLink(page: Page, participant: string): Promise<string> {
  const row = page.getByRole('row').filter({ hasText: participant });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await row.getByRole('button', { name: `Copy run link for ${participant}` }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
    .toContain('/delegate?');
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('Facilitator run links', () => {
  test('a copied live-run link restores the workspace in a fresh context', async ({ page, browser }) => {
    const seeded = await startRun(page, LIVE, 's1');

    await page.goto('/delegate/facilitator');
    const link = await copyRunLink(page, LIVE);

    // The link is the same URL-shape the participant screen writes: opaque
    // capability ids, never the participant label (audit §5).
    const shared = new URL(link);
    expect(shared.pathname).toBe('/delegate');
    expect(shared.searchParams.get('run')).toBe(seeded.runId);
    expect(shared.searchParams.get('session')).toBe(seeded.sessionId);
    expect(link).not.toContain(LIVE);

    // One real agent turn through the chat API, so the Open flow can prove
    // the restored workspace carries the transcript rebuilt from the event
    // log — not just an empty composer.
    const chat = await page.request.post('/api/delegate/chat', {
      data: { runId: seeded.runId, message: 'Please reconcile the bank account.' },
    });
    expect(chat.ok()).toBeTruthy();

    // The row's Open action: the same URL as a real anchor, new tab.
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('row').filter({ hasText: LIVE }).getByRole('link', { name: `Open run for ${LIVE}` }).click(),
    ]);
    await expect(popup.getByPlaceholder('e.g. Jordan')).toBeVisible();
    await popup.getByRole('button', { name: 'Reopen previous session' }).click();
    await expect
      .poll(() => new URL(popup.url()).searchParams.get('run'), { timeout: 10_000 })
      .toBe(seeded.runId);
    await expect(popup.locator(COMPOSER)).toBeVisible();
    await expect(popup.getByText('Please reconcile the bank account.')).toBeVisible();
    await expect(
      popup.getByText('I reconciled the March operating account', { exact: false }),
    ).toBeVisible();
    await popup.close();

    // Receiver side: a fresh context (no session state, another machine).
    const receiverContext = await browser.newContext();
    const receiver = await receiverContext.newPage();
    await receiver.goto(link);

    // Consent-required restore offer — a run link never auto-opens a
    // workspace (audit §3: no silent resume without explicit action).
    await expect(receiver.getByPlaceholder('e.g. Jordan')).toBeVisible();
    await receiver.getByRole('button', { name: 'Reopen previous session' }).click();

    // The workspace comes back with the run pointer intact.
    await expect
      .poll(() => new URL(receiver.url()).searchParams.get('run'), { timeout: 10_000 })
      .toBe(seeded.runId);
    await expect(receiver.locator(COMPOSER)).toBeVisible();
    await expect(receiver.getByRole('button', { name: 'Reopen previous session' })).toHaveCount(0);

    await receiverContext.close();
  });

  test('the watch pane mirrors a live run and follows it without a reload', async ({ page }) => {
    const seeded = await startRun(page, WATCH_LIVE, 's1');

    await page.goto('/delegate/facilitator');
    await watchRun(page, WATCH_LIVE);

    // Selection lives in the URL: shareable, survives a reload.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('watch'), { timeout: 5_000 })
      .toBe(seeded.runId);
    await expect(page.getByText('No messages yet')).toBeVisible();

    // Seed a turn AFTER the pane is open: the mirror must follow without a
    // reload — both messages, with the turn's tool calls collapsed.
    await chatTurn(page, seeded.runId, 'Please reconcile the bank account.');
    const pane = page.getByRole('region', { name: `Watching run for ${WATCH_LIVE}` });
    await expect(pane.getByText('Please reconcile the bank account.')).toBeVisible({ timeout: 15_000 });
    await expect(pane.getByText('I reconciled the March operating account', { exact: false })).toBeVisible();
    const toolSummary = pane.getByText('2 tool calls (expand to see what the agent did)');
    await expect(toolSummary).toBeVisible();
    await toolSummary.click();
    await expect(pane.getByText('get_bank_feed')).toBeVisible();
    await expect(pane.getByText('query_gl')).toBeVisible();
    await expect(pane.getByText('agent is working with the ERP')).toBeVisible();

    // The mirror survives a reload (state, not a one-shot import).
    await page.reload();
    await expect(page.getByRole('region', { name: `Watching run for ${WATCH_LIVE}` })).toBeVisible();
    await expect(page.getByText('Please reconcile the bank account.')).toBeVisible();

    // Close drops the ?watch= param and the pane.
    await page.getByRole('button', { name: 'Close watch pane' }).click();
    await expect(page.getByRole('region', { name: `Watching run for ${WATCH_LIVE}` })).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('watch'))
      .toBe(null);
  });

  test('the watch pane freezes a submitted run at its submitted clock', async ({ page }) => {
    const seeded = await startRun(page, WATCH_SUB, 's5');
    const submit = await page.request.post('/api/delegate/submit', {
      data: { runId: seeded.runId, answer: MIN_40_WORDS },
    });
    expect(submit.ok()).toBeTruthy();

    await page.goto('/delegate/facilitator');
    await watchRun(page, WATCH_SUB);
    const pane = page.getByRole('region', { name: `Watching run for ${WATCH_SUB}` });

    // The clock is frozen at submittedAt (not counting up) and the run is
    // marked submitted; the participant screen would be read-only too.
    const clock = () => pane.locator('span.font-mono').innerText();
    const t1 = await clock();
    await expect(pane.getByText('submitted', { exact: true })).toBeVisible();
    await page.waitForTimeout(2100);
    const t2 = await clock();
    expect(t2).toBe(t1);

    // Eye toggle off: the pane closes and the param drops.
    await page.getByRole('row').filter({ hasText: WATCH_SUB }).getByRole('button', { name: `Watch ${WATCH_SUB}` }).click();
    await expect(pane).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('watch'))
      .toBe(null);
  });

  test('the watch pane shows the submitted result and holds back the score', async ({ page }) => {
    const seeded = await startRun(page, WATCH_RESULT, 's1');

    await page.goto('/delegate/facilitator');
    await watchRun(page, WATCH_RESULT);
    const pane = page.getByRole('region', { name: `Watching run for ${WATCH_RESULT}` });
    // A working run has no result to show: the block must not appear early.
    await expect(pane.getByRole('region', { name: 'Submitted result' })).toHaveCount(0);

    const submit = await page.request.post('/api/delegate/submit', {
      data: { runId: seeded.runId, answer: MIN_40_WORDS },
    });
    expect(submit.ok()).toBeTruthy();

    // The poll that freezes the clock also brings the post-submit fields the
    // state endpoint already serves — no reload, no extra request.
    const result = pane.getByRole('region', { name: 'Submitted result' });
    await expect(result).toBeVisible({ timeout: 15_000 });

    // The verdict is the grid's own, neither invented nor softened, and the
    // Detection cell behind the pane agrees with it.
    const state = (await (await page.request.get(`/api/delegate/run/${seeded.runId}/state`)).json()) as {
      detected?: boolean;
      debriefNote?: string;
    };
    expect(typeof state.detected).toBe('boolean');
    expect(state.debriefNote ?? '').not.toBe('');

    // innerText collapses the note's newlines, so compare on flattened text.
    const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
    const flatNote = flat(state.debriefNote as string);
    const shown = flat(await result.innerText());
    const verdict = /Detection: (caught it|missed)/.exec(shown);
    expect(verdict).not.toBeNull();
    await expect(page.getByRole('row').filter({ hasText: WATCH_RESULT })).toContainText(verdict![1]);

    // The participant is shown this exact note, so the facilitator debriefs
    // from the same words the room is reading.
    expect(shown).toContain(flatNote.slice(0, 60));

    // Scores stay debrief-only: the same notice the participant's own
    // post-submit panel carries, and no grade anywhere else in the block.
    // (The note itself is prose — it quotes bank dates like 3/12 — so the
    // numeric check runs on the block with the note removed.)
    await expect(result.getByText('Scores are revealed together')).toBeVisible();
    expect(shown.replace(flatNote, '')).not.toMatch(/\b\d+(\.\d+)?\s*(?:\/|out of)\s*\d+\b/i);
  });

  test('the watch pane invents no verdict for a scenario with no planted defect', async ({ page }) => {
    // s5 plants no interception defect, so the grid reports n/a. The state
    // endpoint nonetheless answers detected:true for such a run (the
    // participant panel shows its "nothing was planted" copy) — so a pane
    // that trusted that boolean would read "caught it" directly above a grid
    // cell saying n/a. The verdict must come from the grid, or not at all.
    const seeded = await startRun(page, WATCH_NODEFECT, 's5');
    const submit = await page.request.post('/api/delegate/submit', {
      data: { runId: seeded.runId, answer: MIN_40_WORDS },
    });
    expect(submit.ok()).toBeTruthy();

    const state = (await (await page.request.get(`/api/delegate/run/${seeded.runId}/state`)).json()) as {
      detected?: boolean;
    };
    expect(state.detected).toBe(true); // the endpoint's eager answer, unused here

    await page.goto('/delegate/facilitator');
    await watchRun(page, WATCH_NODEFECT);
    const pane = page.getByRole('region', { name: `Watching run for ${WATCH_NODEFECT}` });
    const result = pane.getByRole('region', { name: 'Submitted result' });
    await expect(result).toBeVisible({ timeout: 15_000 });

    // The result is still there — the note and the debrief-only notice —
    // just with no verdict claim to make.
    await expect(result.getByText('Scores are revealed together')).toBeVisible();
    await expect(result).not.toContainText('Detection:');
    await expect(page.getByRole('row').filter({ hasText: WATCH_NODEFECT })).toContainText('n/a');
  });

  test('the watch pane sweeps the visible participants with prev/next', async ({ page }) => {
    // Three sessions with labels that sort as a CONTIGUOUS block: the
    // stamp leads ("E2E <stamp> SweepA/B/C"), so this execution's trio is
    // adjacent in the participant-sorted sweep even though the store keeps
    // every prior execution's rows (whose stamps sort before/after).
    const b = await startRun(page, `E2E ${STAMP} SweepB`, 's2');
    const c = await startRun(page, `E2E ${STAMP} SweepC`, 's3');
    await startRun(page, `E2E ${STAMP} SweepA`, 's1');

    // Deep-link the watch to the middle of the trio. The room is large,
    // so only the indicator FORMAT is asserted, not absolute numbers.
    await page.goto(`/delegate/facilitator?watch=${b.runId}`);
    const paneB = page.getByRole('region', { name: `Watching run for E2E ${STAMP} SweepB` });
    await expect(paneB).toBeVisible();
    await expect(paneB.getByText(/^\d+ of \d+$/)).toBeVisible();
    await expect(paneB.getByText('2 · Intercompany')).toBeVisible();

    // Next from B lands on its sorted neighbor C; the URL pointer follows
    // and the mirror switches (the header label swaps, the old pane goes).
    await paneB.getByRole('button', { name: 'Watch next participant' }).click();
    const paneC = page.getByRole('region', { name: `Watching run for E2E ${STAMP} SweepC` });
    await expect(paneC).toBeVisible();
    await expect(paneC.getByText('3 · Q1 flux')).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('watch'), { timeout: 5_000 })
      .toBe(c.runId);
    await expect(paneB).toHaveCount(0);

    // Previous from C returns to B: both directions walk the displayed
    // order without page scroll or row clicks.
    await paneC.getByRole('button', { name: 'Watch previous participant' }).click();
    await expect(page.getByRole('region', { name: `Watching run for E2E ${STAMP} SweepB` })).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('watch'), { timeout: 5_000 })
      .toBe(b.runId);

    // The sweep follows the DISPLAYED room: facet to submitted-only and
    // the working trio leaves the sweep — stepping from a run that is no
    // longer visible enters the shrunken sweep at its first row, which is
    // the first submitted row on screen.
    await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^submitted/ }).click();
    await page.getByRole('button', { name: 'Watch next participant' }).click();
    const submittedInStore = (
      (await (await page.request.get('/api/delegate/facilitator')).json()) as {
        rows: Array<{ status: string }>;
      }
    ).rows.filter((r) => r.status === 'submitted').length;
    await expect(page.getByText(`1 of ${submittedInStore}`)).toBeVisible();
    const firstName = await page.locator('tbody tr').first().locator('td').first().innerText();
    await expect(page.getByRole('region', { name: `Watching run for ${firstName}` })).toBeVisible();
  });

  test('the watch pane sweeps with the arrow keys, and yields them to text fields', async ({ page }) => {
    // Stamped labels, stamp first, so this execution's pair sits together in
    // the participant-sorted sweep whatever else the accumulating store holds.
    const a = await startRun(page, `E2E ${STAMP} KeyA`, 's1');
    await startRun(page, `E2E ${STAMP} KeyB`, 's2');

    await page.goto(`/delegate/facilitator?watch=${a.runId}`);
    // The open pane, whatever participant it currently shows.
    const openPane = page.locator('section[aria-label^="Watching run for"]');
    await expect(openPane).toBeVisible();
    // Advertised only when there is somewhere to step to.
    await expect(openPane).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight');
    const position = async (): Promise<[number, number]> => {
      const digits = (await openPane.getByText(/^\d+ of \d+$/).innerText()).match(/\d+/g) ?? [];
      return [Number(digits[0]), Number(digits[1])];
    };
    const watching = () => new URL(page.url()).searchParams.get('watch');
    const [at, total] = await position();
    expect(total).toBeGreaterThan(1);

    // Right steps forward through the DISPLAYED room, wrapping at the end.
    await page.keyboard.press('ArrowRight');
    await expect.poll(position).toEqual([(at % total) + 1, total]);
    expect(watching()).not.toBe(a.runId);
    // Left walks it back to the exact run we started from — order-following
    // in both directions, not just "something changed".
    await page.keyboard.press('ArrowLeft');
    await expect.poll(position).toEqual([at, total]);
    expect(watching()).toBe(a.runId);

    // A modified press is the browser's own (Cmd+Left is back), not ours.
    await page.keyboard.press('Control+ArrowRight');
    await page.waitForTimeout(400);
    expect(watching()).toBe(a.runId);

    // A focused text field owns its arrow keys: the palette search is the
    // one text field this surface has, and it is also a modal, so the sweep
    // must not fire behind it.
    await page.keyboard.press('Control+KeyK');
    const search = page.getByPlaceholder('Type a command or search…');
    await expect(search).toBeFocused();
    await search.fill('delegate');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    expect(watching()).toBe(a.runId);
    await expect(search).toHaveValue('delegate');
    await page.keyboard.press('Escape');
    await expect(search).toBeHidden();

    // Positive control: focus that is NOT a text field still sweeps, so the
    // guard above is not just "ignore everything focused".
    await page.getByRole('button', { name: `Watch E2E ${STAMP} KeyB` }).focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(position).toEqual([(at % total) + 1, total]);
    expect(watching()).not.toBe(a.runId);
  });

  test('a copied submitted-run link restores read-only in a fresh context', async ({ page, browser }) => {
    const seeded = await startRun(page, SUBMITTED, 's5');
    const submit = await page.request.post('/api/delegate/submit', {
      data: { runId: seeded.runId, answer: MIN_40_WORDS },
    });
    expect(submit.ok()).toBeTruthy();

    await page.goto('/delegate/facilitator');
    const link = await copyRunLink(page, SUBMITTED);

    const receiverContext = await browser.newContext();
    const receiver = await receiverContext.newPage();
    await receiver.goto(link);
    await receiver.getByRole('button', { name: 'Reopen previous session' }).click();

    // Submitted runs restore read-only: the detection result and the
    // scores-reveal notice render, there is no Submit button, and the
    // composer is disabled (placeholder flips to "Scenario submitted").
    await expect(receiver.getByText('Defect detected: your answer named it')).toBeVisible();
    await expect(receiver.getByText('Scores are revealed together')).toBeVisible();
    await expect(receiver.getByRole('button', { name: 'Submit answer' })).toHaveCount(0);
    await expect(receiver.locator('input[placeholder="Scenario submitted"]')).toBeDisabled();

    await receiverContext.close();

    // The row's Open action restores the same read-only view in a tab
    // spawned by the grid itself.
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page
        .getByRole('row')
        .filter({ hasText: SUBMITTED })
        .getByRole('link', { name: `Open run for ${SUBMITTED}` })
        .click(),
    ]);
    await expect(popup.getByPlaceholder('e.g. Jordan')).toBeVisible();
    await popup.getByRole('button', { name: 'Reopen previous session' }).click();
    await expect(popup.getByText('Defect detected: your answer named it')).toBeVisible();
    await expect(popup.locator('input[placeholder="Scenario submitted"]')).toBeDisabled();
    await popup.close();
  });
});

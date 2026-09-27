import { expect, test, type Locator, type Page } from '@playwright/test';

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

    // The verdict is the scorer's own, neither invented nor softened, and
    // the Detection cell behind the pane agrees with it. It rides the same
    // poll as the note, so it cannot lag a beat behind the block it belongs to.
    const state = (await (await page.request.get(`/api/delegate/run/${seeded.runId}/state`)).json()) as {
      detected?: boolean;
      verdict?: boolean | null;
      debriefNote?: string;
    };
    expect(typeof state.detected).toBe('boolean');
    expect(typeof state.verdict).toBe('boolean');
    expect(state.debriefNote ?? '').not.toBe('');

    // innerText collapses the note's newlines, so compare on flattened text.
    const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
    const flatNote = flat(state.debriefNote as string);
    const shown = flat(await result.innerText());
    const verdict = /Detection: (caught it|missed)/.exec(shown);
    expect(verdict, 'the verdict must arrive with the block, not after it').not.toBeNull();
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
    // s5 plants no interception defect, so there is nothing to catch: the
    // grid reports n/a and the endpoint answers verdict:null. The endpoint's
    // separate `detected` boolean stays eager (true) for the participant
    // panel's existing copy — a pane that trusted THAT would read "caught
    // it" directly above a grid cell saying n/a.
    const seeded = await startRun(page, WATCH_NODEFECT, 's5');
    const submit = await page.request.post('/api/delegate/submit', {
      data: { runId: seeded.runId, answer: MIN_40_WORDS },
    });
    expect(submit.ok()).toBeTruthy();

    const state = (await (await page.request.get(`/api/delegate/run/${seeded.runId}/state`)).json()) as {
      detected?: boolean;
      verdict?: boolean | null;
    };
    expect(state.detected).toBe(true); // the participant panel's eager answer
    expect(state.verdict).toBeNull(); // the honest one, which the pane uses

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
    // Advertised only when there is somewhere to step to, and it must
    // advertise the full transport set — a missing key here would mean a
    // binding the pane claims but does not honour. Retried: the pane mounts
    // before the first grid poll fills the room, so the attribute only
    // appears once the sweep can actually go anywhere.
    await expect(openPane).toHaveAttribute('aria-keyshortcuts', /ArrowLeft/);
    const shortcuts = (await openPane.getAttribute('aria-keyshortcuts')) ?? '';
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(shortcuts, `aria-keyshortcuts is missing ${key}`).toContain(key);
    }
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

  test('Home and End jump the sweep to its first and last visible participant', async ({ page }) => {
    // The store accumulates, so the ends of the room are NOT this test's
    // rows: read the first and last displayed row and assert the pane lands
    // on those participants by name, which is what "the ends" means.
    const seeded = await startRun(page, `E2E ${STAMP} Edge`, 's1');
    await startRun(page, `E2E ${STAMP} EdgeB`, 's2');
    await page.goto(`/delegate/facilitator?watch=${seeded.runId}`);

    const firstRow = page.locator('tbody tr').first();
    const lastRow = page.locator('tbody tr').last();
    await expect(firstRow).toBeVisible({ timeout: 15_000 });
    const firstName = await firstRow.locator('td').first().innerText();
    const lastName = await lastRow.locator('td').first().innerText();
    const total = await page.locator('tbody tr').count();
    expect(total).toBeGreaterThan(1);
    // Sweeping is only mounted for a room with more than one row; the
    // deep-linked run is one of them, so the indicator is meaningful.
    const pane = page.locator('section[aria-label^="Watching run for"]');
    const indicator = () => pane.getByText(/^\d+ of \d+$/);
    await expect(indicator()).toBeVisible();

    // End: the LAST participant in the displayed order, counted as such.
    await page.keyboard.press('End');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${lastName}`, { timeout: 10_000 });
    await expect(indicator()).toHaveText(`${total} of ${total}`);

    // Home: the first, from anywhere in the room.
    await page.keyboard.press('Home');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${firstName}`, { timeout: 10_000 });
    await expect(indicator()).toHaveText(`1 of ${total}`);

    // Home/End are keys a text field owns too: the caret must still reach
    // the end of the palette search, with no sweep behind it.
    const before = new URL(page.url()).searchParams.get('watch');
    await page.keyboard.press('Control+KeyK');
    const search = page.getByPlaceholder('Type a command or search…');
    await expect(search).toBeFocused();
    await search.fill('delegate');
    await search.press('End');
    await page.waitForTimeout(400);
    expect(new URL(page.url()).searchParams.get('watch')).toBe(before);
    await expect(search).toHaveValue('delegate');
    await page.keyboard.press('Escape');
  });

  test('j and k walk the grid, and Enter or w watches the row you stopped on', async ({ page }) => {
    // Five stamped rows so the walk has somewhere to go even on a cold
    // store; this execution's rows are not necessarily rows 0-4 once the
    // store has accumulated, so every name is read back off the DOM.
    await startRun(page, `E2E ${STAMP} RowA`, 's1');
    await startRun(page, `E2E ${STAMP} RowB`, 's2');
    await startRun(page, `E2E ${STAMP} RowC`, 's3');
    await startRun(page, `E2E ${STAMP} RowD`, 's4');
    await startRun(page, `E2E ${STAMP} RowE`, 's5');

    await page.goto('/delegate/facilitator');
    const pane = page.locator('section[aria-label^="Watching run for"]');
    // The grid owns these keys, so the table is where they are advertised.
    const table = page.getByRole('table', { name: 'Participants' });
    await expect(table).toHaveAttribute('aria-keyshortcuts', 'j k Enter w');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    const total = await rows.count();
    expect(total).toBeGreaterThan(4);
    const nameAt = async (i: number): Promise<string> =>
      (await rows.nth(i).locator('td').first().innerText()).trim();
    const [secondName, thirdName] = [await nameAt(1), await nameAt(2)];
    // The cursor is the row the walk is on, carried by aria-current because
    // the walk deliberately never moves DOM focus away from the grid's own
    // controls. Exactly one row carries it. A CSS locator, not getByRole:
    // the palette aria-hides the grid while it is open, and the cursor is
    // exactly what has to be checked while that is true.
    const cursored = page.locator('tbody tr[aria-current="true"]');

    // Stage one: the walk is local. j moves the cursor and opens nothing,
    // which is the whole point of splitting the flow in two.
    await expect(pane).toHaveCount(0);
    await page.keyboard.press('j');
    await expect(cursored).toHaveCount(1);
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
    await expect(pane).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('watch')).toBeNull();

    // j/k walk the displayed order in both directions, wrapping at the ends.
    await page.keyboard.press('j');
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(rows.nth(0)).not.toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('k');
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');

    // Stage two: w commits the row the walk stopped on. Still no pane before
    // the commit, and the URL only then carries ?watch=.
    await page.keyboard.press('j');
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('w');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${secondName}`, { timeout: 10_000 });
    await expect(pane.getByText(/^\d+ of \d+$/)).toHaveText(`2 of ${total}`);

    // With the pane open the cursor IS the watch pointer, so the walk keeps
    // sweeping the pane exactly as the arrow keys and the buttons do.
    await page.keyboard.press('j');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${thirdName}`, { timeout: 10_000 });
    await page.keyboard.press('k');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${secondName}`, { timeout: 10_000 });

    // Closing the pane does not lose the place: the cursor stays on the row
    // that was being watched, so the next commit picks up where it left off.
    await page.getByRole('button', { name: 'Close watch pane' }).click();
    await expect(pane).toHaveCount(0);
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');

    // Enter commits it too, and from a cold console it has a target: the
    // first visible row, the same rule j enters on.
    await page.keyboard.press('j');
    await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Enter');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${thirdName}`, { timeout: 10_000 });
    await expect(pane.getByText(/^\d+ of \d+$/)).toHaveText(`3 of ${total}`);

    // Enter inside the grid belongs to the focused control, not the cursor:
    // a focused row button must watch THAT row rather than the cursor's.
    await page.getByRole('button', { name: 'Close watch pane' }).click();
    await expect(pane).toHaveCount(0);
    const otherName = await nameAt(4);
    await rows.nth(4).getByRole('button', { name: `Watch ${otherName}` }).focus();
    await page.keyboard.press('Enter');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${otherName}`, { timeout: 10_000 });
    await expect(rows.nth(4)).toHaveAttribute('aria-current', 'true');

    // Bare letters are the risk of the walk, so the palette gets a real
    // query: the letters must type into the field as normal AND the cursor
    // must not move behind the dialog. The guard protects the sweep, not
    // the keystroke — a focused field still receives its characters.
    const cursorBefore = (await cursored.locator('td').first().innerText()).trim();
    expect(cursorBefore, 'the walk left a cursor to check').toBe(otherName);
    await page.keyboard.press('Control+KeyK');
    const search = page.getByPlaceholder('Type a command or search…');
    await expect(search).toBeFocused();
    await search.fill('jack');
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await page.keyboard.press('w');
    await expect(search).toHaveValue('jackjkw');
    await page.waitForTimeout(400);
    await expect(cursored).toHaveCount(1);
    await expect(cursored.locator('td').first()).toHaveText(cursorBefore);
    await page.keyboard.press('Escape');

    // A genuinely cold console: reload so there is no cursor and nothing
    // watched, which is the state neither key needs teaching in. k enters
    // the walk at the far end and j wraps off it onto the first row —
    // rows.first()/last() rather than an index, because the store keeps
    // accumulating while the suite runs.
    await page.getByRole('button', { name: 'Close watch pane' }).click();
    await expect(pane).toHaveCount(0);
    await page.reload();
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await expect(cursored).toHaveCount(0);
    const coldFirst = await rows.first().locator('td').first().innerText();
    await page.keyboard.press('k');
    await expect(rows.last()).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('j');
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');
    // w from a cold console opens the first row rather than doing nothing:
    // with no cursor to commit, the fallback target is the first visible row.
    await page.keyboard.press('w');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${coldFirst.trim()}`, { timeout: 10_000 });
  });

  test('g then i and g then n jump the walk to the ends of the room', async ({ page }) => {
    // The chained jump (GitHub and Gmail bind `g` then a destination the
    // same way): a chord is the only way to reach the ends of a long room
    // without spending Home and End, which belong to the open pane.
    await startRun(page, `E2E ${STAMP} JumpA`, 's1');
    await startRun(page, `E2E ${STAMP} JumpB`, 's2');

    await page.goto('/delegate/facilitator');
    const pane = page.locator('section[aria-label^="Watching run for"]');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    // CSS locator, not getByRole: the palette aria-hides the grid, and the
    // chord is checked while it is open.
    const cursored = page.locator('tbody tr[aria-current="true"]');
    expect(await rows.count()).toBeGreaterThan(1);

    // g on its own is a prefix, not a command: nothing moves, nothing opens.
    await page.keyboard.press('g');
    await expect(cursored).toHaveCount(0);
    await expect(pane).toHaveCount(0);

    // An unbound second key falls through instead of being swallowed, so
    // g j is not a chord: the walk happens exactly as a bare j would, and
    // the still-armed g cannot eat the j on its way past.
    await page.keyboard.press('j');
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');
    await expect(pane).toHaveCount(0);

    // The pair itself: g n is the far end of the displayed room, g i the
    // near one. A jump moves the cursor and never opens the mirror.
    await page.keyboard.press('g');
    await page.keyboard.press('n');
    await expect(rows.last()).toHaveAttribute('aria-current', 'true');
    await expect(pane).toHaveCount(0);
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');

    // A forgotten prefix lapses, so a stray i a moment later cannot fire
    // a chord the facilitator has stopped thinking about.
    await page.keyboard.press('j');
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('g');
    await page.waitForTimeout(2200);
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(pane).toHaveCount(0);

    // With the pane open the chord moves the watch, like every other key
    // on this surface. Names read fresh: the store keeps accumulating, so
    // the ends of the room are not necessarily where they were above.
    const firstName = (await rows.first().locator('td').first().innerText()).trim();
    const lastName = (await rows.last().locator('td').first().innerText()).trim();
    await page.keyboard.press('w');
    await expect(pane).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('g');
    await page.keyboard.press('n');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${lastName}`, { timeout: 10_000 });
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${firstName}`, { timeout: 10_000 });

    // And the chord is inert where every shortcut is: the letters type into
    // the palette search and the watch does not move behind the dialog.
    const watchBefore = new URL(page.url()).searchParams.get('watch');
    await page.keyboard.press('Control+KeyK');
    const search = page.getByPlaceholder('Type a command or search…');
    await expect(search).toBeFocused();
    await search.fill('jack');
    await search.press('g');
    await search.press('n');
    await expect(search).toHaveValue('jackgn');
    await page.waitForTimeout(400);
    expect(new URL(page.url()).searchParams.get('watch')).toBe(watchBefore);
    await page.keyboard.press('Escape');
  });

  test('the walk says the row it stopped on, and says nothing until it moves', async ({ page }) => {
    // The walk is the one part of this console that is completely silent
    // to a screen reader: it moves a ring and an aria-current, and neither
    // is announced — aria-current is only read when you navigate to the row
    // yourself, and the walk deliberately never moves DOM focus away from
    // the grid controls. So the walk has to speak for itself.
    await startRun(page, `E2E ${STAMP} VoiceA`, 's1');
    await startRun(page, `E2E ${STAMP} VoiceB`, 's2');

    await page.goto('/delegate/facilitator');
    const pane = page.locator('section[aria-label^="Watching run for"]');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    // The screen-reader-only live region, by CSS: the toolbar row carries
    // two status regions on purpose (the walk and the armed-chord chip, so
    // neither re-reads the other), and the sr-only one is this.
    const spoken = page.locator('[role="status"].sr-only');
    await expect(spoken).toHaveCount(1);

    // Quiet on arrival. Nothing has been walked to, so there is nothing to
    // say — a live region that greets a cold console with "the first
    // participant" is a console talking over itself.
    expect(((await spoken.textContent()) ?? '').trim()).toBe('');

    // Participant and status are the two columns that decide pacing, and
    // they are what the announcement is built from. Read off the row: the
    // status cell wraps its word in a span behind a decorative orb, so the
    // word itself is the inner span, not the cell.
    const cellText = async (row: Locator, column: number): Promise<string> => {
      const cell = row.locator('td').nth(column);
      const word = cell.locator('span').last();
      const target = (await word.count()) > 0 ? word : cell;
      return (await target.innerText()).trim();
    };
    const firstName = await cellText(rows.first(), 0);
    const firstStatus = await cellText(rows.first(), 3);
    const lastName = await cellText(rows.last(), 0);
    const lastStatus = await cellText(rows.last(), 3);
    const secondName = await cellText(rows.nth(1), 0);
    const secondStatus = await cellText(rows.nth(1), 3);

    // j enters the walk at the first visible row and says who it is and
    // what state they are in.
    await page.keyboard.press('j');
    await expect(spoken).toHaveText(`${firstName}, ${firstStatus}`);
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');

    // k walks back and the words follow the cursor rather than latching:
    // from the first row it wraps onto the last, and says so.
    await page.keyboard.press('k');
    await expect(spoken).toHaveText(`${lastName}, ${lastStatus}`);
    await expect(rows.last()).toHaveAttribute('aria-current', 'true');

    // A jump announces too: the chord crosses a long room in two
    // keystrokes, and the ear should arrive with the ring.
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await expect(spoken).toHaveText(`${firstName}, ${firstStatus}`);
    await page.keyboard.press('g');
    await page.keyboard.press('n');
    await expect(spoken).toHaveText(`${lastName}, ${lastStatus}`);

    // And so does the open pane's own transport: one walk, one voice, so
    // arrow-sweeping the watched room announces the row it lands on. Open
    // on the first row again, then step to the second.
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await page.keyboard.press('w');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${firstName}`, { timeout: 10_000 });
    await page.keyboard.press('ArrowRight');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${secondName}`, { timeout: 10_000 });
    await expect(spoken).toHaveText(`${secondName}, ${secondStatus}`);

    // The elapsed clock stays out of it. The grid repolls every 4s and
    // every row's clock moves every second, so an announcement built from
    // the whole row would re-speak on every tick and become noise — this
    // is the assertion that keeps it two columns wide.
    await page.waitForTimeout(5_000);
    await expect(spoken).toHaveText(`${secondName}, ${secondStatus}`);
  });

  test('a half-typed chord shows what completes it, and the console forgets on its own', async ({ page }) => {
    // How fast the chip has to be gone before "gone" is believed: inside
    // the 1500ms prefix window, so a chip that only disappears when the
    // lapse timer fires is a failure, not a pass.
    const PROMPT_MS = 500;
    // The affordance half of the chord. A prefix key does nothing on
    // purpose, so without this the press is invisible: nothing moves and
    // nothing opens, and a facilitator cannot tell a chord they have not
    // finished from one the console never heard. The chip names the half
    // that is waiting, and it must not lie in either direction — it
    // appears the moment g arms, it clears the moment the chord resolves
    // OR lapses, and it never appears where the letters are being typed.
    await startRun(page, `E2E ${STAMP} ArmedA`, 's1');
    await startRun(page, `E2E ${STAMP} ArmedB`, 's2');

    await page.goto('/delegate/facilitator');
    const pane = page.locator('section[aria-label^="Watching run for"]');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    // A role filter with a kbd inside, not getByRole('status') alone: the
    // palette aria-hides the toolbar, and the chip has to stay silent
    // there too — which a role-based locator could not see to prove.
    const chip = page.locator('[role="status"]').filter({ has: page.locator('kbd') });
    const cursored = page.locator('tbody tr[aria-current="true"]');
    expect(await rows.count()).toBeGreaterThan(1);

    // At rest: no chip, and no half-typed chord left over from the
    // session that loaded the page. The bound is the point of every
    // toHaveCount(0) here: an unbounded one is satisfied by a chip that
    // finally goes away a second and a half later, which is the LAPSE
    // timer doing the work the assertion is supposed to prove this code
    // did. PROMPT (500ms) is far inside the 1500ms prefix window, so
    // "gone now" cannot quietly become "gone eventually".
    await expect(chip).toHaveCount(0, { timeout: PROMPT_MS });

    // g arms the chord and acts on nothing — but says so, naming both the
    // key that was pressed and every key that completes it. The text is
    // read off the same map the hook dispatches from, so it cannot name a
    // key that is not bound.
    await page.keyboard.press('g');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('g then i or n');
    await expect(chip.locator('kbd')).toHaveText(['g', 'i', 'n']);
    // Announced, not just drawn: the live region is the only way a screen
    // reader learns a chord is half-typed.
    await expect(chip).toHaveAttribute('role', 'status');
    // Still inert — the chip is an announcement, not an action.
    await expect(cursored).toHaveCount(0);
    await expect(pane).toHaveCount(0);

    // Resolving the chord takes the chip down with it.
    await page.keyboard.press('n');
    await expect(chip).toHaveCount(0, { timeout: PROMPT_MS });
    await expect(rows.last()).toHaveAttribute('aria-current', 'true');
    await expect(pane).toHaveCount(0);

    // So does an unbound second key: g j is not a chord, the walk still
    // happens, and the console is no longer waiting for anything. This is
    // the one that matters most — a prefix left armed here would swallow
    // the NEXT key as a chord, which is exactly the bug the bound above
    // is here to catch.
    await page.keyboard.press('g');
    await expect(chip).toBeVisible();
    await page.keyboard.press('j');
    await expect(chip).toHaveCount(0, { timeout: PROMPT_MS });
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');

    // And so does the lapse — the same timer the hook already relies on to
    // stop a forgotten g firing at a stray letter, now visible as the chip
    // going out on its own.
    await page.keyboard.press('g');
    await expect(chip).toBeVisible();
    await page.waitForTimeout(2200);
    await expect(chip).toHaveCount(0);
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    await expect(rows.first()).toHaveAttribute('aria-current', 'true');
    await expect(pane).toHaveCount(0);

    // Inside the palette the letters belong to the field, so no chord arms
    // and no chip appears to describe one.
    await page.keyboard.press('Control+KeyK');
    const search = page.getByPlaceholder('Type a command or search…');
    await expect(search).toBeFocused();
    await search.press('g');
    await expect(chip).toHaveCount(0, { timeout: PROMPT_MS });
    await expect(search).toHaveValue('g');
    await page.keyboard.press('Escape');
    // Wait for the dialog to detach before pressing again: Radix closes it
    // asynchronously, and a key pressed while the input is still focused
    // on its way out belongs to the field, not the grid. The affordance
    // returns WITH the keyboard — the silence inside was the policy, not a
    // dead hint.
    await expect(search).toHaveCount(0);
    await page.keyboard.press('g');
    await expect(chip).toHaveText('g then i or n');
    await page.keyboard.press('Escape');
  });

  test('the saved-views popover shields the room from j, k, and w', async ({ page }) => {
    // A popover is the overlay the sweep must not fire through: it is open
    // on top of the grid, portaled onto the end of <body> rather than
    // nested under its trigger, and taking focus. The policy-level proof
    // of the role-less variant lives in delegate-shortcuts.spec.ts; this
    // is the behaviour, on the panel the console actually ships. Two
    // stamped rows so the sweep has somewhere to go once it is let loose.
    await startRun(page, `E2E ${STAMP} PopA`, 's1');
    await startRun(page, `E2E ${STAMP} PopB`, 's2');

    await page.goto('/delegate/facilitator');
    const pane = page.locator('section[aria-label^="Watching run for"]');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    // Nothing is watched yet, so any pane at all means a key leaked through.
    await expect(pane).toHaveCount(0);

    // exact: the store's accumulated ViewS5-style names contain "views"
    // case-insensitively, and getByRole's default match is a substring.
    await page.getByRole('button', { name: 'Views', exact: true }).click();
    const panel = page.locator('[data-radix-popper-content-wrapper] [data-state="open"]');
    await expect(panel).toBeVisible();
    // What the policy actually matches on, read off the live app rather
    // than assumed. Radix 1.1.23 stamps role="dialog" on popover content
    // whatever its modality, so the saved-views panel is a dialog by the
    // time it reaches the DOM and the dialog clause already covers it; the
    // popper wrapper is the second clause behind it, for a panel that
    // claims no role. Pinned here so the transcribed fixtures in
    // delegate-shortcuts.spec.ts cannot drift from the app silently.
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel).toHaveAttribute('data-state', 'open');

    // Focus is inside the panel (Radix moves it on open), so these land on
    // the panel's own buttons — no field swallows them, and neither the walk
    // nor the commit key may act behind it.
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await page.keyboard.press('w');
    await page.waitForTimeout(400);
    await expect(pane).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('watch')).toBeNull();

    // Positive control: closing the panel hands the keys straight back —
    // the walk moves the cursor, then w opens the pane on it — so the guard
    // above is not simply "ignore the keys while a panel exists".
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await page.keyboard.press('j');
    const firstName = await rows.nth(0).locator('td').first().innerText();
    await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('w');
    await expect(pane).toHaveAttribute('aria-label', `Watching run for ${firstName}`, { timeout: 10_000 });
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

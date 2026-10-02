import { expect, test } from './worker-server';
import type { Page } from '@playwright/test';

/**
 * The grid's render ceiling (GRID_WINDOW in app/delegate/facilitator/page.tsx):
 * a view longer than one page is rendered one page at a time, with a note
 * that names the slice, and the walk is not clipped by it — End still lands
 * on the room's last participant, whose row the window brings on screen, and
 * a shared ?watch= link to a participant past the page still has a row for
 * the mirror to sit behind.
 *
 * Deliberately last in the run: a room longer than a page is reached by
 * starting real runs through the API, and the store is the suite's own (see
 * playwright.config.ts), so those rows stay in the room for whatever runs
 * after this file. They are labelled to sort at the END of the room, which
 * is what keeps that honest — a retry of any earlier spec seeds a row that
 * lands in the first page, so the ceiling cannot be the reason it fails.
 */

/**
 * The ceiling as the console declares it. Pinned rather than imported: the
 * page is a client component and this spec runs in node, so the number is
 * written twice on purpose — moving the ceiling should fail this file
 * loudly rather than leave it quietly measuring something else.
 */
const PAGE = 200;
/** Past the page, so the last page is partial and End has somewhere to land. */
const LONG_ROOM = PAGE + 40;

const MIN_40_WORDS =
  'WHAT I CONCLUDED: The revenue recognition defect was identified and the ' +
  'contract treatment reviewed against the policy. WHAT I CHECKED: I opened ' +
  'the journal entries, the contract document, and the account summaries for ' +
  'the period. WHAT I AM UNSURE ABOUT: Nothing material remains open here.';

const STAMP = Date.now().toString(36).slice(-5);

interface Row {
  participant: string;
  runId?: string;
  status: string;
}

async function startRun(page: Page, participantLabel: string, scenarioId = 's1') {
  const res = await page.request.post('/api/delegate/session', {
    data: { participantLabel, scenarioId },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { sessionId: string; runId: string };
}

/** The room as the API reports it — the same rows the console renders. */
async function room(page: Page): Promise<Row[]> {
  const res = await page.request.get('/api/delegate/facilitator');
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { rows: Row[] }).rows;
}

/** The room in the grid's own default order (participant, ascending). */
async function sortedRoom(page: Page): Promise<Row[]> {
  return (await room(page)).slice().sort((a, b) => a.participant.localeCompare(b.participant));
}

/**
 * Grow the room past one page, idempotently — whichever test runs first pays
 * for it and the rest find it already long.
 */
async function ensureLongRoom(page: Page): Promise<void> {
  const size = (await room(page)).length;
  for (let i = size; i < LONG_ROOM; i += 1) await startRun(page, `zz E2E Window${i} ${STAMP}`);
}

test('a view that fits the page is rendered whole, with no note', async ({ page }) => {
  // The other half of the ceiling: it says nothing while there is nothing to
  // hide. Asserted through a facet rather than by keeping the room small —
  // a long room behind a narrow filter is exactly that case, and it is
  // order-independent: the submitted view is a handful of rows however many
  // working rows the store has accumulated.
  const seeded = await startRun(page, `E2E ${STAMP} WindowWhole`);
  const submit = await page.request.post('/api/delegate/submit', {
    data: { runId: seeded.runId, answer: MIN_40_WORDS },
  });
  expect(submit.ok()).toBeTruthy();

  await page.goto('/delegate/facilitator?status=submitted');
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });

  const view = (await room(page)).filter((r) => r.status === 'submitted').length;
  expect(view).toBeLessThanOrEqual(PAGE);
  await expect(rows).toHaveCount(view);
  await expect(page.locator('#grid-window-note')).toHaveCount(0);
  // Absent, not empty: a description that points at a note which is not
  // there would be worse than no description at all.
  await expect(page.getByRole('table', { name: 'Participants' })).not.toHaveAttribute(
    'aria-describedby',
    /.+/,
  );
});

test('a room longer than the page is rendered one page deep, and says which page', async ({ page }) => {
  await ensureLongRoom(page);
  const total = (await room(page)).length;
  const sorted = await sortedRoom(page);
  expect(total).toBeGreaterThan(PAGE);

  await page.goto('/delegate/facilitator');
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });

  // The page, not the room.
  await expect(rows).toHaveCount(PAGE);
  // The counters still count the room: the ceiling bounds what is drawn,
  // never what the console knows.
  await expect(page.getByText(`${total} of ${total} participants`)).toBeVisible();

  // The note names the slice, and it is the grid's own description rather
  // than a note floating somewhere above it.
  const note = page.locator('#grid-window-note');
  await expect(note).toHaveText(
    `Showing the first ${PAGE} of ${total} participants. j and k walk the whole room.`,
  );
  await expect(page.getByRole('table', { name: 'Participants' })).toHaveAttribute(
    'aria-describedby',
    'grid-window-note',
  );

  // The top of the room is what is on screen, and a participant past the
  // page is not on screen at all — which is the whole reason the note is
  // there rather than silence.
  await expect(rows.first().locator('td').first()).toHaveText(sorted[0].participant);
  const beyond = sorted[PAGE + 10];
  expect(beyond).toBeTruthy();
  await expect(rows.filter({ hasText: beyond.participant })).toHaveCount(0);
});

test('the walk is not clipped by the page: g n still lands on the last participant', async ({ page }) => {
  await ensureLongRoom(page);
  const sorted = await sortedRoom(page);
  const total = sorted.length;
  const first = sorted[0];
  const last = sorted[total - 1];
  const beyond = sorted[PAGE + 10];

  await page.goto('/delegate/facilitator');
  const rows = page.locator('tbody tr');
  const note = page.locator('#grid-window-note');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  // The participant the chord is about to reach starts off screen.
  await expect(rows.filter({ hasText: beyond.participant })).toHaveCount(0);

  // `g n` jumps to the last row of the SWEEP — the room, not the page the
  // grid happens to be showing. Its row is rendered because the window
  // follows the cursor, and on screen because the walk scrolls to whatever
  // it walked to.
  await page.keyboard.press('g');
  await page.keyboard.press('n');
  const cursored = page.locator('tbody tr[aria-current="true"]');
  await expect(cursored).toHaveCount(1, { timeout: 10_000 });
  await expect(cursored.locator('td').first()).toHaveText(last.participant);
  await expect(cursored).toBeInViewport();

  // And the room is still one page deep: the walk moved the window, it did
  // not render the room.
  const rendered = await rows.count();
  expect(rendered).toBeLessThanOrEqual(PAGE);
  expect(rendered).toBeLessThan(total);
  await expect(note).toContainText(`of ${total} participants`);
  await expect(note).not.toHaveText(/^Showing the first/);

  // The same cursor is what Enter commits, so the watch lands on the
  // participant the window brought on screen rather than on whoever happens
  // to be visible, and Home brings the window back to the top of the room
  // with the note back to naming the first page.
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: `Watching run for ${last.participant}` }),
  ).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Home');
  await expect(
    page.getByRole('region', { name: `Watching run for ${first.participant}` }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(note).toHaveText(
    `Showing the first ${PAGE} of ${total} participants. j and k walk the whole room.`,
  );
});

test('a shared watch link to a participant past the page still has a row', async ({ page }) => {
  await ensureLongRoom(page);
  const sorted = await sortedRoom(page);
  const target = sorted[PAGE + 10];
  expect(target?.runId).toBeTruthy();

  await page.goto(`/delegate/facilitator?watch=${target.runId}`);
  const pane = page.getByRole('region', { name: `Watching run for ${target.participant}` });
  await expect(pane).toBeVisible({ timeout: 15_000 });

  // The window follows the cursor, and a deep link makes its run the cursor:
  // the row is rendered although it sorts past the first page, so the mirror
  // has a row behind it and Enter and `g l` act on a participant who is on
  // screen. Arriving still does not scroll — a link leaves the page where
  // the reader found it — so the claim is rendered, not in view.
  const cursored = page.locator('tbody tr[aria-current="true"]');
  await expect(cursored).toHaveCount(1);
  await expect(cursored.locator('td').first()).toHaveText(target.participant);
  expect(await page.locator('tbody tr').count()).toBeLessThanOrEqual(PAGE);
  await expect(page.locator('#grid-window-note')).not.toHaveText(/^Showing the first/);
});

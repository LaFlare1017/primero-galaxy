import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end proof of facilitator saved views (the FinBench pattern
 * applied to the Delegate console): a named status/sort combination is
 * stored in localStorage and later re-applied through the same
 * `?status=`/`?sort=`/`?dir=` pipeline as the facet chips or a deep link.
 *
 * Covered here:
 *   1. the DEFAULT state is savable (unlike FinBench): "Full room" restores
 *      the unfiltered grid after facet filtering
 *   2. a filtered+sorted state replays exactly, including the URL shape
 *      (sort keys validated against the known set on apply)
 *   3. persistence across a reload
 *   4. deletion removes the view from the list and the store
 *   5. a hand-edited store row with an unknown sort key applies safely
 *
 * Seeding follows e2e/facilitator-grid.spec.ts: real runs through POST
 * /api/delegate/session (one submitted via POST /api/delegate/submit) so
 * the pipeline is exercised end to end; assertions scope to the unique
 * per-run labels because the delegate store accumulates across runs.
 * Popover interaction is keyboard-first — portaled fixed-position content
 * (see the FinBench saved-views spec for the full rationale).
 */

const STORE_KEY = 'primero-galaxy:delegate:facilitator:saved-views';

const STAMP = Date.now().toString(36).slice(-5);
const WORKING_A = `E2E ViewA ${STAMP}`;
const WORKING_B = `E2E ViewB ${STAMP}`;
const SUBMITTED_S5 = `E2E ViewS5 ${STAMP}`;

const MIN_40_WORDS =
  'WHAT I CONCLUDED: The revenue recognition defect was identified and the ' +
  'contract treatment reviewed against the policy. WHAT I CHECKED: I opened ' +
  'the journal entries, the contract document, and the account summaries for ' +
  'the period. WHAT I AM UNSURE ABOUT: Nothing material remains open here.';

interface FacilitatorRow {
  participant: string;
  status: string;
}

async function startRun(page: Page, participantLabel: string, scenarioId: string) {
  const res = await page.request.post('/api/delegate/session', {
    data: { participantLabel, scenarioId },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { sessionId: string; runId: string };
}

async function waitUntilSeeded(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const data = (await (await page.request.get('/api/delegate/facilitator')).json()) as {
          rows: FacilitatorRow[];
        };
        return data.rows.filter((r) =>
          [WORKING_A, WORKING_B, SUBMITTED_S5].some((label) => r.participant === label),
        ).length;
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(3);
}

function rowFor(page: Page, participant: string) {
  return page.getByRole('row').filter({ hasText: participant });
}

function viewsDialog(page: Page) {
  return page.getByRole('dialog');
}

function statusParam(page: Page) {
  return new URL(page.url()).searchParams.get('status');
}

/** Text (aria-label, else textContent) of the currently focused element. */
async function focusedText(page: Page): Promise<string> {
  return page.evaluate(() =>
    (
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.textContent ??
      ''
    ).trim(),
  );
}

/** Tab until focus lands on an element whose label/text contains needle. */
async function tabUntil(page: Page, needle: string, maxTabs = 6): Promise<void> {
  for (let i = 0; i <= maxTabs; i++) {
    if ((await focusedText(page)).includes(needle)) return;
    if (i < maxTabs) await page.keyboard.press('Tab');
  }
  throw new Error(`focus never reached an element containing "${needle}"`);
}

/** Open the Views popover; pointer click is safe on the in-flow trigger. */
async function openViews(page: Page) {
  await page.getByRole('button', { name: 'Views' }).click();
  await expect(viewsDialog(page)).toBeVisible();
}

/** Walk focus to "Save current", activate it, and land in the save form. */
async function enterSaveForm(page: Page) {
  await tabUntil(page, 'Save current');
  await page.keyboard.press('Enter');
  const nameInput = viewsDialog(page).getByLabel('View name');
  await expect(nameInput).toBeFocused();
  return nameInput;
}

/** Save the live state under `name` and end in list mode. */
async function saveViewByName(page: Page, name: string) {
  await openViews(page);
  await enterSaveForm(page);
  const dialog = viewsDialog(page);
  await page.keyboard.insertText(name);
  await page.keyboard.press('Enter');
  await expect(dialog.getByText(name)).toBeVisible();
}

/** Apply the named view from the list via keyboard (walk + Enter). */
async function applyView(page: Page, name: string) {
  await tabUntil(page, name);
  await page.keyboard.press('Enter');
}

test.describe('Facilitator saved views', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await startRun(page, WORKING_A, 's1');
    await startRun(page, WORKING_B, 's2');
    const seeded = await startRun(page, SUBMITTED_S5, 's5');
    const submit = await page.request.post('/api/delegate/submit', {
      data: { runId: seeded.runId, answer: MIN_40_WORDS },
    });
    expect(submit.ok()).toBeTruthy();
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/delegate/facilitator');
    await waitUntilSeeded(page);
    await page.evaluate((key) => window.localStorage.removeItem(key), STORE_KEY);
    await page.reload();
    await waitUntilSeeded(page);
  });

  test('the default state is savable: a named full-room view restores the unfiltered grid', async ({ page }) => {
    // No facets active: the save form previews the default summary.
    await openViews(page);
    await enterSaveForm(page);
    await expect(viewsDialog(page).getByText('all statuses')).toBeVisible();
    await page.keyboard.insertText('Full room');
    await page.keyboard.press('Enter');
    await expect(viewsDialog(page).getByText('Full room')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewsDialog(page)).toBeHidden();

    // Filter to working only, then restore the full room from the view.
    await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^working/ }).click();
    await expect
      .poll(() => statusParam(page), { timeout: 5_000 })
      .toBe('working');
    await expect(rowFor(page, SUBMITTED_S5)).toHaveCount(0);

    await openViews(page);
    await applyView(page, 'Full room');
    await expect(rowFor(page, SUBMITTED_S5)).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => statusParam(page), { timeout: 5_000 })
      .toBe(null);
  });

  test('a filtered and sorted state replays exactly, including the URL shape', async ({ page }) => {
    await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^working/ }).click();
    await expect
      .poll(() => statusParam(page), { timeout: 5_000 })
      .toBe('working');
    await page.getByRole('button', { name: 'Sort by Elapsed' }).click();
    await page.getByRole('button', { name: 'Sort by Elapsed' }).click();
    await expect
      .poll(
        () => {
          const params = new URL(page.url()).searchParams;
          return `${params.get('status')}|${params.get('sort')}|${params.get('dir')}`;
        },
        { timeout: 5_000 },
      )
      .toBe('working|elapsedSeconds|desc');

    await saveViewByName(page, 'Elapsed watch');
    await page.keyboard.press('Escape');
    await expect(viewsDialog(page)).toBeHidden();

    // Reset everything through the UI paths, then replay from the view.
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect
      .poll(() => statusParam(page), { timeout: 5_000 })
      .toBe(null);

    await openViews(page);
    await applyView(page, 'Elapsed watch');
    await expect
      .poll(
        () => {
          const params = new URL(page.url()).searchParams;
          return `${params.get('status')}|${params.get('sort')}|${params.get('dir')}`;
        },
        { timeout: 5_000 },
      )
      .toBe('working|elapsedSeconds|desc');
    await expect(rowFor(page, WORKING_A)).toBeVisible();
    await expect(rowFor(page, SUBMITTED_S5)).toHaveCount(0);
  });

  test('views persist across reloads', async ({ page }) => {
    await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^working/ }).click();
    await expect
      .poll(() => statusParam(page), { timeout: 5_000 })
      .toBe('working');
    await saveViewByName(page, 'Reload survivor');
    await page.keyboard.press('Escape');

    await page.reload();
    await waitUntilSeeded(page);

    await openViews(page);
    await expect(viewsDialog(page).getByText('Reload survivor')).toBeVisible();
    await applyView(page, 'Reload survivor');
    await expect
      .poll(() => statusParam(page), { timeout: 5_000 })
      .toBe('working');
  });

  test('a view can be deleted', async ({ page }) => {
    await saveViewByName(page, 'Doomed view');

    const dialog = viewsDialog(page);
    // Focus walks the popover: row apply button → row delete button.
    await tabUntil(page, 'Delete view Doomed view');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('No saved views yet')).toBeVisible();

    const stored = await page.evaluate(
      (key) => JSON.parse(window.localStorage.getItem(key) ?? '[]'),
      STORE_KEY,
    );
    expect(stored).toEqual([]);
  });

  test('a hand-edited store row with an unknown sort key applies safely', async ({ page }) => {
    // The store is plain localStorage; a stale/hand-edited view must not
    // crash the page or push a bogus key into the URL.
    await page.evaluate(
      ([key, view]) => window.localStorage.setItem(key, view),
      [
        STORE_KEY,
        JSON.stringify([
          {
            id: 'bogus-1',
            name: 'Bogus sort',
            view: { status: ['working'], sort: 'bogus', dir: 'desc' },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]),
      ],
    );
    await page.reload();
    await waitUntilSeeded(page);

    await openViews(page);
    await applyView(page, 'Bogus sort');
    // Status replays; the unknown sort is rejected → default (dropped from
    // the URL by clearOnDefault) and the grid stays rendered.
    await expect
      .poll(() => statusParam(page), { timeout: 5_000 })
      .toBe('working');
    expect(new URL(page.url()).searchParams.get('sort')).toBeNull();
    await expect(rowFor(page, WORKING_A)).toBeVisible();
    await expect(rowFor(page, SUBMITTED_S5)).toHaveCount(0);
  });
});

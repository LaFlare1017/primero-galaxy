import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end proof of the facilitator console (handoff §7): the live grid
 * built on the Circle-extracted table primitives, with client-side status
 * facets and column sorting over the polled rows.
 *
 * Seeding: the suite starts REAL runs through POST /api/delegate/session —
 * the same API the participant page calls — so the facilitator pipeline
 * (EventLog → /api/delegate/facilitator → poll → render) is exercised
 * end-to-end, never with fixtures. One seeded participant is submitted
 * through POST /api/delegate/submit (a >40-word answer, server-gated) to
 * produce a "submitted" status next to the default "working" rows.
 *
 * The store (delegate/data/*.json) is shared and accumulates rows from
 * every prior e2e/dev session, so all assertions are scoped to the seeded
 * participants' labels (a random suffix per run) or derived arithmetically
 * (faceted counts, filtered vs total). Rows never disappear — the suite
 * asserts against seeded rows only, and cleans nothing up: the store is a
 * workshop artifact (reset.sh / alpha:reset own it).
 */

/** Unique-per-run labels so assertions survive a shared, accumulating store. */
const STAMP = Date.now().toString(36).slice(-5);
const WORKING_A = `E2E FacetA ${STAMP}`;
const WORKING_B = `E2E FacetB ${STAMP}`;
const SUBMITTED_S5 = `E2E FacetS5 ${STAMP}`;
const SUBMITTED_S3 = `E2E FacetS3 ${STAMP}`;

const MIN_40_WORDS =
  'WHAT I CONCLUDED: The revenue recognition defect was identified and the ' +
  'contract treatment reviewed against the policy. WHAT I CHECKED: I opened ' +
  'the journal entries, the contract document, and the account summaries for ' +
  'the period. WHAT I AM UNSURE ABOUT: Nothing material remains open here.';

const MIN_40_WORDS_S3 =
  'WHAT I CONCLUDED: The Q1 commentary drafts were reviewed against the ' +
  'underlying accounts and the totals reconcile to the ledger. WHAT I ' +
  'CHECKED: I walked the account balances and the reported movements for the ' +
  'quarter. WHAT I AM UNSURE ABOUT: Nothing further is open at this time.';

interface FacilitatorRow {
  participant: string;
  status: string;
  elapsedSeconds: number;
  detected?: boolean;
}

/** Start a run through the real API and return its session id. */
async function startRun(page: Page, participantLabel: string, scenarioId: string) {
  const res = await page.request.post('/api/delegate/session', {
    data: { participantLabel, scenarioId },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { sessionId: string; runId: string };
}

/** Wait until the facilitator API reports all three seeded participants. */
async function waitUntilSeeded(page: Page): Promise<FacilitatorRow[]> {
  let rows: FacilitatorRow[] = [];
  await expect
    .poll(
      async () => {
        const data = (await (await page.request.get('/api/delegate/facilitator')).json()) as {
          rows: FacilitatorRow[];
        };
        rows = data.rows;
        return rows.filter((r) =>
          [WORKING_A, WORKING_B, SUBMITTED_S5, SUBMITTED_S3].some((label) => r.participant === label)
        ).length;
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] }
    )
    .toBe(4);
  return rows;
}

/** Locator for the (single) grid row of a participant. */
function rowFor(page: Page, participant: string) {
  return page.getByRole('row').filter({ hasText: participant });
}

test.describe('Facilitator console', () => {
  test.beforeAll(async ({ browser }) => {
    // Seed through the real APIs (request context, no page needed).
    const page = await browser.newPage();
    await startRun(page, WORKING_A, 's1');
    await startRun(page, WORKING_B, 's2');
    const seededS5 = await startRun(page, SUBMITTED_S5, 's5');
    const submitS5 = await page.request.post('/api/delegate/submit', {
      data: { runId: seededS5.runId, answer: MIN_40_WORDS },
    });
    expect(submitS5.ok()).toBeTruthy();
    const seededS3 = await startRun(page, SUBMITTED_S3, 's3');
    const submitS3 = await page.request.post('/api/delegate/submit', {
      data: { runId: seededS3.runId, answer: MIN_40_WORDS_S3 },
    });
    expect(submitS3.ok()).toBeTruthy();
    await page.close();
  });

  test('grid renders the seeded participants with their statuses', async ({ page }) => {
    await page.goto('/delegate/facilitator');
    await expect(page.getByRole('heading', { name: 'Delegate · Facilitator' })).toBeVisible();
    await waitUntilSeeded(page);

    // Working rows show the gray status text; the submitted row is the
    // emphasized black text (weight, not color — Delegate is monochrome).
    const workingRow = await rowFor(page, WORKING_A);
    await expect(workingRow).toContainText('working');
    await expect(workingRow).toContainText('1 · Bank recon');
    const submittedRow = await rowFor(page, SUBMITTED_S5);
    await expect(submittedRow).toContainText('submitted');
    await expect(submittedRow).toContainText('5 · Revenue recognition');
    // s5 has no planted defect, so detection is legitimately n/a — the grid
    // never invents a verdict (event-sourced, nothing inferred).
    await expect(submittedRow).toContainText('n/a');

    // s3 HAS a planted defect: the detection cell shows the scorer's
    // verdict (either way — the suite does not grade the mock answer).
    const detectedRow = await rowFor(page, SUBMITTED_S3);
    await expect(detectedRow).toContainText(/caught it|missed/);
    await expect(detectedRow).toContainText('submitted');
  });

  test('status facet chips show counts and toggle selection', async ({ page }) => {
    await page.goto('/delegate/facilitator');
    await waitUntilSeeded(page);

    const group = page.getByRole('group', { name: 'Filter by status' });
    const workingChip = group.getByRole('button', { name: /^working/ });
    const submittedChip = group.getByRole('button', { name: /^submitted/ });
    const statusParam = () => new URL(page.url()).searchParams.get('status');

    // Faceted counts: every seeded status must be represented at least by
    // its seeded rows (the store accumulates, so these are lower bounds).
    const workingCount = Number(await workingChip.locator('span').innerText());
    const chipSubmittedCount = Number(await submittedChip.locator('span').innerText());
    expect(workingCount).toBeGreaterThanOrEqual(2);
    expect(chipSubmittedCount).toBeGreaterThanOrEqual(2);

    // The exact number of submitted participants in the store, straight
    // from the API — filtering to "working" must hide exactly this many.
    const submittedRowsInStore = (
      (await (await page.request.get('/api/delegate/facilitator')).json()) as { rows: FacilitatorRow[] }
    ).rows.filter((r) => r.status === 'submitted').length;
    expect(submittedRowsInStore).toBeGreaterThanOrEqual(2);

    // Nothing selected → all participants visible, and the URL carries NO
    // status param (the default view shares as a clean link).
    const counter = page.getByText(/\d+ of \d+ participants/);
    const total = Number((await counter.innerText()).match(/of (\d+)/)![1]);
    await expect(counter).toHaveText(`${total} of ${total} participants`);
    expect(statusParam()).toBeNull();

    // Select "working": rows shrink by exactly the submitted count, the
    // chip flips to pressed (black/white treatment), and the selection
    // lands in the URL.
    await workingChip.click();
    await expect(workingChip).toHaveAttribute('aria-pressed', 'true');
    await expect(workingChip).toHaveClass(/bg-black/);
    const totalRows = page.getByRole('row');
    const submittedCount = submittedRowsInStore;
    await expect(page.getByText(`${total - submittedCount} of ${total} participants`)).toBeVisible();
    await expect(totalRows).toHaveCount(1 + (total - submittedCount)); // header + rows
    await expect(page.getByRole('row').filter({ hasText: SUBMITTED_S5 })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: SUBMITTED_S3 })).toHaveCount(0);
    await expect
      .poll(() => statusParam(), { timeout: 5_000 })
      .toBe('working');

    // Deselecting the LAST chip is an explicit all-none state: the grid
    // empties (by design) and the param survives as an empty ?status=,
    // still shareable — with Clear as the escape hatch.
    await workingChip.click();
    await expect(workingChip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(`0 of ${total} participants`)).toBeVisible();
    await expect
      .poll(() => statusParam(), { timeout: 5_000 })
      .toBe('');
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();

    // Clear removes the param entirely: back to the full room.
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText(`${total} of ${total} participants`)).toBeVisible();
    await expect
      .poll(() => statusParam(), { timeout: 5_000 })
      .toBe(null);

    // Selecting two facets unions them; the comma list is sorted for a
    // stable URL regardless of click order.
    await workingChip.click();
    await submittedChip.click();
    await expect(submittedChip).toHaveAttribute('aria-pressed', 'true');
    await expect(workingChip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(`${total} of ${total} participants`)).toBeVisible();
    await expect
      .poll(() => statusParam(), { timeout: 5_000 })
      .toBe('submitted,working');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(workingChip).toHaveAttribute('aria-pressed', 'false');
    await expect(submittedChip).toHaveAttribute('aria-pressed', 'false');
  });

  test('Clear appears only while a facet is active', async ({ page }) => {
    await page.goto('/delegate/facilitator');
    await waitUntilSeeded(page);

    const clear = page.getByRole('button', { name: 'Clear' });
    await expect(clear).toHaveCount(0);
    await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^working/ }).click();
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(clear).toHaveCount(0);
  });

  test('sorting state lands in ?sort=/?dir= and defaults drop out', async ({ page }) => {
    await page.goto('/delegate/facilitator');
    await waitUntilSeeded(page);

    const urlParam = (name: string) => new URL(page.url()).searchParams.get(name);

    // Default is participant ascending, so the first Participant click
    // flips to DESC. nuqs clearOnDefault drops ?sort= even when SET to the
    // default value, so only the direction survives in the URL…
    await page.getByRole('button', { name: 'Sort by Participant' }).click();
    await expect
      .poll(() => urlParam('dir'), { timeout: 5_000 })
      .toBe('desc');
    await expect
      .poll(() => urlParam('sort'), { timeout: 5_000 })
      .toBe(null);

    // …and the second click returns to the default ascending, which also
    // drops out — an unsorted view shares as a param-free link.
    await page.getByRole('button', { name: 'Sort by Participant' }).click();
    await expect
      .poll(() => `${urlParam('sort')}|${urlParam('dir')}`, { timeout: 5_000 })
      .toBe('null|null');

    // A non-default key keeps ?sort= (asc is the default direction, so
    // ?dir= drops out); the second click adds dir=desc.
    await page.getByRole('button', { name: 'Sort by Elapsed' }).click();
    await expect(page).toHaveURL(/sort=elapsedSeconds/, { timeout: 5_000 });
    await expect
      .poll(() => urlParam('dir'), { timeout: 5_000 })
      .toBe(null);
    await page.getByRole('button', { name: 'Sort by Elapsed' }).click();
    await expect
      .poll(() => `${urlParam('sort')}|${urlParam('dir')}`, { timeout: 5_000 })
      .toBe('elapsedSeconds|desc');
  });

  test('a deep link with ?status=/?sort=/?dir= reproduces the shared view', async ({ page }) => {
    // Open DIRECTLY on a shared view: submitted only, oldest first.
    await page.goto('/delegate/facilitator?status=submitted&sort=elapsedSeconds&dir=desc');
    await waitUntilSeeded(page);

    // Chips reflect the URL state (pressed only for submitted).
    const group = page.getByRole('group', { name: 'Filter by status' });
    await expect(group.getByRole('button', { name: /^submitted/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(group.getByRole('button', { name: /^working/ })).toHaveAttribute('aria-pressed', 'false');

    // Only submitted rows render: the working seeds are filtered out.
    await expect(rowFor(page, WORKING_A)).toHaveCount(0);
    await expect(rowFor(page, WORKING_B)).toHaveCount(0);
    await expect(rowFor(page, SUBMITTED_S5)).toHaveCount(1);
    await expect(rowFor(page, SUBMITTED_S3)).toHaveCount(1);

    // The counter matches the API's submitted count exactly.
    const api = (await (await page.request.get('/api/delegate/facilitator')).json()) as {
      rows: FacilitatorRow[];
    };
    const submittedInStore = api.rows.filter((r) => r.status === 'submitted').length;
    await expect(
      page.getByText(`${submittedInStore} of ${api.rows.length} participants`)
    ).toBeVisible();

    // The desc sort applied: the OLDEST SUBMITTED participant sits on top
    // (the anchor must come from the filtered set — the oldest row overall
    // is a working session that ?status=submitted filters out).
    const submittedRows = api.rows.filter((r) => r.status === 'submitted');
    const oldest = submittedRows.reduce((a, b) => (b.elapsedSeconds > a.elapsedSeconds ? b : a))
      .participant;
    await expect(page.getByRole('row').nth(1)).toContainText(oldest);

    // The shared URL survives the round-trip (copy-paste stable).
    const params = new URL(page.url()).searchParams;
    expect(params.get('status')).toBe('submitted');
    expect(params.get('sort')).toBe('elapsedSeconds');
    expect(params.get('dir')).toBe('desc');
  });

  test('an unknown ?status= value filters to the empty grid without crashing', async ({ page }) => {
    await page.goto('/delegate/facilitator?status=bogus&sort=nope');
    await waitUntilSeeded(page);

    // Unknown status: the filter matches nothing → explicit empty grid.
    await expect(page.getByText(/0 of \d+ participants/)).toBeVisible();
    // Unknown sort key: the parser falls back to the default (no crash,
    // table still renders its header).
    await expect(page.getByRole('row').nth(0)).toBeVisible();
  });

  test('new sessions stream in via the 4s poll without a reload', async ({ page }) => {
    await page.goto('/delegate/facilitator');
    await waitUntilSeeded(page);

    const lateLabel = `E2E Late ${STAMP}`;
    // Total participants straight from the rendered counter (row counts
    // would include the header row).
    const before = Number(
      (await page.getByText(/\d+ of \d+ participants/).innerText()).match(/(\d+) of/)![1]
    );

    // Seed AFTER the page is open: the 4s poll must pick it up on its own.
    await startRun(page, lateLabel, 's3');

    const lateRow = await rowFor(page, lateLabel);
    await expect(lateRow).toBeVisible({ timeout: 15_000 });
    await expect(lateRow).toContainText('3 · Q1 flux');

    // The counter grew by exactly one row.
    await expect(page.getByText(`${before + 1} of ${before + 1} participants`)).toBeVisible();
  });
});

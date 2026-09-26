import { expect, test } from '@playwright/test';

/**
 * End-to-end proof of the FinBench run-records filter engine (the Circle
 * data-table-filter port) and its URL-synced deep links (nuqs, ?filters=).
 *
 * The FiltersState JSON in the URL is the shareable format: a saved link or
 * a pasted filter string must reproduce the exact filtered view, including
 * operators the UI can express but users will type by hand ("is not", "is
 * between" over 0–1 fractions). The suite:
 *
 *   1. boots the default view: all runs, no filter chips
 *   2. deep-links ?filters=[{"columnId":"result","operator":"is not",…}]
 *      → chip shows the operator + option label, table keeps only non-miss
 *      runs, and the deep link stays intact
 *   3. deep-links an "is" filter for the single numeric miss and proves the
 *      row itself is the expected one (result badge + 0% groundedness)
 *   4. deep-links a numeric "is between" [0, 0.5] over 0–1 fractions
 *   5. drives the UI end-to-end: Filter popover → Result → "numeric miss"
 *      produces the same URL the deep link carries (deep links stay
 *      copy-paste stable)
 *   6. a garbage ?filters= value degrades to the unfiltered view (parser
 *      returns null → engine default), never a crash
 *   7. removing a chip updates the URL immediately
 *
 * Snapshot facts (public/finbench/asc606.json): 14 runs, 1 numeric miss
 * (asc606-modification-003, groundedness 0), all latencies equal so sorting
 * is not asserted here; groundedness/citation/structure scores are 0–1
 * fractions rendered as percentages.
 */

const TASK_COL = 'td.font-mono.text-\\[12\\.5px\\]';

/**
 * The /finbench page also renders the category × model matrix table, so
 * every row/count assertion must scope to the RunsTable (the one whose
 * header carries the "Result" column).
 */
function runsTable(page: import('@playwright/test').Page) {
  return page
    .locator('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Result', exact: true }) });
}
function runsRows(page: import('@playwright/test').Page) {
  return runsTable(page).locator('tbody tr');
}
/** The active-filter chip root (rounded-2xl pill: subject/operator/value/✕). */
function chipRoot(page: import('@playwright/test').Page) {
  return page.locator('div.rounded-2xl');
}

/** The ?filters= value for a filter, URL-encoded (nuqs round-trips JSON). */
function filtersParam(filter: object): string {
  return encodeURIComponent(JSON.stringify([filter]));
}

async function gotoWithFilters(page: import('@playwright/test').Page, filter: object) {
  await page.goto(`/finbench?filters=${filtersParam(filter)}`);
  // The counter renders only after the client component hydrates with the
  // URL state applied; rows render in the same commit.
  await expect(page.getByText('of 14 runs')).toBeVisible();
}

test('default view: all runs, no filter chips', async ({ page }) => {
  await page.goto('/finbench');
  await expect(page.getByText('of 14 runs')).toBeVisible();
  await expect(runsRows(page)).toHaveCount(14);
  // No active filter chips and no Clear button (FilterActions hides it
  // entirely when there are no filters).
  await expect(page.locator('table tbody tr', { hasText: 'asc606-' }).first()).toBeVisible();
});

test('"is not" deep link: chip renders the operator and the table keeps only passes', async ({ page }) => {
  await gotoWithFilters(page, {
    columnId: 'result',
    type: 'option',
    operator: 'is not',
    values: ['miss'],
  });

  // 13 of 14 runs survive (the one miss drops out).
  await expect(page.getByText('13 of 14 runs')).toBeVisible();
  await expect(runsRows(page)).toHaveCount(13);

  // The active chip shows subject / operator / value.
  const chip = chipRoot(page);
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText('Result');
  await expect(chip).toContainText('is not');
  await expect(chip).toContainText('numeric miss');

  // No miss badge anywhere in the filtered table.
  await expect(runsRows(page).filter({ hasText: 'miss' })).toHaveCount(0);

  // The deep link survives the state round-trip (copy-paste stable).
  expect(new URL(page.url()).searchParams.get('filters')).toBe(
    JSON.stringify([{ columnId: 'result', type: 'option', operator: 'is not', values: ['miss'] }])
  );
});

test('"is" deep link for the one miss resolves to the expected run row', async ({ page }) => {
  await gotoWithFilters(page, {
    columnId: 'result',
    type: 'option',
    operator: 'is',
    values: ['miss'],
  });

  await expect(page.getByText('1 of 14 runs')).toBeVisible();
  const rows = runsRows(page);
  await expect(rows).toHaveCount(1);
  const row = rows.first();
  await expect(row).toContainText('asc606-modification-003');
  await expect(row).toContainText('modification');
  // The miss badge is rendered as "miss"; this run's groundedness is 0
  // (citations/structure are 1), so exactly one 0% cell sits in the row.
  await expect(row.getByText('miss', { exact: true })).toBeVisible();
  await expect(row.locator('td', { hasText: /^0%$/ })).toHaveCount(1);
});

test('numeric "is between" deep link over 0–1 fractions', async ({ page }) => {
  await gotoWithFilters(page, {
    columnId: 'groundedness_score',
    type: 'number',
    operator: 'is between',
    values: [0, 0.5],
  });

  // Scores are fractions (0–1): [0, 0.5] keeps the single 0% run.
  await expect(page.getByText('1 of 14 runs')).toBeVisible();
  const rows = runsRows(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('asc606-modification-003');
  // The chip's number display renders min and max.
  await expect(rows.first()).toContainText('0%');
});

test('driving the UI produces the same URL format as the deep links', async ({ page }) => {
  await page.goto('/finbench');
  await expect(page.getByText('of 14 runs')).toBeVisible();

  // Open the Filter popover; the subject search input takes focus.
  await page.getByRole('button', { name: 'Filter' }).click();
  const subjectSearch = page.getByPlaceholder('Search...');
  await expect(subjectSearch).toBeFocused();

  // Keyboard-first cmdk flow: type to filter the subject list, Enter picks
  // the highlighted item. (The popover content is fixed-position and can
  // extend below the fold, so pointer clicks on items are not reliable —
  // keyboard is cmdk's native interaction model.)
  //
  // The search is a CONTROLLED cmdk value, so the typed text must
  // round-trip through React state before Enter: cmdk selects whatever is
  // highlighted at keypress time, and a race would pick the stale default
  // highlight. Wait until the list has narrowed to exactly one visible
  // item — the round-trip proof and the unique Enter target in one.
  await subjectSearch.fill('Result');
  await expect(page.locator('[cmdk-item]:visible', { hasText: 'Result' })).toHaveCount(1);
  await subjectSearch.press('Enter');

  // The value view mounts with its own autofocused search (same
  // placeholder); its option rows exist only there, so their visibility
  // proves the swap completed. Drive the SELECTION, not the search: cmdk's
  // subsequence filter matches both options ("miss" is a subsequence of
  // "numeric pass") and a fill can land mid-swap in the dying subject
  // input. ArrowDown until the miss option is the selected one, then Enter
  // toggles exactly that row.
  const valueSearch = page.getByPlaceholder('Search...');
  await expect(valueSearch).toBeFocused();
  await expect(page.locator('[cmdk-item]', { hasText: 'miss' })).toBeVisible();
  await expect(async () => {
    const selected = page.locator('[cmdk-item][data-selected="true"]');
    if (!(await selected.innerText()).includes('miss')) {
      await valueSearch.press('ArrowDown');
    }
    await expect(selected).toHaveText(/miss/);
  }).toPass({ timeout: 10_000 });
  await valueSearch.press('Enter');

  // The same view the deep link produces…
  await expect(page.getByText('1 of 14 runs')).toBeVisible();
  await expect(runsRows(page)).toHaveCount(1);

  // …and the same serialized URL (the shareable contract).
  expect(new URL(page.url()).searchParams.get('filters')).toBe(
    JSON.stringify([{ columnId: 'result', type: 'option', operator: 'is', values: ['miss'] }])
  );
});

test('garbage ?filters= degrades to the unfiltered view', async ({ page }) => {
  await page.goto(`/finbench?filters=${encodeURIComponent('not-json{')}`);
  // The parser returns null → the engine default ([]) applies; the page
  // must render the full table, not an error boundary.
  await expect(page.getByText('of 14 runs')).toBeVisible();
  await expect(runsRows(page)).toHaveCount(14);
});

test('removing a filter chip clears the URL param immediately', async ({ page }) => {
  await gotoWithFilters(page, {
    columnId: 'result',
    type: 'option',
    operator: 'is',
    values: ['miss'],
  });
  await expect(page.getByText('1 of 14 runs')).toBeVisible();

  // The chip's trailing ✕ button (FilterValue remove → actions.removeFilter).
  await chipRoot(page).getByRole('button').last().click();

  await expect(page.getByText('14 of 14 runs')).toBeVisible();
  await expect(runsRows(page)).toHaveCount(14);
  expect(new URL(page.url()).searchParams.get('filters')).toBeNull();
});

test('filter popover exposes all eight filterable columns', async ({ page }) => {
  await page.goto('/finbench');
  await expect(page.getByText('of 14 runs')).toBeVisible();

  await page.getByRole('button', { name: 'Filter' }).click();
  for (const name of ['Model', 'Result', 'Task', 'Judge rationale', 'Latency', 'Groundedness', 'Citation validity', 'Structure']) {
    await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
  }
});

test('sorting by Task header reorders the rows and lands in the URL', async ({ page }) => {
  await page.goto('/finbench');
  await expect(page.getByText('of 14 runs')).toBeVisible();

  const urlParam = (name: string) => new URL(page.url()).searchParams.get(name);
  const firstTask = () => page.locator(`${TASK_COL} >> nth=0`).innerText();
  const asc = await firstTask();

  // First click: the Task button IS active at the default (task_id, asc),
  // so it flips to descending — only ?dir= survives (the default key never
  // appears in the URL).
  await page.getByRole('button', { name: 'Sort by Task' }).click();
  expect(await firstTask()).not.toBe(asc);
  await expect.poll(() => urlParam('dir'), { timeout: 5_000 }).toBe('desc');
  expect(urlParam('sort')).toBeNull();

  // A non-default key keeps ?sort= (asc drops ?dir=); the second click
  // adds dir=desc.
  await page.getByRole('button', { name: 'Sort by Latency' }).click();
  await expect.poll(() => urlParam('sort'), { timeout: 5_000 }).toBe('latency_ms');
  await expect.poll(() => urlParam('dir'), { timeout: 5_000 }).toBe(null);
  await page.getByRole('button', { name: 'Sort by Latency' }).click();
  await expect
    .poll(() => `${urlParam('sort')}|${urlParam('dir')}`, { timeout: 5_000 })
    .toBe('latency_ms|desc');

  // The sort is state, not a one-shot import: the params survive a reload.
  await page.reload();
  await expect(page.getByText('of 14 runs')).toBeVisible();
  expect(urlParam('sort')).toBe('latency_ms');
  expect(urlParam('dir')).toBe('desc');
});

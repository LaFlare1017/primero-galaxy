import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end proof of FinBench saved views (Circle's Views pattern adapted
 * to the run explorer): a named filter combination is stored in
 * localStorage and later re-applied through the same nuqs ?filters=
 * pipeline as a hand-built or deep-linked filter set.
 *
 * Covered here:
 *   1. save-from-current-filters → list row with a filter summary, active
 *      check while the filters match, and re-apply through the URL
 *   2. persistence across a reload (localStorage-backed)
 *   3. views never cross benchmark tracks (asc606 view absent on govcon)
 *   4. deletion removes the view from the list and the store
 *   5. "Save current" is guarded: disabled when no filters are active
 *
 * Interaction model: like the cmdk Filter popover on this page, the
 * SavedViews popover is fixed-position (Portal + position: fixed) and
 * reliably reachable via keyboard (Radix focuses its content, and key
 * events are delivered to the focused element regardless of viewport
 * geometry) but NOT via pointer clicks after an auto-scroll, which can
 * freeze the popover at a stale anchor off-viewport. So the spec is
 * keyboard-first — the same convention e2e/finbench-filters.spec.ts
 * established — and pointer clicks are reserved for elements that stay
 * inside the document flow (the filter-chip ✕).
 *
 * The runs table is scoped via its "Result" column header — the /finbench
 * page also renders the category × model matrix table. The store key is
 * cleaned in beforeEach so tests are order-independent.
 */

const STORE_KEY = 'primero-galaxy:finbench:saved-views';

function runsRows(page: Page) {
  return page
    .locator('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Result', exact: true }) })
    .locator('tbody tr');
}

function counter(page: Page) {
  return page.getByText(/\d+ of \d+ runs/);
}

/** The open SavedViews popover (Radix renders it as a dialog). */
function viewsDialog(page: Page) {
  return page.getByRole('dialog');
}

/** Deep-link a filter, as a user sharing a URL would. */
async function gotoWithMissFilter(page: Page) {
  const filters = encodeURIComponent(
    JSON.stringify([{ columnId: 'result', type: 'option', operator: 'is', values: ['miss'] }]),
  );
  await page.goto(`/finbench?filters=${filters}`);
  await expect(counter(page)).toHaveText('1 of 14 runs');
}

/** Open the Views popover; pointer click is safe on the in-flow trigger. */
async function openViews(page: Page) {
  await page.getByRole('button', { name: 'Views' }).click();
  const dialog = viewsDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/views$/)).toBeVisible(); // "ASC 606 views"
  return dialog;
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

/**
 * Advance keyboard focus with Tab until the focused element's label/text
 * contains `needle`, bounded by `maxTabs`. Radix's focus anchor inside a
 * freshly-opened popover is the content container, so the number of Tab
 * stops to a target control varies with popover state; walking until a
 * match keeps the tests robust.
 */
async function tabUntil(page: Page, needle: string, maxTabs = 6): Promise<void> {
  for (let i = 0; i <= maxTabs; i++) {
    if ((await focusedText(page)).includes(needle)) return;
    if (i < maxTabs) await page.keyboard.press('Tab');
  }
  throw new Error(`focus never reached an element containing "${needle}"`);
}

/**
 * Enter the save form from the list mode: walk focus to "Save current",
 * then activate it with Enter (pointer clicks are unreliable on the
 * fixed-position popover content — see the interaction-model note above).
 */
async function enterSaveForm(page: Page) {
  await tabUntil(page, 'Save current');
  await page.keyboard.press('Enter');
  const nameInput = viewsDialog(page).getByLabel('View name');
  await expect(nameInput).toBeFocused();
  return nameInput;
}

/** Apply the named view from the list via keyboard (walk + Enter). */
async function applyView(page: Page, name: string) {
  await tabUntil(page, name);
  await page.keyboard.press('Enter');
}

/** Save the live filters under `name` and return to the list. */
async function saveViewByName(page: Page, name: string) {
  await openViews(page);
  await enterSaveForm(page);
  const dialog = viewsDialog(page);
  // The form previews the filters being saved.
  await expect(dialog.getByText('result is miss')).toBeVisible();
  await page.keyboard.insertText(name);
  await page.keyboard.press('Enter');
  await expect(dialog.getByText(name)).toBeVisible(); // back to list mode
}

test.describe('FinBench saved views', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/finbench');
    await expect(counter(page)).toBeVisible();
    await page.evaluate((key) => window.localStorage.removeItem(key), STORE_KEY);
    await page.reload();
    await expect(counter(page)).toBeVisible();
  });

  test('saving the current filters creates a revisitable view', async ({ page }) => {
    await gotoWithMissFilter(page);

    await saveViewByName(page, 'Numeric misses');

    const dialog = viewsDialog(page);
    // The view exists with a filter summary and is ACTIVE (its filters
    // equal the live state → check mark + highlight).
    await expect(dialog.getByText('Numeric misses')).toBeVisible();
    await expect(dialog.getByText('result is miss')).toBeVisible();
    await expect(dialog.locator('div.bg-accent')).toHaveCount(1);

    // Close, clear the filters via the chip ✕, then re-apply the view.
    await page.keyboard.press('Escape');
    await expect(viewsDialog(page)).toBeHidden();
    await page.locator('div.rounded-2xl').getByRole('button').last().click();
    await expect(counter(page)).toHaveText('14 of 14 runs');
    expect(new URL(page.url()).searchParams.get('filters')).toBeNull();

    await openViews(page);
    await applyView(page, 'Numeric misses');
    // Applying replays the saved FiltersState through the URL pipeline —
    // identical to opening the original deep link.
    await expect(counter(page)).toHaveText('1 of 14 runs');
    await expect(runsRows(page)).toHaveCount(1);
    await expect(runsRows(page).first()).toContainText('asc606-modification-003');
    expect(new URL(page.url()).searchParams.get('filters')).toBe(
      JSON.stringify([{ columnId: 'result', type: 'option', operator: 'is', values: ['miss'] }])
    );
  });

  test('views persist across reloads', async ({ page }) => {
    await gotoWithMissFilter(page);
    await saveViewByName(page, 'Reload survivor');

    await page.reload();
    await expect(counter(page)).toBeVisible();

    const dialog = await openViews(page);
    await expect(dialog.getByText('Reload survivor')).toBeVisible();
    // Applying after a reload proves the full round-trip.
    await applyView(page, 'Reload survivor');
    await expect(counter(page)).toHaveText('1 of 14 runs');
  });

  test('views never cross benchmark tracks', async ({ page }) => {
    await gotoWithMissFilter(page);
    await saveViewByName(page, 'Asc-only view');

    // The govcon track has its own view namespace: nothing saved there.
    await page.goto('/finbench?track=govcon');
    await expect(counter(page)).toHaveText('11 of 11 runs');
    const dialog = await openViews(page);
    await expect(dialog.getByText('No saved views yet')).toBeVisible();
    // No filters on govcon → saving is disabled until the user filters.
    await expect(dialog.getByRole('button', { name: 'Save current' })).toBeDisabled();
    await expect(dialog.getByText('Asc-only view')).toHaveCount(0);
  });

  test('a view can be deleted', async ({ page }) => {
    await gotoWithMissFilter(page);
    await saveViewByName(page, 'Doomed view');

    const dialog = viewsDialog(page);
    // Focus walks the popover: row apply button → row delete button.
    await tabUntil(page, 'Delete view Doomed view');
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('No saved views yet')).toBeVisible();

    // The store itself no longer carries the view.
    const stored = await page.evaluate(
      (key) => JSON.parse(window.localStorage.getItem(key) ?? '[]'),
      STORE_KEY,
    );
    expect(stored).toEqual([]);
  });

  test('a view can be renamed and re-iconed', async ({ page }) => {
    await gotoWithMissFilter(page);
    await saveViewByName(page, 'Old name');

    const dialog = viewsDialog(page);
    // Focus walks the popover: row apply → row edit.
    await tabUntil(page, 'Edit view Old name');
    await page.keyboard.press('Enter');

    // The edit form reuses the save form, prefilled.
    const nameInput = dialog.getByLabel('View name');
    await expect(nameInput).toBeFocused();
    await expect(nameInput).toHaveValue('Old name');
    // Keyboard-only editing: locator.fill enforces pointer actionability,
    // which hangs on the portaled popover; select-all + insertText works
    // with the input already focused.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Renamed view');

    // Pick an icon: one Shift+Tab walks back into the emoji group onto the
    // LAST chip (🗂️ — the palette runs 🔖 → 🗂️ and the input follows it);
    // Enter selects and focus stays, then the walk forward re-enters the
    // input on the way to the save button.
    await page.keyboard.press('Shift+Tab');
    expect(await focusedText(page)).toContain('Icon 🗂️');
    await page.keyboard.press('Enter');
    await tabUntil(page, 'Save view');
    await page.keyboard.press('Enter');

    await expect(dialog.getByText('Renamed view')).toBeVisible();
    await expect(dialog.getByText('Old name')).toHaveCount(0);
    // The chosen chip renders on the row.
    await expect(dialog.getByText('🗂️', { exact: true })).toBeVisible();

    // A rename keeps the derived description and the stored filters.
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(counter(page)).toBeVisible();
    await openViews(page);
    await expect(dialog.getByText('Renamed view')).toBeVisible();
    await expect(dialog.getByText('🗂️', { exact: true })).toBeVisible();
    await applyView(page, 'Renamed view');
    await expect(counter(page)).toHaveText('1 of 14 runs');
  });

  test('Save current is disabled until a filter combination exists', async ({ page }) => {
    await page.goto('/finbench');
    await expect(counter(page)).toHaveText('14 of 14 runs');

    const dialog = await openViews(page);
    await expect(dialog.getByRole('button', { name: 'Save current' })).toBeDisabled();
    await expect(dialog.getByText('No saved views yet')).toBeVisible();
  });
});

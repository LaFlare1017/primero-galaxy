import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end proof of the ⌘K command palette (cmdk, mounted once in the
 * root layout so the shortcut works on every product surface):
 *
 *   1. Ctrl+K opens it (headless Chromium has no Meta key; the palette
 *      binds (metaKey || ctrlKey) + k) and Esc closes it — on the galaxy,
 *      where the canvas sits behind the dialog overlay
 *   2. the root route renders all three command groups
 *   3. "Browse all 25 tasks…" routes into the tasks list, which carries
 *      every published task id; picking one navigates to its task page
 *   4. typing filters the task list (cmdk fuzzy matching); an unknown
 *      string shows CommandEmpty
 *   5. picking a scenario from /finbench crosses pages to
 *      /delegate?scenario=s5 with the scenario preselected
 *   6. picking a scenario while already on /delegate selects it in place
 *      via the delegate:select-scenario CustomEvent — no navigation
 *
 * The palette is client-only state (dialog + cmdk), so tests drive real
 * keyboard input and assert visible UI, not implementation handles.
 */

const TASK_TOTAL = 25; // 14 asc606 + 11 govcon (public/finbench/*.json)

/** Open the palette with the keyboard and wait for the input to take focus. */
async function openPalette(page: Page) {
  await page.keyboard.press('Control+KeyK');
  const input = page.getByPlaceholder('Type a command or search…');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  return input;
}

async function closePalette(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Type a command or search…')).toBeHidden();
}

test.describe('Command palette (⌘K)', () => {
  test('opens from the galaxy surface, renders the groups, closes on Esc', async ({ page }) => {
    await page.goto('/galaxy');
    // Galaxy boots its 3D canvas on /galaxy; the palette overlays it.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });

    const input = await openPalette(page);
    await expect(page.getByText('Go to')).toBeVisible();
    await expect(page.getByText('FinBench tasks')).toBeVisible();
    await expect(page.getByText('Delegate scenarios')).toBeVisible();

    // Representative rows from each group.
    await expect(page.getByRole('option', { name: 'Galaxy home' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Facilitator console' })).toBeVisible();
    await expect(page.getByRole('option', { name: `Browse all ${TASK_TOTAL} tasks…` })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Pick a scenario…' })).toBeVisible();

    await closePalette(page);
  });

  test('tasks route lists every published task and navigates to a task page', async ({ page }) => {
    await page.goto('/finbench');
    const input = await openPalette(page);

    await page.getByRole('option', { name: `Browse all ${TASK_TOTAL} tasks…` }).click();

    // The route swapped to the full task list.
    const asc606 = page.locator('[cmdk-item]', { hasText: 'asc606-' });
    const govcon = page.locator('[cmdk-item]', { hasText: 'govcon-' });
    await expect(asc606.first()).toBeVisible();
    await expect(govcon.first()).toBeVisible();
    const taskItems = page.locator('[cmdk-item]');
    await expect(taskItems).toHaveCount(TASK_TOTAL);

    // Picking a task navigates to its page.
    await asc606.first().click();
    await expect(page).toHaveURL(/\/finbench\/tasks\/asc606-/);
    await expect(page.getByRole('heading', { name: /asc606-/ })).toBeVisible();
    await expect(input).toBeHidden(); // palette closed on selection
  });

  test('searching filters the task list and unknown queries show the empty state', async ({ page }) => {
    await page.goto('/');
    const input = await openPalette(page);

    await page.getByRole('option', { name: `Browse all ${TASK_TOTAL} tasks…` }).click();

    // Exact-id search narrows to one row.
    await input.fill('asc606-modification-003');
    const item = page.locator('[cmdk-item]', { hasText: 'asc606-modification-003' });
    await expect(item).toHaveCount(1);

    // Clearing restores the full list.
    await input.fill('');
    await expect(page.locator('[cmdk-item]')).toHaveCount(TASK_TOTAL);

    // A string matching nothing renders cmdk's empty state.
    await input.fill('zzz-no-such-task-zzz');
    await expect(page.getByText('No results found.')).toBeVisible();
  });

  test('a scenario picked from another page deep-links /delegate?scenario=…', async ({ page }) => {
    await page.goto('/finbench');
    const input = await openPalette(page);

    await page.getByRole('option', { name: 'Pick a scenario…' }).click();
    await page.getByRole('option', { name: /5\. Revenue recognition/ }).click();

    // Cross-page: palette closes and the workshop boots with the scenario.
    await expect(page).toHaveURL(/\/delegate\?scenario=s5/);
    const selected = page.locator('button', { hasText: 'Revenue recognition' });
    await expect(selected).toBeVisible();
    await expect(selected).toHaveClass(/bg-black/);
  });

  test('a scenario picked while already on /delegate selects it in place', async ({ page }) => {
    await page.goto('/delegate');
    // Pre-start screen: name + scenario menu.
    await expect(page.getByPlaceholder('e.g. Jordan')).toBeVisible();

    const input = await openPalette(page);
    await page.getByRole('option', { name: 'Pick a scenario…' }).click();
    await page.getByRole('option', { name: /3\. Draft Q1 flux commentary/ }).click();

    // Same page: no navigation, no ?scenario= param; the menu selection
    // flips in place (the participant can just press Start).
    expect(new URL(page.url()).pathname).toBe('/delegate');
    expect(new URL(page.url()).searchParams.get('scenario')).toBeNull();
    const selected = page.locator('button', { hasText: 'Draft Q1 flux commentary' });
    await expect(selected).toBeVisible();
    await expect(selected).toHaveClass(/bg-black/);

    // The palette is gone after selection.
    await expect(input).toBeHidden();
  });
});

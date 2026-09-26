import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Deterministic keyboard selection for cmdk lists — the recipe from the
 * 2026-09 race audit (see README Conventions and command-palette.spec.ts).
 *
 * Why it exists: cmdk's Enter activates whatever is highlighted at
 * keypress time, and a CONTROLLED search must round-trip through React
 * state before the list reflects the typed text — so "type, then Enter"
 * races the highlight. Worse, typed text can summon QUICK-FILTER rows that
 * also match the query (the filter popover's subject view), so even a
 * narrowed-list wait can catch a transient match while Enter lands on a
 * quick row.
 *
 * The recipe here avoids typing entirely: press ArrowDown (cmdk handles
 * the key on its root) until the target is the SELECTED row
 * (`[cmdk-item][data-selected="true"]`, mirrored to aria-selected), pinned
 * inside a retry loop because each keypress lands a frame of re-render —
 * then Enter toggles exactly that row. A press that slips in before the
 * previous one was processed simply re-selects the (then-still-wrong)
 * first item and the next press fixes it; the loop converges because the
 * check and the press alternate.
 *
 * Pointer clicks on cmdk items are always safe (items own their click
 * handlers, independent of the highlight) — the command palette spec
 * relies on that and needs no helper.
 *
 * The input must already be focused: ArrowDown/Enter are pressed there.
 */
export async function selectCmdkItem(
  page: Page,
  input: Locator,
  match: RegExp,
  timeout = 10_000,
): Promise<void> {
  await expect(async () => {
    const selected = page.locator('[cmdk-item][data-selected="true"]');
    if (!match.test(await selected.innerText())) {
      await input.press('ArrowDown');
    }
    await expect(selected).toHaveText(match);
  }).toPass({ timeout });
  await input.press('Enter');
}

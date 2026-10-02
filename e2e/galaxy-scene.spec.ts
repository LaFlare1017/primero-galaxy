/**
 * The galaxy's 3D interaction pipeline, with REAL browser input (Playwright
 * mouse events are trusted, so R3F receives proper offsetX/offsetY and
 * raycasts work):
 *
 *   1. the app boots and renders the Fortune 500 dataset
 *   2. hovering a star (raycast -> store -> React) shows the tooltip
 *   3. double-clicking that star flies the camera to planet view and slides
 *      in the detail panel with radar chart
 *   4. "See Trajectory" reveals the 3D path + projections
 *   5. Esc returns to the galaxy
 *
 * Stars are targeted deterministically: the dataset is seeded, and the
 * `window.__galaxy` debug handles expose the camera/controls so the test can
 * project a star's world position onto the screen.
 *
 * Split out of the single 22-test `galaxy.spec.ts`, which took 15 minutes
 * because Playwright parallelises by FILE and one file is one worker. These
 * are the slow ones — hovering and double-clicking re-project a rotating mesh
 * under software WebGL — so this file is the one that most needed the split.
 */
import { expect, test } from './worker-server';
import type { Page } from '@playwright/test';
import {
  doubleClickStar,
  getTargetCompany,
  hoverStar,
  lookAtStar,
  waitForApp,
  waitForGalaxyBoot,
  STAR_COUNT,
  type GalaxyHandle,
} from './galaxy-helpers';

test('boots the galaxy and renders the Fortune 500 dataset', async ({ page }) => {
  await waitForApp(page);

  await expect(page.locator('canvas')).toBeVisible();
  // Landing title has faded out.
  await expect(page.getByText('The AI Transformation Galaxy')).toBeHidden();

  const state = await page.evaluate(() => {
    const g = window.__galaxy as GalaxyHandle;
    let starCount = 0;
    g.r3f.scene.traverse((o: any) => {
      if (o.isInstancedMesh) starCount = o.count;
    });
    return { mode: g.store.getState().mode, starCount, zoom: Math.round(g.store.getState().zoomLevel) };
  });
  expect(state.mode).toBe('galaxy');
  expect(state.starCount).toBe(STAR_COUNT);
  expect(state.zoom).toBeGreaterThan(700);

  const apiCount = await page.evaluate(() =>
    fetch('/api/companies').then((r) => r.json()).then((j: unknown[]) => j.length)
  );
  expect(apiCount).toBe(STAR_COUNT);
});

test('hovering a star shows the tooltip (raycast → store → UI)', async ({ page }) => {
  await waitForApp(page);
  const company = await getTargetCompany(page);
  await lookAtStar(page, company.id);
  await hoverStar(page, company.id, company.name);

  // The raycast hit the right company...
  const hovered = await page.evaluate(() =>
    (window.__galaxy as GalaxyHandle).store.getState().hoveredStar?.name ?? null
  );
  expect(hovered).toBe(company.name);

  // ...and the cursor-following tooltip rendered with its details.
  const tooltip = page.locator('.glass');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(company.name);
  await expect(tooltip).toContainText('Double-click to explore');
  await expect(tooltip.locator('span').first()).toBeVisible();
});

test('double-clicking a star opens planet view; trajectory + reset complete the loop', async ({ page }) => {
  await waitForApp(page);
  const company = await getTargetCompany(page);
  await lookAtStar(page, company.id);
  await hoverStar(page, company.id, company.name);

  // Real double-click on the star. Retries re-project at click time (the
  // galaxy mesh rotates ~0.008 rad/s), so a single stale frame (the flake
  // that failed this test under load) can never fail the suite.
  expect(await doubleClickStar(page, company.id)).toBe(true);

  // Store flips to planet mode and the camera flies in.
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 15_000,
    })
    .toBe('planet');
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Math.round((window.__galaxy as GalaxyHandle).store.getState().zoomLevel)
        ),
      { timeout: 30_000 }
    )
    .toBeLessThan(120);

  // Detail panel slides in with the company header and radar chart.
  await expect(page.getByRole('heading', { name: company.name })).toBeVisible();
  await expect(page.getByText('Planet view')).toBeVisible();
  await expect(page.locator('svg[aria-label="Maturity radar chart"]')).toBeVisible();
  await expect(page.getByRole('button', { name: '← Back to Galaxy' })).toBeVisible();

  // The profile header carries the research chrome: key stats, the sector
  // median reference (radar overlay + dimension ticks), and a website link.
  await expect(page.getByText('Revenue', { exact: true })).toBeVisible();
  await expect(page.getByText('Employees', { exact: true })).toBeVisible();
  await expect(page.getByText('sector median').first()).toBeVisible();
  // The profile header links to the company website; the panel also carries
  // per-dimension "Source ↗" links, so match the domain link by its exact
  // accessible name rather than any link ending in "↗".
  const profileLink = page.getByRole('link', { name: `${company.domain} ↗` });
  await expect(profileLink).toBeVisible();
  await expect(profileLink).toHaveAttribute('target', '_blank');

  // The Contact CTA leads to the landing page's contact section, not a dead
  // #contact anchor.
  await expect(page.getByRole('link', { name: 'Contact Primero' })).toHaveAttribute(
    'href',
    '/#contact'
  );

  // Trajectory: the panel section reveals projections and a 3D path draws in.
  const seeTrajectory = page.getByRole('button', { name: 'See Trajectory' });
  await expect(seeTrajectory).toBeVisible();
  await seeTrajectory.click();
  await expect(page.getByText('Projected EBITDA impact')).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          let lines = 0;
          (window.__galaxy as GalaxyHandle).r3f.scene.traverse((o: any) => {
            if (o.type === 'Line') lines++;
          });
          return lines;
        }),
      { timeout: 15_000 }
    )
    .toBeGreaterThan(0);

  // Esc returns to the galaxy: mode flips back, panel closes, camera flies out.
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 15_000,
    })
    .toBe('galaxy');
  await expect(page.locator('aside')).toBeHidden();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Math.round((window.__galaxy as GalaxyHandle).store.getState().zoomLevel)
        ),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(700);
});

/**
 * Is this control the element a pointer at its centre actually reaches?
 *
 * `elementFromPoint` asks the browser the same question a click asks, and names
 * the culprit: a failure reads as "the panel is on top of Search" rather than as
 * a click that retried until it timed out.
 */
async function hitTest(page: Page, name: string) {
  return page.getByRole('button', { name }).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const mine = Boolean(hit && (hit === el || el.contains(hit)));
    return {
      reachable: mine,
      interrupt: mine
        ? ''
        : `${hit?.tagName ?? 'nothing'}.${String(hit?.className ?? '').slice(0, 60)}`,
      rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}×${Math.round(rect.height)}`,
    };
  });
}

/**
 * The bottom bar is chrome: a profile drawer may cover the galaxy, never the
 * controls that are the page's only pointer route back out of it.
 *
 * It used to: the panel reached bottom-0 at z-30 over the bar's z-20, so with a
 * profile open all four controls were behind an opaque drawer — unclickable,
 * and reachable only by tab order. Nothing noticed for as long as it existed,
 * because every other test clicks the bar BEFORE selecting anything, which is
 * the state where the bar is still bare.
 *
 * The click IS the assertion (Playwright refuses to click what something else
 * would receive); the hit test above is there so a failure names what is in the
 * way, and the effects are asserted so a control that is merely exposed but
 * broken cannot pass.
 */
test('a company profile leaves the bottom bar’s controls clickable', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await waitForApp(page);

  // A profile, opened the way a person opens one.
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('combobox', { name: 'Search companies' }).fill('Nvidia');
  await page.getByRole('option', { name: /Nvidia/ }).first().click();
  const profile = page.locator('aside');
  await expect(profile).toBeVisible();
  await expect(page.getByText('Planet view')).toBeVisible();

  for (const name of ['Reset view', 'Search', 'Add Company', 'Share galaxy']) {
    const hit = await hitTest(page, name);
    expect(
      hit.reachable,
      `"${name}" sits at ${hit.rect} but ${hit.interrupt} is in front of it`
    ).toBe(true);
  }

  // Each control still DOES what it says with a profile open: the drawer is
  // anchored to a selection, so the first three must work without dropping it,
  // and Reset view is the one that drops it.
  await page.getByRole('button', { name: 'Search' }).click();
  const searchField = page.getByRole('combobox', { name: 'Search companies' });
  await expect(searchField).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(searchField).toBeHidden();
  await expect(profile, 'closing the palette is not dropping the profile').toBeVisible();

  await page.getByRole('button', { name: 'Add Company' }).click();
  const sheet = page.getByRole('heading', { name: 'Add Your Company' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(profile, 'closing the sheet is not dropping the profile').toBeVisible();

  const share = page.getByRole('button', { name: 'Share galaxy' });
  await share.click();
  await expect(share).toContainText('Copied');
  await expect(profile).toBeVisible();

  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(profile).toBeHidden();
});

test('searching a company by name flies to its star and opens its profile', async ({ page }) => {
  test.setTimeout(120_000);
  await waitForApp(page);

  // Pick a distinctive dataset company (unique name → unambiguous result).
  const companies = await page.evaluate(() =>
    fetch('/api/companies').then((r) => r.json())
  );
  const target = companies.find((c: any) => c.name === 'Nvidia');
  expect(target).toBeTruthy();

  // Open the search palette from the bottom bar.
  await page.getByRole('button', { name: 'Search' }).click();
  const input = page.getByRole('combobox', { name: 'Search companies' });
  await expect(input).toBeVisible();

  // Esc closes the palette without selecting anything (the global Esc
  // handler closes the search before clearing the selection).
  await input.fill('Nvidia');
  await page.keyboard.press('Escape');
  await expect(input).toBeHidden({ timeout: 5000 });
  expect(
    await page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode)
  ).toBe('galaxy');

  // Reopen and type the name: the matching result row renders with its
  // details, and Enter (keyboard selection) picks it (no raycast, so no
  // camera/rotation timing dependence like the dblclick path. The palette
  // resets its query during render on open (CompanySearch), so a fill right
  // after opening can never be wiped by a late post-commit reset.
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(input).toBeVisible();
  await input.fill('Nvidia');
  const option = page.getByRole('option', { name: /Nvidia/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('Technology');
  // Pin the highlighted row before Enter: the combobox selects
  // results[activeIndex], so the visible option must BE the selected one.
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');

  // Store flips to planet mode, the camera flies in, and the profile panel
  // opens on the searched company.
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 15_000,
    })
    .toBe('planet');
  await expect(page.getByRole('heading', { name: 'Nvidia' })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Math.round((window.__galaxy as GalaxyHandle).store.getState().zoomLevel)
        ),
      { timeout: 30_000 }
    )
    .toBeLessThan(120);

  // Esc returns to the galaxy (the palette is already closed by selection).
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 15_000,
    })
    .toBe('galaxy');
});


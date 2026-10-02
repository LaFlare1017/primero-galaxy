/**
 * Shared helpers for the galaxy specs.
 *
 * These were the top of `galaxy.spec.ts`, which is now several files so the
 * suite can run more than one at a time: Playwright parallelises by FILE, so a
 * single 22-test file is pinned to one worker no matter how many are
 * available. The helpers live here because every one of those files needs the
 * same camera projection and hover machinery, and a copy that drifts is a test
 * that quietly stops testing anything.
 *
 * The window.__galaxy debug handles are declared globally here rather than in
 * each spec, so the augmentation is loaded wherever the helpers are.
 */

import { expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    // Debug handle exposed by the app (GalaxyApp / CameraRig / GalaxyScene)
    __galaxy?: Record<string, any>;
    // Debug handle exposed by the hero starfield: the current star budget,
    // so tests can assert the mobile viewport draws fewer stars.
    __heroStars?: () => number;
  }
}

// The window.__galaxy handle is typed loosely in page context.
export type GalaxyHandle = Record<string, any>;

// The galaxy renders the curated Fortune 500 dataset (lib/fortune500-data.ts).
export const STAR_COUNT = 196;

// Toast auto-dismiss window: keep in sync with store/galaxyStore.ts.
export const TOAST_DURATION_MS = 12000;

/** Poll until the freshly mounted galaxy re-registers its debug handles. */
export async function waitForGalaxyBoot(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g = window.__galaxy as GalaxyHandle | undefined;
          return Boolean(g?.store && g?.controls && g?.r3f);
        }),
      { timeout: 30_000 }
    )
    .toBe(true);
}

export async function waitForApp(page: Page) {
  // The galaxy lives at /galaxy; the root route is the explainer landing page.
  await page.goto('/galaxy');
  await waitForGalaxyBoot(page);
  // Let the landing title sequence + staggered star-appear animation finish.
  await page.waitForTimeout(6000);
}

/** Deterministic target: a mid-maturity company that also has a trajectory. */
export async function getTargetCompany(page: Page) {
  const companies = await page.evaluate(() =>
    fetch('/api/companies').then((r) => r.json())
  );
  const target = companies.find(
    (c: any) => c.trajectory && c.maturity.overall > 55 && c.maturity.overall < 85
  );
  if (!target) throw new Error('no trajectory company found in dataset');
  return target as { id: string; name: string; domain: string };
}

/** Point the camera at the star from ~260 units so it sits centered on screen. */
export async function lookAtStar(page: Page, companyId: string) {
  await page.evaluate(({ companyId }) => {
    const g = window.__galaxy as GalaxyHandle;
    // Freeze the auto-orbit for the duration of the test (mode is otherwise
    // derived from selection/zoom, so this only stops the idle camera drift).
    g.store.getState().setMode('constellation');
    return fetch('/api/companies')
      .then((r) => r.json())
      .then((companies: any[]) => {
        const c = companies.find((x) => x.id === companyId);
        const state = g.r3f;
        let mesh: any = null;
        state.scene.traverse((o: any) => {
          if (o.isInstancedMesh) mesh = o;
        });
        if (!mesh) throw new Error('star instanced mesh not found');
        const v = state.camera.position.clone();
        v.set(c.position.x, c.position.y, c.position.z);
        mesh.parent.localToWorld(v); // account for the slow galaxy rotation
        g.controls.setLookAt(v.x, v.y, v.z + 260, v.x, v.y, v.z, true);
      });
  }, { companyId });

  // Wait for the camera transition to settle near the star.
  await expect
    .poll(
      () =>
        page.evaluate(async ({ companyId }) => {
          const g = window.__galaxy as GalaxyHandle;
          const state = g.r3f;
          const companies = await fetch('/api/companies').then((r) => r.json());
          const c = companies.find((x: any) => x.id === companyId);
          let mesh: any = null;
          state.scene.traverse((o: any) => {
            if (o.isInstancedMesh) mesh = o;
          });
          const v = state.camera.position.clone();
          v.set(c.position.x, c.position.y, c.position.z);
          mesh.parent.localToWorld(v);
          return state.camera.position.distanceTo(v);
        }, { companyId }),
      { timeout: 30_000 }
    )
    .toBeLessThan(310);
}

/** Project the star's world position onto viewport pixels. */
export async function projectStar(page: Page, companyId: string) {
  return page.evaluate(({ companyId }) => {
    const g = window.__galaxy as GalaxyHandle;
    const state = g.r3f;
    const canvas = state.gl.domElement as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    let mesh: any = null;
    state.scene.traverse((o: any) => {
      if (o.isInstancedMesh) mesh = o;
    });
    return fetch('/api/companies')
      .then((r) => r.json())
      .then((companies: any[]) => {
        const c = companies.find((x) => x.id === companyId);
        const v = state.camera.position.clone();
        v.set(c.position.x, c.position.y, c.position.z);
        mesh.parent.localToWorld(v);
        v.project(state.camera);
        return {
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - v.y) / 2) * rect.height,
        };
      });
  }, { companyId });
}

/** Poll the store until the intended star is hovered (or timeout with the last value). */
export async function waitForHover(page: Page, companyName: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(
      () => (window.__galaxy as GalaxyHandle).store.getState().hoveredStar?.name ?? null
    );
    if (last === companyName) return last;
    await page.waitForTimeout(150);
  }
  return last;
}

/**
 * Hover the star with real mouse input. The projection is re-computed per
 * attempt (camera/rotation drift), the hover state is polled generously
 * (software WebGL in headless commits React late), and small nudges absorb
 * residual projection error.
 */
export async function hoverStar(page: Page, companyId: string, companyName: string) {
  const nudges = [
    [0, 0],
    [6, 0],
    [-6, 0],
    [0, 6],
    [0, -6],
    [12, 12],
    [-12, 12],
    [12, -12],
    [-12, -12],
    [18, 0],
    [-18, 0],
    [0, 18],
    [0, -18],
  ];
  for (const [dx, dy] of nudges) {
    const { x, y } = await projectStar(page, companyId);
    await page.mouse.move(x + dx, y + dy, { steps: 3 });
    const hovered = await waitForHover(page, companyName, 2500);
    if (hovered === companyName) return { x: x + dx, y: y + dy };
  }
  throw new Error(
    `hover did not land on ${companyName}; expected raycast → tooltip chain`
  );
}

/**
 * Double-click the star with real input, retrying with a fresh projection.
 * The galaxy mesh rotates continuously (~0.008 rad/s), so a projection can
 * go stale between compute and click under load; each retry re-projects at
 * click time and stops as soon as the store flips to planet mode, so a
 * single stale frame can never fail the suite.
 */
export async function doubleClickStar(page: Page, companyId: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { x, y } = await projectStar(page, companyId);
    await page.mouse.dblclick(x, y);
    const landed = await page
      .waitForFunction(
        () => (window.__galaxy as GalaxyHandle).store.getState().mode === 'planet',
        undefined,
        { timeout: 2_000, polling: 200 }
      )
      .then(() => true)
      .catch(() => false);
    if (landed) return true;
  }
  return false;
}

/**
 * Double-click a star at an arbitrary screen projection with the same
 * retry-with-fresh-projection loop as `doubleClickStar`, but for stars whose
 * position comes from the store rather than /api/companies (user-added stars
 * are not in the dataset). Each retry re-projects the current world position
 * at click time and stops as soon as the store flips to planet mode, so a
 * single stale frame can never fail the call.
 */
export async function doubleClickPosition(
  page: Page,
  project: () => Promise<{ x: number; y: number }>
): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { x, y } = await project();
    await page.mouse.dblclick(x, y);
    const landed = await page
      .waitForFunction(
        () => (window.__galaxy as GalaxyHandle).store.getState().mode === 'planet',
        undefined,
        { timeout: 2_000, polling: 200 }
      )
      .then(() => true)
      .catch(() => false);
    if (landed) return true;
  }
  return false;
}

/** A minimal user-added Company shape for seeding storage directly. */
export function makeSeedStar(name = 'Window Test Co'): any {
  return {
    id: 'window-test-star',
    name,
    slug: 'window-test-co',
    industry: 'Technology',
    size: '50-200',
    maturity: {
      overall: 55,
      dataInfrastructure: 50,
      workflowStandardization: 55,
      aiDeployment: 52,
      governance: 60,
      talent: 58,
    },
    position: { x: 10, y: 20, z: 30 },
    constellationId: 'Technology',
    founded: 2010,
    revenue: 40,
    employees: 120,
    location: 'Austin, TX',
    isFeatured: false,
    isUserAdded: true,
  };
}

/**
 * The real-input delete loop: drive the camera to a user star, double-click it
 * into planet view, remove it from the panel, and check that Undo here restores
 * the VIEW as well as the star — because this removal happened in planet view,
 * which is exactly what the sheet's inline delete does not do.
 *
 * The slowest of the four tests this file was cut out of, and it stays the
 * slowest — this split made it share four workers with its three siblings
 * instead of holding one alone; it did not make it cheaper. What it removed is
 * the floor.
 *
 * Measured with the machine to itself (`npm run e2e:bench -- --workers=1
 * --only=galaxy-(toast|undo|user-stars|planet-delete)`), so the numbers are the
 * cost of the work rather than the cost of the contention:
 *
 *   galaxy-toast          42.2s   3 tests, longest 16.8s
 *   galaxy-user-stars     31.2s   2 tests, longest 18.1s
 *   galaxy-planet-delete  25.7s   1 test
 *   galaxy-undo           18.8s   1 test
 *
 * 117.9s for all of it (113.9s on an earlier run of the same four, so a serial
 * measurement of this group has about 4s of spread).
 *
 * The single test these four came out of cost 108.3s on its own at 4 workers, so
 * the work is essentially unchanged — what changed is that it now belongs to four
 * files, and under `fullyParallel: false` a file is one worker's serial chunk.
 * The floor for this group went 594.8s → 42.2s.
 *
 * Split out of `galaxy-toast.spec.ts`; see galaxy-helpers.ts.
 */
import { expect, test } from './worker-server';
import {
  doubleClickPosition,
  waitForApp,
  waitForHover,
  type GalaxyHandle,
} from './galaxy-helpers';

test('removing from the planet panel offers Undo, and Undo restores the view', async ({ page }) => {
  // 25.7s serial — 25.2s and 26.0s on two earlier serial runs of it, which is the
  // spread a serial measurement of this test actually has and is worth about
  // half a second. 71.4s at 4 workers on a loaded box for a clean pass. The
  // clean figure is not the one that sets this budget, though: the same test was
  // seen at 157.5s, then 593.5s, then 71.4s across three attempts of one run on
  // a machine carrying load 13, which is not a spread you can budget around — it
  // is a spread that says the 300s ceiling was being hit and then not.
  //
  // 600s covers the worst of those three attempts outright and leaves room for
  // the two retries CI allows. It is a wide ceiling on a test that usually takes
  // 25s, and that asymmetry is deliberate: the ceiling is only ever reached when
  // something has already gone wrong, and a budget that cuts off a slow
  // camera flight cannot tell the reader whether the camera was slow or the
  // test was broken. galaxy-keys.spec.ts is where the same shape costs most.
  test.setTimeout(600_000);
  await waitForApp(page);

  // Add the star this test removes. It goes through the form rather than a
  // seeded localStorage entry because the rest of the test is about real input
  // onto a real user star — the raycast below cannot hit a star the app never
  // animated into place.
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.getByRole('heading', { name: 'Add Your Company' })).toBeVisible();
  await page.getByLabel('Company name').fill('Meridian Logistics');
  await page.getByLabel('Industry').selectOption('Transportation & Logistics');
  const slider = page.getByLabel('Current AI status');
  await slider.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )!.set!;
    setter.call(el, '72');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Add to galaxy' }).click();
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 10_000,
    })
    .toBe('planet');

  // Let the staggered star-appear animation finish before targeting.
  await page.waitForTimeout(5000);

  // --- Delete through the UI (real input, full loop) ---

  // The user star is not in /api/companies, so source its position from the
  // store and drive the camera to it the same way the helpers do.
  const userStar = await page.evaluate(() => {
    const s = (window.__galaxy as GalaxyHandle).store.getState();
    const u = s.userStars[0];
    return { id: u.id, name: u.name, position: u.position };
  });
  await page.evaluate(({ position }) => {
    const g = window.__galaxy as GalaxyHandle;
    g.store.getState().setMode('constellation'); // freeze auto-orbit
    const state = g.r3f;
    let mesh: any = null;
    state.scene.traverse((o: any) => {
      if (o.isInstancedMesh) mesh = o;
    });
    const v = state.camera.position.clone();
    v.set(position.x, position.y, position.z);
    mesh.parent.localToWorld(v);
    g.controls.setLookAt(v.x, v.y, v.z + 260, v.x, v.y, v.z, true);
  }, { position: userStar.position });

  // Wait for the camera to settle near the star.
  await expect
    .poll(
      () =>
        page.evaluate(({ position }) => {
          const g = window.__galaxy as GalaxyHandle;
          const state = g.r3f;
          let mesh: any = null;
          state.scene.traverse((o: any) => {
            if (o.isInstancedMesh) mesh = o;
          });
          const v = state.camera.position.clone();
          v.set(position.x, position.y, position.z);
          mesh.parent.localToWorld(v);
          return state.camera.position.distanceTo(v);
        }, { position: userStar.position }),
      { timeout: 30_000 }
    )
    .toBeLessThan(310);

  // Project the star and double-click it (real input) until planet view opens.
  const projectUserStar = () =>
    page.evaluate(({ position }) => {
      const g = window.__galaxy as GalaxyHandle;
      const state = g.r3f;
      const canvas = state.gl.domElement as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      let mesh: any = null;
      state.scene.traverse((o: any) => {
        if (o.isInstancedMesh) mesh = o;
      });
      const v = state.camera.position.clone();
      v.set(position.x, position.y, position.z);
      mesh.parent.localToWorld(v);
      v.project(state.camera);
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
      };
    }, { position: userStar.position });

  // Project the star and move the mouse with nudges until the raycast
  // actually lands on the user star. Its position is random, so it can sit
  // behind another star, so poll hover rather than blind-dblclicking.
  const dblNudges = [
    [0, 0],
    [8, 8],
    [-8, 8],
    [8, -8],
    [-8, -8],
    [0, 14],
    [14, 0],
    [-14, 0],
    [0, -14],
  ];
  let landed: { x: number; y: number } | null = null;
  for (const [dx, dy] of dblNudges) {
    const { x, y } = await projectUserStar();
    await page.mouse.move(x + dx, y + dy, { steps: 3 });
    const hovered = await waitForHover(page, userStar.name, 2000);
    if (hovered !== userStar.name) continue;
    // waitForHover accepts a transient hit from an intermediate move step
    // (mouse.move steps interpolate), so the endpoint may not be over the star.
    // Re-move without interpolation and confirm the hover persists first.
    await page.mouse.move(x + dx, y + dy);
    const confirmed = await page.evaluate(
      () => (window.__galaxy as GalaxyHandle).store.getState().hoveredStar?.name ?? null
    );
    if (confirmed === userStar.name) {
      landed = { x: x + dx, y: y + dy };
      break;
    }
  }

  // Selection via raycast is proven by the dedicated double-click test; this
  // phase proves the UI delete loop, so fall back to the store rather than
  // failing the suite when the dblclick misses (occlusion or a pointer race).
  const selectViaStore = () =>
    page.evaluate(({ id }) => {
      const s = (window.__galaxy as GalaxyHandle).store.getState();
      const star = s.userStars.find((u: any) => u.id === id);
      if (star) s.selectStar(star);
    }, { id: userStar.id });

  if (landed) {
    // Retry with a fresh projection, mirroring the trajectory dblclick
    // helper: the galaxy rotates between the hover discovery above and this
    // click, so a single stale frame must never fail the delete phase. The
    // store pick remains a last-resort fallback only (occlusion), not the
    // primary path.
    const opened = await doubleClickPosition(page, projectUserStar);
    if (!opened) await selectViaStore();
  } else {
    // The random position is occluded behind another star.
    await selectViaStore();
  }
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 15_000,
    })
    .toBe('planet');

  // The panel reopens on the user star and offers the delete action.
  await expect(page.getByRole('heading', { name: userStar.name })).toBeVisible();
  const removeBtn = page.getByRole('button', { name: 'Remove from galaxy' });
  await expect(removeBtn).toBeVisible();

  // Two-step confirm, then the star is removed and the view resets.
  await removeBtn.click();
  await expect(
    page.getByRole('button', { name: 'Click again to remove ✕' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Click again to remove ✕' }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window.__galaxy as GalaxyHandle).store.getState();
        return { mode: s.mode, userCount: s.userStars.length };
      })
    )
    .toEqual({ mode: 'galaxy', userCount: 0 });
  await expect(page.locator('aside')).toBeHidden();

  // localStorage is cleaned up (empty list persisted).
  const persistedAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('primero-galaxy:user-stars');
    return raw ? (JSON.parse(raw) as unknown[]).length : 0;
  });
  expect(persistedAfter).toBe(0);

  // Camera/UI reset: zoom returns toward the galaxy overview.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Math.round((window.__galaxy as GalaxyHandle).store.getState().zoomLevel)
        ),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(700);

  // The panel delete triggers the same Undo toast, and because the star was
  // deleted from planet view, Undo restores the view: panel + camera fly-in.
  await expect(page.getByText('Removed from the galaxy.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().userStars.length)
    )
    .toBe(1);
  const persistedAfterUndo2 = await page.evaluate(() => {
    const raw = localStorage.getItem('primero-galaxy:user-stars');
    return raw ? (JSON.parse(raw) as unknown[]).length : 0;
  });
  expect(persistedAfterUndo2).toBe(1);

  // Planet view restored: mode flips back, the panel reopens on the star, and
  // the camera flies back in to planet distance.
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 15_000,
    })
    .toBe('planet');
  await expect(page.getByRole('heading', { name: userStar.name })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Math.round((window.__galaxy as GalaxyHandle).store.getState().zoomLevel)
        ),
      { timeout: 30_000 }
    )
    .toBeLessThan(120);

  // Final cleanup: the suite must leave no user stars behind.
  await page.evaluate(() => {
    const s = (window.__galaxy as GalaxyHandle).store.getState();
    s.userStars.forEach((u: any) => s.removeUserStar(u.id));
  });

  // Final cleanup: the suite must leave no user stars behind.
  await page.evaluate(() => {
    const s = (window.__galaxy as GalaxyHandle).store.getState();
    s.userStars.forEach((u: any) => s.removeUserStar(u.id));
  });
});

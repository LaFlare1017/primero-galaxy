import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    // Debug handle exposed by the app (GalaxyApp / CameraRig / GalaxyScene)
    __galaxy?: Record<string, any>;
  }
}

/**
 * End-to-end proof of the galaxy interaction pipeline using REAL browser
 * input (Playwright mouse events are trusted, so R3F receives proper
 * offsetX/offsetY and raycasts work):
 *
 *   1. the app boots and renders 500 stars
 *   2. hovering a star (raycast → store → React) shows the tooltip
 *   3. double-clicking that star flies the camera to planet view and slides
 *      in the detail panel with radar chart
 *   4. "See Trajectory" reveals the 3D path + projections
 *   5. Esc returns to the galaxy
 *
 * Stars are targeted deterministically: the dataset is seeded, and the
 * `window.__galaxy` debug handles expose the camera/controls so the test can
 * project a star's world position onto the screen.
 */

// The window.__galaxy handle is typed loosely in page context.
type GalaxyHandle = Record<string, any>;

async function waitForApp(page: Page) {
  // The galaxy lives at /galaxy; the root route is the explainer landing page.
  await page.goto('/galaxy');
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
  // Let the landing title sequence + staggered star-appear animation finish.
  await page.waitForTimeout(6000);
}

/** Deterministic target: a mid-maturity company that also has a trajectory. */
async function getTargetCompany(page: Page) {
  const companies = await page.evaluate(() =>
    fetch('/api/companies').then((r) => r.json())
  );
  const target = companies.find(
    (c: any) => c.trajectory && c.maturity.overall > 55 && c.maturity.overall < 85
  );
  if (!target) throw new Error('no trajectory company found in dataset');
  return target as { id: string; name: string };
}

/** Point the camera at the star from ~260 units so it sits centered on screen. */
async function lookAtStar(page: Page, companyId: string) {
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
async function projectStar(page: Page, companyId: string) {
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

/**
 * Hover the star with real mouse input. The projection is re-computed per
 * attempt (camera/rotation drift), the hover state is polled generously
 * (software WebGL in headless commits React late), and small nudges absorb
 * residual projection error.
 */
async function hoverStar(page: Page, companyId: string, companyName: string) {
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

/** Poll the store until the intended star is hovered (or timeout with the last value). */
async function waitForHover(page: Page, companyName: string, timeoutMs: number) {
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

test('boots the galaxy and renders 500 stars', async ({ page }) => {
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
  expect(state.starCount).toBe(500);
  expect(state.zoom).toBeGreaterThan(700);

  const apiCount = await page.evaluate(() =>
    fetch('/api/companies').then((r) => r.json()).then((j: unknown[]) => j.length)
  );
  expect(apiCount).toBe(500);
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
  const point = await hoverStar(page, company.id, company.name);

  // Real double-click on the star.
  await page.mouse.dblclick(point.x, point.y);

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

test('adding a company creates a persistent star and flies to it', async ({ page }) => {
  // The delete phase adds a camera round-trip, so budget past the 90s default.
  test.setTimeout(180_000);
  await waitForApp(page);

  // Open the Add Your Company sheet from the bottom bar
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.getByRole('heading', { name: 'Add Your Company' })).toBeVisible();

  // Fill the form: name, industry, ERP, AI status slider
  await page.getByLabel('Company name').fill('Meridian Logistics');
  await page.getByLabel('Industry').selectOption('Logistics');
  await page.getByLabel('ERP system').selectOption('SAP');
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

  // Store: user star added with the form values, selected, planet mode
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 10_000,
    })
    .toBe('planet');
  const star = await page.evaluate(() => {
    const s = (window.__galaxy as GalaxyHandle).store.getState();
    return {
      count: s.userStars.length,
      name: s.selectedStar?.name,
      industry: s.selectedStar?.industry,
      erp: s.selectedStar?.erpSystem,
      maturity: s.selectedStar?.maturity.overall,
      isUserAdded: s.selectedStar?.isUserAdded,
      hasTrajectory: Boolean(s.selectedStar?.trajectory),
    };
  });
  expect(star.count).toBe(1);
  expect(star).toMatchObject({
    name: 'Meridian Logistics',
    industry: 'Logistics',
    erp: 'SAP',
    maturity: 72,
    isUserAdded: true,
    hasTrajectory: true,
  });

  // Camera flies to the new star (planet distance) and the panel shows it
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Math.round((window.__galaxy as GalaxyHandle).store.getState().zoomLevel)
        ),
      { timeout: 30_000 }
    )
    .toBeLessThan(120);
  await expect(page.getByRole('heading', { name: 'Meridian Logistics' })).toBeVisible();

  // The post-add prompt offers the trajectory
  await expect(page.getByText('Your company is here.')).toBeVisible();

  // The added toast is persisted to sessionStorage (survives a refresh).
  const pendingKinds = await page.evaluate(() => {
    const raw = sessionStorage.getItem('primero-galaxy:pending-toasts');
    return raw ? (JSON.parse(raw) as any[]).map((t) => t.kind) : [];
  });
  expect(pendingKinds).toContain('added');

  // The star is persisted to localStorage
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('primero-galaxy:user-stars');
    return raw ? (JSON.parse(raw) as any[]) : [];
  });
  expect(persisted.length).toBe(1);
  expect(persisted[0].name).toBe('Meridian Logistics');

  // The toast is several seconds old by now (camera flight + assertions).
  // With remaining-window semantics a slow refresh can legitimately expire
  // it — that expiry is covered by the dedicated toast tests below. Here we
  // reset the persisted createdAt so the reload simulates an immediate
  // refresh: the "See trajectory" prompt must survive it.
  await page.evaluate(() => {
    const raw = sessionStorage.getItem('primero-galaxy:pending-toasts');
    if (raw) {
      const now = Date.now();
      sessionStorage.setItem(
        'primero-galaxy:pending-toasts',
        JSON.stringify((JSON.parse(raw) as any[]).map((t) => ({ ...t, createdAt: now })))
      );
    }
  });

  // Reload: the star survives (hydrated from localStorage, count reflects it)
  await page.reload();
  // Handles are re-registered by the fresh mount — wait for them before
  // driving the camera (the hydration poll alone only proves `store`).
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
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().userStars.length), {
      timeout: 30_000,
    })
    .toBe(1);
  await expect(page.getByText('501 stars')).toBeVisible();

  // The post-add "See trajectory" prompt also survives the reload
  // (persisted to sessionStorage with the removed toasts).
  await expect(page.getByText('Your company is here.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'See trajectory →' })
  ).toBeVisible();

  // --- Delete through the sheet's "Your stars" list (inline delete) ---
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.getByRole('heading', { name: 'Add Your Company' })).toBeVisible();
  await expect(page.getByText('Your stars')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove Meridian Logistics' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove Meridian Logistics' }).click();

  // Store + localStorage cleaned immediately, while the sheet stays open.
  await expect
    .poll(() =>
      page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().userStars.length)
    )
    .toBe(0);
  const persistedAfterSheet = await page.evaluate(() => {
    const raw = localStorage.getItem('primero-galaxy:user-stars');
    return raw ? (JSON.parse(raw) as unknown[]).length : 0;
  });
  expect(persistedAfterSheet).toBe(0);

  // The removal toast survives a reload (sessionStorage), so Undo still works
  // after an accidental refresh. As with the "added" toast above, reset the
  // persisted createdAt so the reload models an immediate refresh rather than
  // racing the 8s remaining-window (expiry is covered by dedicated tests).
  await expect(page.getByText('Removed from the galaxy.')).toBeVisible();
  await page.evaluate(() => {
    const raw = sessionStorage.getItem('primero-galaxy:pending-toasts');
    if (raw) {
      const now = Date.now();
      sessionStorage.setItem(
        'primero-galaxy:pending-toasts',
        JSON.stringify((JSON.parse(raw) as any[]).map((t) => ({ ...t, createdAt: now })))
      );
    }
  });
  await page.reload();
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
  // Hydration restores the pending toast — Undo is still offered.
  await expect(page.getByText('Removed from the galaxy.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().userStars.length)
    )
    .toBe(1);
  await expect(page.getByText('Removed from the galaxy.')).toBeHidden();
  const persistedAfterUndo = await page.evaluate(() => {
    const raw = localStorage.getItem('primero-galaxy:user-stars');
    return raw ? (JSON.parse(raw) as unknown[]).length : 0;
  });
  expect(persistedAfterUndo).toBe(1);

  // Deleted from the list (not planet view) — Undo must NOT restore the view.
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode))
    .toBe('galaxy');

  // Delete again (the reload closed the sheet) so the re-add phase starts
  // from a clean slate.
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.getByRole('heading', { name: 'Add Your Company' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove Meridian Logistics' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove Meridian Logistics' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().userStars.length)
    )
    .toBe(0);

  // Re-add a star so the planet-panel delete phase has one to remove.
  await page.getByLabel('Company name').fill('Meridian Logistics');
  await page.getByLabel('Industry').selectOption('Logistics');
  await page.getByLabel('ERP system').selectOption('SAP');
  const slider2 = page.getByLabel('Current AI status');
  await slider2.evaluate((el) => {
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
  // behind another star — poll hover rather than blind-dblclicking.
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
    if (hovered === userStar.name) {
      landed = { x: x + dx, y: y + dy };
      break;
    }
  }

  if (landed) {
    await page.mouse.dblclick(landed.x, landed.y);
  } else {
    // The random position is occluded behind another star — select via the
    // store instead (selection is already proven by the double-click test).
    await page.evaluate(({ id }) => {
      const s = (window.__galaxy as GalaxyHandle).store.getState();
      const star = s.userStars.find((u: any) => u.id === id);
      if (star) s.selectStar(star);
    }, { id: userStar.id });
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

  // The panel delete triggers the same Undo toast — and because the star was
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
});

/** A minimal user-added Company shape for seeding storage directly. */
function makeSeedStar(name = 'Window Test Co'): any {
  return {
    id: 'window-test-star',
    name,
    slug: 'window-test-co',
    industry: 'SaaS',
    erpSystem: 'NetSuite',
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
    constellationId: 'SaaS-NetSuite',
    founded: 2010,
    revenue: 40,
    employees: 120,
    location: 'Austin, TX',
    isFeatured: false,
    isUserAdded: true,
  };
}

test('a hydrated toast keeps only its remaining window (no fresh 8s)', async ({ page }) => {
  test.setTimeout(120_000);
  await waitForApp(page);

  // Seed a user star + an "added" toast whose 8s window is already half over.
  // After the reload it must auto-dismiss in the ~4s that remain — not a
  // fresh 8 seconds from hydration.
  await page.evaluate((star) => {
    localStorage.setItem('primero-galaxy:user-stars', JSON.stringify([star]));
    sessionStorage.setItem(
      'primero-galaxy:pending-toasts',
      JSON.stringify([
        { id: 't-remaining', kind: 'added', star, createdAt: Date.now() - 4000 },
      ])
    );
  }, makeSeedStar());

  await page.reload();
  // Wait for the fresh mount to re-register handles (hydration runs on mount).
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

  // The toast survives the reload (still inside its window)…
  const toast = page.getByText('Your company is here.');
  await expect(toast).toBeVisible({ timeout: 5000 });

  // …but its timer only has the ~4s remaining: it auto-dismisses well before
  // a fresh 8s post-hydration would have elapsed.
  await expect(toast).toBeHidden({ timeout: 5000 });

  // Dismissal purged the pending entry from sessionStorage too.
  const pending = await page.evaluate(() => {
    const raw = sessionStorage.getItem('primero-galaxy:pending-toasts');
    return raw ? (JSON.parse(raw) as unknown[]) : [];
  });
  expect(pending.length).toBe(0);
});

test('a toast that expired while away does not resurrect on reload', async ({ page }) => {
  await waitForApp(page);

  // Seed a "removed" (Undo) toast that expired before the reload: created 10s
  // ago, well past the 8s window. Hydration must drop it — no fresh window.
  await page.evaluate((star) => {
    localStorage.setItem('primero-galaxy:user-stars', JSON.stringify([star]));
    sessionStorage.setItem(
      'primero-galaxy:pending-toasts',
      JSON.stringify([
        { id: 't-expired', kind: 'removed', star, createdAt: Date.now() - 10_000 },
      ])
    );
  }, makeSeedStar());

  await page.reload();
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

  // Neither toast variant ever re-appears.
  await expect(page.getByText('Your company is here.')).toBeHidden();
  await expect(page.getByText('Removed from the galaxy.')).toBeHidden();

  // And hydration purged the stale entry from sessionStorage.
  const pending = await page.evaluate(() => {
    const raw = sessionStorage.getItem('primero-galaxy:pending-toasts');
    return raw ? (JSON.parse(raw) as unknown[]) : null;
  });
  expect(pending).toEqual([]);
});

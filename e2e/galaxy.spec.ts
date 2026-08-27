import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    // Debug handle exposed by the app (GalaxyApp / CameraRig / GalaxyScene)
    __galaxy?: Record<string, any>;
    // Debug handle exposed by the reactive-lines background: the pattern's
    // pointer target, so tests can assert mouse/touch input reaches it.
    __lines?: { target(): { x: number; y: number } };
  }
}

/**
 * End-to-end proof of the galaxy interaction pipeline using REAL browser
 * input (Playwright mouse events are trusted, so R3F receives proper
 * offsetX/offsetY and raycasts work):
 *
 *   1. the app boots and renders the Fortune 500 dataset
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

// The galaxy renders the curated Fortune 500 dataset (lib/fortune500-data.ts).
const STAR_COUNT = 196;

// Toast auto-dismiss window: keep in sync with store/galaxyStore.ts.
const TOAST_DURATION_MS = 12000;

/** Poll until the freshly mounted galaxy re-registers its debug handles. */
async function waitForGalaxyBoot(page: Page) {
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

async function waitForApp(page: Page) {
  // The galaxy lives at /galaxy; the root route is the explainer landing page.
  await page.goto('/galaxy');
  await waitForGalaxyBoot(page);
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
  return target as { id: string; name: string; domain: string };
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

/**
 * Double-click the star with real input, retrying with a fresh projection.
 * The galaxy mesh rotates continuously (~0.008 rad/s), so a projection can
 * go stale between compute and click under load; each retry re-projects at
 * click time and stops as soon as the store flips to planet mode, so a
 * single stale frame can never fail the suite.
 */
async function doubleClickStar(page: Page, companyId: string) {
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
  // camera/rotation timing dependence like the dblclick path.
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(input).toBeVisible();
  await input.fill('Nvidia');
  const option = page.getByRole('option', { name: /Nvidia/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('Technology');
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

test('adding a company creates a persistent star and flies to it', async ({ page }) => {
  // The delete phase adds a camera round-trip, so budget past the 90s default.
  test.setTimeout(180_000);
  await waitForApp(page);

  // Open the Add Your Company sheet from the bottom bar
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.getByRole('heading', { name: 'Add Your Company' })).toBeVisible();

  // Fill the form: name, industry, AI status slider
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
      maturity: s.selectedStar?.maturity.overall,
      isUserAdded: s.selectedStar?.isUserAdded,
      hasTrajectory: Boolean(s.selectedStar?.trajectory),
    };
  });
  expect(star.count).toBe(1);
  expect(star).toMatchObject({
    name: 'Meridian Logistics',
    industry: 'Transportation & Logistics',
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
  // it; that expiry is covered by the dedicated toast tests below. Here we
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
  // Handles are re-registered by the fresh mount; wait for them before
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
  await expect(page.getByText(`${STAR_COUNT + 1} stars`)).toBeVisible();

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
  // Hydration restores the pending toast; Undo is still offered.
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

  // Deleted from the list (not planet view); Undo must NOT restore the view.
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
  await page.getByLabel('Industry').selectOption('Transportation & Logistics');
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
    await page.mouse.dblclick(landed.x, landed.y);
    try {
      await expect
        .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
          timeout: 4_000,
        })
        .toBe('planet');
    } catch {
      await selectViaStore();
    }
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
});

/** A minimal user-added Company shape for seeding storage directly. */
function makeSeedStar(name = 'Window Test Co'): any {
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

test('a hydrated toast keeps only its remaining window (no fresh duration)', async ({ page }) => {
  test.setTimeout(120_000);
  await waitForApp(page);

  // Seed a user star + an "added" toast whose window is already mostly gone.
  // After the reload it must auto-dismiss in the ~4s that remain, not a
  // fresh full window from hydration.
  await page.evaluate(
    ({ star, ms }) => {
      localStorage.setItem('primero-galaxy:user-stars', JSON.stringify([star]));
      sessionStorage.setItem(
        'primero-galaxy:pending-toasts',
        JSON.stringify([
          { id: 't-remaining', kind: 'added', star, createdAt: Date.now() - (ms - 4000) },
        ])
      );
    },
    { star: makeSeedStar(), ms: TOAST_DURATION_MS }
  );

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
  // a fresh full window post-hydration would have elapsed.
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

  // Seed a "removed" (Undo) toast that expired before the reload: created
  // well past the auto-dismiss window. Hydration must drop it: no fresh
  // window.
  await page.evaluate(
    ({ star, ms }) => {
      localStorage.setItem('primero-galaxy:user-stars', JSON.stringify([star]));
      sessionStorage.setItem(
        'primero-galaxy:pending-toasts',
        JSON.stringify([
          { id: 't-expired', kind: 'removed', star, createdAt: Date.now() - (ms + 2000) },
        ])
      );
    },
    { star: makeSeedStar(), ms: TOAST_DURATION_MS }
  );

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

test('removing the same company twice keeps one Removed toast; Undo restores it', async ({ page }) => {
  test.setTimeout(120_000);
  await waitForApp(page);

  // Seed a user star plus a pending "removed" toast for it. Its createdAt is
  // set slightly in the future so the 12s auto-dismiss window is guaranteed
  // to still be open when the UI remove below fires, so the test must not
  // depend on machine speed racing the dismiss timer.
  await page.evaluate((star) => {
    localStorage.setItem('primero-galaxy:user-stars', JSON.stringify([star]));
    sessionStorage.setItem(
      'primero-galaxy:pending-toasts',
      JSON.stringify([{ id: 't-seeded', kind: 'removed', star, createdAt: Date.now() + 8000 }])
    );
  }, makeSeedStar());
  await page.reload();
  await waitForGalaxyBoot(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window.__galaxy as GalaxyHandle).store.getState().userStars.length
        ),
      { timeout: 30_000 }
    )
    .toBe(1);

  // The seeded Removed toast is live and its window is definitely open.
  const removedToast = page.getByText('Removed from the galaxy.');
  await expect(removedToast).toHaveCount(1);
  await expect(removedToast).toBeVisible();

  // Remove the same company through the sheet's "Your stars" list: the new
  // removal must SUPERSEDE the seeded toast (same kind + slug); never stack
  // a duplicate, even though the first toast is still on screen.
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.getByRole('heading', { name: 'Add Your Company' })).toBeVisible();
  const removeButton = page.getByRole('button', { name: 'Remove Window Test Co' });
  await expect(removeButton).toBeVisible();
  await removeButton.click();

  // Exactly one Removed toast remains, no stacked duplicate, in both the
  // DOM and the store (the store check is the airtight one: it runs moments
  // after the click, while the seeded toast's window is still open).
  await expect(removedToast).toHaveCount(1, { timeout: 5000 });
  const removedKinds = await page.evaluate(() => {
    const s = (window.__galaxy as GalaxyHandle).store.getState();
    return s.toasts.filter(
      (t: any) => t.kind === 'removed' && t.star.slug === 'window-test-co'
    ).length;
  });
  expect(removedKinds).toBe(1);

  // Undo on the surviving toast restores the star and clears the toast.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window.__galaxy as GalaxyHandle).store.getState().userStars.length
        ),
      { timeout: 30_000 }
    )
    .toBe(1);
  await expect(removedToast).toBeHidden();

  // Final cleanup: the suite must leave no user stars behind.
  await page.evaluate(() => {
    const s = (window.__galaxy as GalaxyHandle).store.getState();
    s.userStars.forEach((u: any) => s.removeUserStar(u.id));
  });
});

test('the Add Company form rejects a duplicate company name', async ({ page }) => {
  test.setTimeout(120_000);
  await waitForApp(page);

  // Seed a user star so the form has a name to collide with.
  await page.evaluate((star) => {
    localStorage.setItem('primero-galaxy:user-stars', JSON.stringify([star]));
  }, makeSeedStar());
  await page.reload();
  await waitForGalaxyBoot(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window.__galaxy as GalaxyHandle).store.getState().userStars.length
        ),
      { timeout: 30_000 }
    )
    .toBe(1);

  // Type the same company with different case and whitespace: the form must
  // flag it (slug identity is case/whitespace-insensitive) and refuse to
  // submit, without touching the store.
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.getByRole('heading', { name: 'Add Your Company' })).toBeVisible();
  const nameInput = page.getByLabel('Company name');
  await nameInput.fill('  WINDOW TEST CO ');
  await expect(
    page.getByText('This company is already in your galaxy.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to galaxy' })).toBeDisabled();
  await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
  const countWhileBlocked = await page.evaluate(
    () => (window.__galaxy as GalaxyHandle).store.getState().userStars.length
  );
  expect(countWhileBlocked).toBe(1);

  // The store guard itself also refuses the duplicate, for any caller.
  await page.evaluate((star) => {
    (window.__galaxy as GalaxyHandle).store.getState().addUserStar(star);
  }, makeSeedStar());
  const countAfterGuard = await page.evaluate(
    () => (window.__galaxy as GalaxyHandle).store.getState().userStars.length
  );
  expect(countAfterGuard).toBe(1);

  // A genuinely new name clears the error and re-enables submit.
  await nameInput.fill('Acme Logistics');
  await expect(
    page.getByText('This company is already in your galaxy.')
  ).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add to galaxy' })).toBeEnabled();

  // Final cleanup: the suite must leave no user stars behind.
  await page.evaluate(() => {
    const s = (window.__galaxy as GalaxyHandle).store.getState();
    s.userStars.forEach((u: any) => s.removeUserStar(u.id));
  });
});

test('the landing page contact form renders and submits a pre-filled mailto', async ({ page }) => {
  // The root route is the explainer landing page.
  await page.goto('/');

  // The form lives in the #contact section, below the fold.
  await expect(
    page.getByText('Ready to map your own AI transformation?')
  ).toBeVisible();

  // All three fields render, and the submit button is inert until a message
  // is typed (the textarea is required).
  const name = page.getByLabel('Your name');
  const email = page.getByLabel('Your email');
  const message = page.getByLabel('Message');
  const send = page.getByRole('button', { name: 'Send message' });
  await expect(name).toBeVisible();
  await expect(email).toBeVisible();
  await expect(message).toBeVisible();
  await expect(send).toBeVisible();
  await expect(send).toBeDisabled();

  await name.fill('Jane Smith');
  await email.fill('jane@company.com');
  await message.fill(
    'We would love a full maturity assessment for our logistics arm.'
  );
  await expect(send).toBeEnabled();

  // Submitting opens the visitor's mail app pre-filled. Chromium surfaces
  // the mailto navigation as a (failed, external-protocol) request; assert
  // on that instead of a real navigation.
  const mailto = page.waitForEvent('request', (r) => r.url().startsWith('mailto:'));
  await send.click();
  const mailtoUrl = new URL((await mailto).url());

  // The gated Primero address is the recipient; kept base64 here, mirroring
  // the app, so the address never appears as plaintext in the repo.
  expect(mailtoUrl.pathname).toBe(atob('SG9kbGVyb25AZ21haWwuY29t'));
  expect(mailtoUrl.searchParams.get('subject')).toBe(
    'Primero Galaxy: contact from Jane Smith'
  );
  const body = mailtoUrl.searchParams.get('body');
  expect(body).toContain('We would love a full maturity assessment');
  expect(body).toContain('Jane Smith (jane@company.com)');

  // The confirmation renders after submit.
  await expect(
    page.getByText('Opening your email app. Your message is ready to send.')
  ).toBeVisible();
});

test('the contact address ships nowhere in the served page or JS (only base64)', async ({ page }) => {
  // The address is concealed: it exists only as base64 inside the client
  // bundle and is decoded at submit time. If anyone later renders it (or the
  // minifier folds the encoded string back to plaintext), this test catches
  // it. The plaintext is decoded at runtime here too, so it never appears as
  // a literal in the repo, mirroring the app's concealment.
  const JS_BASE64 = 'SG9kbGVyb25AZ21haWwuY29t'; // base64 of the gated address
  const ADDRESS = atob(JS_BASE64);
  const NAME = ADDRESS.split('@')[0];

  // Collect every JS response the landing page (and any prefetched routes)
  // actually fetches.
  const jsUrls = new Set<string>();
  page.on('response', (res) => {
    const type = res.headers()['content-type'] ?? '';
    if (type.includes('javascript')) jsUrls.add(res.url());
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Union with every script/preload reference in the served HTML, so the
  // scan covers the full static chunk list regardless of fetch timing.
  const html = await page.content();
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.js(?:[?#][^"]*)?)"/g)) {
    jsUrls.add(new URL(m[1], page.url()).toString());
  }

  const jsBodies = (
    await Promise.all(
      [...jsUrls].map(async (u) => {
        const res = await page.request.get(u);
        return res.ok() ? res.text() : '';
      })
    )
  ).join('\n');

  // The rendered page: no address, no name, and not even the base64 form.
  expect(html).not.toContain(ADDRESS);
  expect(html).not.toContain(NAME);
  expect(html).not.toContain(JS_BASE64);

  // The bundles: the only trace is the base64 form. The positive assertion
  // proves the scan actually covered the encoded address (not vacuous).
  expect(jsBodies).toContain(JS_BASE64);
  expect(jsBodies).not.toContain(ADDRESS);
  expect(jsBodies).not.toContain(NAME);
});

test('every landing-page CTA lands in the galaxy tool at /galaxy', async ({ page }) => {
  // Each CTA boots the tool, so budget past the suite default.
  test.setTimeout(180_000);

  const ctas = [
    { label: 'header', link: page.getByRole('link', { name: 'Enter the galaxy →' }) },
    {
      label: 'hero',
      // The hero is the first section; scope there so the final-CTA link of
      // the same name can't satisfy this assertion.
      link: page
        .locator('section')
        .first()
        .getByRole('link', { name: 'Enter the galaxy' }),
    },
    {
      label: 'contact',
      link: page.getByRole('link', { name: 'Add your company to the galaxy' }),
    },
    {
      label: 'final CTA',
      // Scoped by its heading so a section added later can't shift the
      // "last section" and silently change which link gets clicked.
      link: page
        .locator('section')
        .filter({
          has: page.getByRole('heading', {
            name: 'Your company could be one of the stars.',
          }),
        })
        .getByRole('link', { name: 'Enter the galaxy' }),
    },
    { label: 'footer', link: page.getByRole('link', { name: 'Launch the galaxy ↗' }) },
  ];

  for (const { label, link } of ctas) {
    await page.goto('/');
    await expect(link).toBeVisible();
    await link.click();

    // The CTA lands in the tool and the galaxy actually boots: URL, canvas,
    // and the app debug handles registered by the fresh mount.
    await expect(page).toHaveURL(/\/galaxy$/);
    await expect(page.locator('canvas')).toBeVisible();
    await waitForGalaxyBoot(page);
    const starCount = await page.evaluate(() => {
      let count = 0;
      (window.__galaxy as GalaxyHandle).r3f.scene.traverse((o: any) => {
        if (o.isInstancedMesh) count = o.count;
      });
      return count;
    });
    expect(starCount, `${label} CTA should land in the ${STAR_COUNT}-star galaxy`).toBe(STAR_COUNT);
  }
});

/**
 * Sample the landing page's reactive-lines canvas: a hash of sampled pixels
 * (animation moves the lines, so any redraw changes the hash), a count of
 * line pixels, and a count of void-background pixels (#030308). The void
 * count is the key painted-vs-blank discriminator: an unpainted canvas is
 * opaque black (#000, zero void pixels), while a painted frame is mostly
 * void with the lavender lines on top.
 */
async function readCanvasFrame(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return { hash: -1, nonBg: 0, voidPx: 0 };
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    let nonBg = 0;
    let voidPx = 0;
    for (let i = 0; i < d.length; i += 16) {
      hash = ((hash * 31 + d[i]) | 0) ^ (d[i + 1] << 4) ^ (d[i + 2] << 8);
      if (d[i] === 3 && d[i + 1] === 3 && d[i + 2] === 8) voidPx++;
      else nonBg++;
    }
    return { hash, nonBg, voidPx };
  });
}

test('the reactive-lines background paints and animates immediately on load (control)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // The frame painted on mount with NO interaction; the animation is not
  // deferred until a mouse move (the void background is painted, not a
  // blank black canvas).
  await expect
    .poll(async () => (await readCanvasFrame(page)).voidPx, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await readCanvasFrame(page)).nonBg, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Mouse input reaches the pattern: the exposed pointer target follows the
  // cursor. The running loop paints from this target, so input → animation
  // (the reduced-motion test below proves the loop can also be absent).
  await page.mouse.move(720, 450, { steps: 3 });
  const target = await page.evaluate(() => window.__lines!.target());
  expect(target).toEqual({ x: 720, y: 450 });
});

test('the reactive-lines background reacts to touch drags (touch fallback)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Touch devices have no cursor: the canvas still paints on load.
  await expect
    .poll(async () => (await readCanvasFrame(page)).voidPx, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // A touch drag (synthetic TouchEvent through the document listener) must
  // reach the pattern: the exposed pointer target follows the finger, so the
  // background stays interactive on devices with no mouse.
  await page.evaluate(() => {
    const touch = (x: number, y: number) =>
      new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
    document.dispatchEvent(
      new TouchEvent('touchmove', { touches: [touch(900, 300)], bubbles: true })
    );
  });
  const target = await page.evaluate(() => window.__lines!.target());
  expect(target).toEqual({ x: 900, y: 300 });
});

test('the reactive-lines background draws one static frame under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // A single static frame painted on mount, with no mouse interaction needed.
  await expect
    .poll(async () => (await readCanvasFrame(page)).voidPx, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const first = await readCanvasFrame(page);

  // Time passes: the canvas must NOT animate (frames stay identical).
  await page.waitForTimeout(400);
  expect((await readCanvasFrame(page)).hash).toBe(first.hash);

  // Even mouse movement must not start the animation.
  await page.mouse.move(700, 400, { steps: 5 });
  await page.waitForTimeout(300);
  expect((await readCanvasFrame(page)).hash).toBe(first.hash);
});

test('brands without indexed favicons ship stable local logos in the planet panel', async ({ page }) => {
  // Berkshire Hathaway has no favicon indexed by the favicon service, so its
  // planet-panel logo must load from /logos via the shared logoUrl helper,
  // and no favicon-service request may 404 while the profile is open.
  const faviconFailures: string[] = [];
  page.on('response', (res) => {
    const url = res.url();
    if (/(gstatic\.com|google\.com\/s2)/.test(url) && res.status() >= 400) {
      faviconFailures.push(`${url} -> ${res.status()}`);
    }
  });

  await waitForApp(page);

  // Open Berkshire's planet panel through the search palette.
  await page.getByRole('button', { name: 'Search' }).click();
  const input = page.getByRole('combobox', { name: 'Search companies' });
  await expect(input).toBeVisible();
  await input.fill('Berkshire');
  const option = page.getByRole('option', { name: /Berkshire/ });
  await expect(option).toBeVisible();
  await input.press('Enter');

  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode), {
      timeout: 15_000,
    })
    .toBe('planet');
  await expect(page.getByRole('heading', { name: 'Berkshire Hathaway' })).toBeVisible();

  // The profile logo is the local asset (the monogram fallback never fired),
  // and it serves 200.
  const logo = page.locator('img[src*="/logos/berkshire-hathaway"]');
  await expect(logo).toBeVisible();
  const res = await page.request.get('/logos/berkshire-hathaway.svg');
  expect(res.status()).toBe(200);

  // No favicon-service request 404ed while the profile was open.
  expect(faviconFailures, faviconFailures.join('\n') || 'no failures').toEqual([]);
});

test('the galaxy degrades gracefully when WebGL is unavailable', async ({ browser }) => {
  // Force WebGL off so the Three.js renderer cannot create a context, exactly
  // like a browser with hardware acceleration disabled or a GPU blocklist.
  const noWebGL = await browser.browserType().launch({
    args: ['--disable-webgl', '--disable-webgl2', '--disable-software-rasterizer'],
  });
  const page = await noWebGL.newPage({ baseURL: 'http://localhost:3100' });
  const uncaught: string[] = [];
  page.on('pageerror', (err: Error) => uncaught.push(String(err)));

  await page.goto('/galaxy');
  await page.waitForLoadState('networkidle');

  // The explanatory fallback renders instead of the raw Next.js
  // "Application error" boundary page.
  await expect(
    page.getByRole('heading', { name: /The galaxy needs WebGL to render/i })
  ).toBeVisible();
  await expect(
    page.getByText(/which your browser or device is currently blocking/i)
  ).toBeVisible();

  // Both escape hatches from the fallback are real routes.
  await expect(page.getByRole('link', { name: 'Read the methodology' })).toHaveAttribute(
    'href',
    '/methodology'
  );
  await expect(page.getByRole('link', { name: '← Back to home' })).toHaveAttribute('href', '/');

  // No uncaught client-side exception reaches the page.
  await page.waitForTimeout(1500);
  expect(uncaught).toEqual([]);
  await noWebGL.close();
});

test('the landing page warns before Enter the galaxy when WebGL is unavailable', async ({ browser }) => {
  // Same WebGL-off launch as the galaxy fallback test: a browser that cannot
  // create a WebGL context must be told before it clicks into the 3D scene.
  const noWebGL = await browser.browserType().launch({
    args: ['--disable-webgl', '--disable-webgl2', '--disable-software-rasterizer'],
  });
  const page = await noWebGL.newPage({ baseURL: 'http://localhost:3100' });
  const uncaught: string[] = [];
  page.on('pageerror', (err: Error) => uncaught.push(String(err)));

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // The hero warning appears once the client-side probe resolves, with a
  // real escape hatch to the methodology research trail.
  const notice = page.getByText(/Your browser has WebGL turned off/i);
  await expect(notice).toBeVisible();
  await expect(
    notice.getByRole('link', { name: /full methodology and every company's research trail/i })
  ).toHaveAttribute('href', '/methodology');

  // No uncaught client-side exception reaches the page.
  await page.waitForTimeout(1000);
  expect(uncaught).toEqual([]);
  await noWebGL.close();

  // Control: with WebGL available the notice never renders (no flash on the
  // supported path that the rest of the suite exercises).
  const okPage = await browser.newPage({ baseURL: 'http://localhost:3100' });
  await okPage.goto('/');
  await okPage.waitForLoadState('networkidle');
  await expect(okPage.getByText(/Your browser has WebGL turned off/i)).toHaveCount(0);
  await okPage.close();
});

test('the share button invokes the native Web Share API when available', async ({ page }) => {
  let shared: { title?: string; text?: string; url?: string } | null = null;
  await page.addInitScript(() => {
    // Stub the native share sheet: capture the payload instead of opening UI.
    (window as any).__sharedPayload = null;
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      value: async (data: any) => {
        (window as any).__sharedPayload = data;
      },
    });
  });
  await waitForApp(page);

  await page.getByRole('button', { name: 'Share galaxy' }).click();

  shared = await page.evaluate(() => (window as any).__sharedPayload);
  expect(shared).not.toBeNull();
  expect(shared!.title).toContain('AI Transformation Galaxy');
  expect(shared!.text).toContain('Fortune 500');
  expect(shared!.url).toMatch(/\/galaxy$/);
});

test('the share button copies the URL when the Web Share API is unavailable', async ({ page, context }) => {
  // No navigator.share in headless Chromium by default, which is exactly the
  // fallback path: the button must copy the current URL to the clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await waitForApp(page);

  const share = page.getByRole('button', { name: 'Share galaxy' });
  await expect(share).toBeVisible();
  await share.click();

  // The button flips to a transient "Copied" state for screen readers and
  // the visible label; the clipboard holds the galaxy URL.
  await expect(share).toContainText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(/\/galaxy$/);
});

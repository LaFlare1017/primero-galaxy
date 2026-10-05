/**
 * Adding a user company: the form, the persistent star it creates, and the
 * guard that refuses a duplicate.
 *
 * Split out of `galaxy-toast.spec.ts`, which was 91% one test. Under
 * `fullyParallel: false` a file is one worker's serial chunk, so a 445-line test
 * in a five-test file set the suite floor on its own — and splitting that FILE
 * would have moved nothing, because the long test would simply have carried
 * the same cost into a file of its own. It had to be cut at its phase seams:
 * everything up to and including the reload that proves the star hydrates.
 *
 * The delete half of the same journey is in galaxy-undo.spec.ts (sheet list)
 * and galaxy-planet-delete.spec.ts (planet panel).
 */
import { expect, test } from './worker-server';
import {
  makeSeedStar,
  waitForApp,
  waitForGalaxyBoot,
  STAR_COUNT,
  type GalaxyHandle,
} from './galaxy-helpers';

test('adding a company creates a persistent star and flies to it', async ({ page }) => {
  // This test used to be 445 lines and end in a delete, which is why it read as
  // the suite's slowest test for as long as anyone measured. It is now only the
  // add, and the measured number to hold it to is much smaller — see the
  // numbers in the file header of galaxy-planet-delete.spec.ts.
  //
  // 300s is left where it was rather than re-tuned to the shorter test. It was
  // never the timeout that cost the suite time: Playwright only spends it when
  // a test fails, and the failure this budget exists to stop is the camera
  // settle taking longer on a loaded machine. Narrowing it would buy nothing
  // and would re-open the failure it was raised to absorb.
  test.setTimeout(300_000);
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

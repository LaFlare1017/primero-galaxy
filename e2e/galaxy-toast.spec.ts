/**
 * The toast window: a hydrated toast keeps only the window it has left, an
 * expired one never comes back, and removing the same company twice never
 * stacks two of them.
 *
 * The timing-sensitive tests live here together, because the toast window is
 * the suite's only real clock: `TOAST_DURATION_MS` is mirrored from
 * store/galaxyStore.ts and the hydrated-window test measures a dismissal
 * against a deadline it computes itself. Keeping them in one file means one
 * worker owns every test that waits on that clock.
 *
 * Which is also why this file is small now. It used to open with a 445-line
 * test that had nothing to do with toasts — it added a company and deleted it
 * again — and that test was 91% of the file, which made this file the suite's
 * floor at every worker count. The add is in galaxy-user-stars.spec.ts, the two
 * delete halves are in galaxy-undo.spec.ts and galaxy-planet-delete.spec.ts, and
 * the numbers behind that decision are in galaxy-planet-delete.spec.ts's header.
 *
 * Split out of the single 22-test `galaxy.spec.ts`; see galaxy-helpers.ts.
 */
import { expect, test } from './worker-server';
import {
  makeSeedStar,
  waitForApp,
  waitForGalaxyBoot,
  TOAST_DURATION_MS,
  type GalaxyHandle,
} from './galaxy-helpers';

test('a hydrated toast keeps only its remaining window (no fresh duration)', async ({ page }) => {
  test.setTimeout(120_000);
  await waitForApp(page);

  // Seed a user star + an "added" toast whose window is already mostly gone.
  //
  // The remaining window has to be wide enough to survive THIS test's own
  // setup. A reload plus a WebGL mount costs ~2-5s, and the window is running
  // from the moment the seed is written, so a narrow one expires before the
  // first assertion is even reached — which is how this test came to fail only
  // in isolation, where the mount is slowest. 9s leaves ~3x headroom over the
  // measured mount while still being half a fresh window, which is the whole
  // point: the dismissal below must land near 9s, not 12s.
  const remainingMs = 9000;
  const createdAt = await page.evaluate(
    ({ star, ms, remaining }) => {
      localStorage.setItem('primero-galaxy:user-stars', JSON.stringify([star]));
      const createdAt = Date.now() - (ms - remaining);
      sessionStorage.setItem(
        'primero-galaxy:pending-toasts',
        JSON.stringify([{ id: 't-remaining', kind: 'added', star, createdAt }])
      );
      return createdAt;
    },
    { star: makeSeedStar(), ms: TOAST_DURATION_MS, remaining: remainingMs }
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
  await expect(toast).toBeVisible({ timeout: 10_000 });

  // …but its timer only has the remaining window. Read the store rather than
  // the DOM: the toast has a 350ms exit animation, so "hidden" is a later and
  // blurrier signal than the dismissal this is actually about. The store drops
  // it at createdAt + TOAST_DURATION_MS — measured across reloads, dismissal
  // lands within ~1s of that deadline, so the slack below is a real bound and
  // not a machine-speed guess.
  await expect
    .poll(
      () =>
        page.evaluate(() => ((window.__galaxy as GalaxyHandle).store.getState().toasts ?? []).length),
      { timeout: 20_000, intervals: [50] }
    )
    .toBe(0);

  const dismissedAt = Date.now();
  const deadline = createdAt + TOAST_DURATION_MS;
  // It waited out the remaining window: dismissed no earlier than the deadline
  // (a 250ms floor in ToastStack can shave the last sliver)…
  expect(dismissedAt).toBeGreaterThanOrEqual(deadline - 250);
  // …and no later than a fresh window would allow. A hydration that reset the
  // timer would dismiss a full TOAST_DURATION_MS after the reload, which is at
  // least `remainingMs` later than the deadline, so this bound cannot be met by
  // the bug it guards against.
  expect(dismissedAt).toBeLessThan(deadline + (TOAST_DURATION_MS - remainingMs) - 1000);

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

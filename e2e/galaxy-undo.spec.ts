/**
 * Undo after an accidental refresh: a removal toast is persisted, so the Undo
 * button is still offered after a reload, and pressing it puts the star back
 * without putting the planet view back with it.
 *
 * The seam that made this its own file. In the original this phase ran on a
 * star the previous phase had just added through the form, so it inherited a
 * camera flight and an add it does not care about. It seeds the star instead,
 * which costs a mount and nothing else.
 *
 * Split out of `galaxy-toast.spec.ts`; see galaxy-helpers.ts.
 */
import { expect, test } from './worker-server';
import {
  makeSeedStar,
  waitForApp,
  waitForGalaxyBoot,
  type GalaxyHandle,
} from './galaxy-helpers';

const MERIDIAN = 'Meridian Logistics';

test('a removal survives a reload, Undo restores the star but not the view', async ({ page }) => {
  // 18.8s serial — a mount, a reload and another reload, and the serial figure
  // says how cheap it is on a machine that is not also running three other
  // workers. At 4 workers on a loaded box it is 253.3s: 13.5x, because every step
  // waits on a WebGL boot and there are three of them.
  //
  // That is why this is 420s rather than the 300s the 445-line test it came out
  // of carried. 300s left 1.2x on the loaded figure, which is not a margin, and
  // the budget should be set from what the test needs on the machine it runs on
  // rather than from what the test used to be bundled with.
  test.setTimeout(420_000);
  await waitForApp(page);

  // Seed the user star the sheet's "Your stars" list is about to remove. It is
  // seeded rather than added through the form because this phase is about what
  // survives a refresh, and an add would cost a camera flight to prove nothing
  // this phase asserts.
  await page.evaluate((star) => {
    localStorage.setItem('primero-galaxy:user-stars', JSON.stringify([star]));
  }, makeSeedStar(MERIDIAN));
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

  // --- Delete through the sheet's "Your stars" list (inline delete) ---
  await page.getByRole('button', { name: 'Add Company' }).click();
  await expect(page.getByRole('heading', { name: 'Add Your Company' })).toBeVisible();
  await expect(page.getByText('Your stars')).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Remove ${MERIDIAN}` })
  ).toBeVisible();
  await page.getByRole('button', { name: `Remove ${MERIDIAN}` }).click();

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
  //
  // The app is in the galaxy view because the reload above put it there, not
  // because the removal chose it — that is what the assertion pins, and it is
  // worth being blunt about because the obvious "improvement" of selecting the
  // star first makes it fail: an Undo from planet view deliberately restores
  // the view. galaxy-planet-delete.spec.ts is where that behaviour is the
  // subject rather than a side effect.
  await expect
    .poll(() => page.evaluate(() => (window.__galaxy as GalaxyHandle).store.getState().mode))
    .toBe('galaxy');

  // Final cleanup: the suite must leave no user stars behind.
  await page.evaluate(() => {
    const s = (window.__galaxy as GalaxyHandle).store.getState();
    s.userStars.forEach((u: any) => s.removeUserStar(u.id));
  });
});

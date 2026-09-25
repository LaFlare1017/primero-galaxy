import { expect, test } from '@playwright/test';

/**
 * Reduced-motion proof (the e2e layer of the prefers-reduced-motion pass;
 * see components/ui/useReducedMotion.ts and MotionProvider.tsx):
 *
 *   1. Delegate: with the OS setting emulated to "reduce", the agent-working
 *      state keeps every functional cue (live-region status text, disabled
 *      composer, disabled decision buttons) while the decorative canvas orb
 *      never mounts. Functional does not mean motionless: the message flow
 *      still works, nothing is hidden.
 *   2. Galaxy: the three.js idle rotation is decorative; under "reduce" the
 *      starfield group's quaternion must be frozen while the scene keeps
 *      rendering (labels, hover, camera all still work — motion is the only
 *      thing removed). We compare the group's world quaternion across two
 *      samples one second apart; an identity difference means frozen.
 *
 * Playwright's reducedMotion: 'reduce' context option emulates the OS-level
 * prefers-reduced-motion: reduce media query, which is exactly what the
 * matchMedia hook and MotionConfig reducedMotion="user" read.
 */

test.describe('prefers-reduced-motion', () => {
  test('Delegate keeps functional cues but never mounts the decorative orb', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/delegate');
    await page.getByPlaceholder('e.g. Jordan').fill('E2E Reduced');
    await page.getByRole('button', { name: /Start scenario/ }).click();

    const composer = page.locator('input[placeholder="Ask the agent or direct its work…"]');
    await expect(composer).toBeVisible();

    // Hold the agent turn open long enough to inspect the working state.
    await page.evaluate(() => {
      const orig = window.fetch.bind(window);
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        if (String(args[0]).includes('/api/delegate/chat')) {
          await new Promise((r) => setTimeout(r, 4000));
        }
        return orig(...args);
      };
    });

    await composer.fill('What should I check first?');
    await page.keyboard.press('Enter');

    // Functional cues present: live-region status text and disabled composer.
    await expect(page.locator('[role="status"]')).toContainText('agent is working with the ERP');
    await expect(composer).toBeDisabled();

    // Decorative orb absent: no canvas anywhere in the page while working.
    await expect(page.locator('canvas')).toHaveCount(0);

    // Reply lands and everything returns to rest.
    await expect(page.locator('[role="status"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(composer).toBeEnabled();
  });

  test('Galaxy freezes the idle rotation but keeps rendering', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/galaxy');

    // Wait for the R3F canvas and the debug handle to appear.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => {
      const w = window as typeof window & { __galaxy?: { r3f?: { scene?: unknown } } };
      return Boolean(w.__galaxy?.r3f?.scene);
    });

    // Sample the galaxy group's world quaternion twice, ~1s apart. The
    // rotation drift (0.008 rad/s) would produce a visible delta; frozen is 0.
    const delta = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const w = window as unknown as {
            __galaxy: {
              r3f: { scene: { getObjectByName(name: string): { getWorldQuaternion(q: unknown): unknown } | null } };
              THREE: {
                Quaternion: new () => {
                  copy(o: unknown): unknown;
                  angleTo(o: unknown): number;
                };
              };
            };
          };
          const { r3f, THREE } = w.__galaxy;
          const group = r3f.scene.getObjectByName('galaxy-group');
          if (!group) {
            resolve(-1); // group not found: fail loudly below
            return;
          }
          const a = new THREE.Quaternion();
          const b = new THREE.Quaternion();
          group.getWorldQuaternion(a);
          setTimeout(() => {
            group.getWorldQuaternion(b);
            resolve(a.angleTo(b));
          }, 1000);
        })
    );

    // delta -1 = group missing; anything above ~1e-6 rad means it rotated.
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThan(1e-6);
  });
});

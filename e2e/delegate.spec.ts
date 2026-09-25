import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end proof of the Delegate agent-chat effect layer (Libraries.dev
 * border-beam + thinking-orbs, see components/ui/AgentEffects.tsx):
 *
 *   1. starting a scenario boots the workspace with an idle composer
 *      (beam wrapper mounted, no effect layers, no orb)
 *   2. sending a chat message puts the agent to work: the thinking orb
 *      appears with its live-region status line, the composer disables,
 *      and the composer beam activates
 *   3. when the reply lands everything tears down: orb unmounted, status
 *      gone, composer re-enabled, beam idle again
 *   4. scenario 6 shows the pending-decision card with its breathing
 *      beam (pulse-inner) while the authorization is outstanding
 *
 * The bundled mock agent answers in milliseconds, far faster than any
 * human can observe, so the working state is held open by intercepting
 * /api/delegate/chat and delaying the response. The delay is added
 * AFTER the app's own fetch gets through: this tests real UI state
 * transitions, not network behavior.
 */

const COMPOSER = 'input[placeholder="Ask the agent or direct its work…"]';
const STATUS = '[role="status"]';

/** Hold /api/delegate/chat responses open for `ms` milliseconds. */
async function delayChat(page: Page, ms: number) {
  await page.evaluate((delayMs) => {
    const w = window as typeof window & {
      __chatDelayMs?: number;
      __chatDelayInstalled?: boolean;
    };
    w.__chatDelayMs = delayMs;
    if (w.__chatDelayInstalled) return;
    w.__chatDelayInstalled = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0]);
      if (url.includes('/api/delegate/chat') && w.__chatDelayMs) {
        await new Promise((r) => setTimeout(r, w.__chatDelayMs));
      }
      return orig(...args);
    };
  }, ms);
}

/**
 * Beam visibility, 0..1: the effect layers are driven by a JS loop (pulse)
 * or registered custom properties (rotate), so CSS animationName is always
 * "none" and cannot discriminate. The bloom layer's opacity is 0 when idle
 * and visibly nonzero while the beam runs (verified against the real
 * component in both states).
 */
function beamActivity(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((el) => {
    const bloom = el.querySelector('[data-beam-bloom]');
    return bloom ? parseFloat(getComputedStyle(bloom).opacity) : 0;
  });
}

async function startScenario(page: Page, name: string) {
  await page.goto('/delegate');
  await page.getByPlaceholder('e.g. Jordan').fill(name);
  await page.getByRole('button', { name: /Start scenario/ }).click();
  await expect(page.locator(COMPOSER)).toBeVisible();
}

test.describe('Delegate agent effects', () => {
  test('composer beam + thinking orb activate while the agent works, then tear down', async ({
    page,
  }) => {
    await startScenario(page, 'E2E Effects');
    await delayChat(page, 4000);

    // Idle: beam wrapper mounted (decoration off), no orb, no status.
    const beam = page.locator('[data-beam]').first();
    await expect(beam).toHaveCount(1);
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator(STATUS)).toHaveCount(0);

    // Send: working state appears and holds while the response is delayed.
    await page.locator(COMPOSER).fill('What should I check first?');
    await page.keyboard.press('Enter');
    await expect(page.locator(STATUS)).toContainText('agent is working with the ERP');
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.locator(COMPOSER)).toBeDisabled();
    await expect(page.locator('[role="status"] canvas')).toHaveAttribute('aria-label', /Working/i);

    // The beam's bloom layer becomes visible while the beam runs.
    await expect.poll(() => beamActivity(beam)).toBeGreaterThan(0.05);

    // Reply lands: full teardown back to idle.
    await expect(page.locator(STATUS)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator(COMPOSER)).toBeEnabled();
    await expect(page.locator('[data-chat-message]')).toHaveCount(2); // user msg + reply
    await expect.poll(() => beamActivity(beam)).toBe(0); // beam idle again
  });

  test('scenario 6 shows the pending-decision beam until the posting decision is made', async ({
    page,
  }) => {
    // Drive the app exactly as a participant would: scenario menu -> s6 ->
    // start. The menu resets run state, so no deep-linking is needed.
    await page.goto('/delegate');
    await page.getByPlaceholder('e.g. Jordan').fill('E2E Decision');
    await page.getByRole('button', { name: /Post the March accruals/ }).click();
    await page.getByRole('button', { name: /Start scenario/ }).click();

    const card = page.getByText(/drafts reviewed/);
    await expect(card).toBeVisible();
    const decisionBeam = card.locator('xpath=ancestor::*[@data-beam][1]');
    await expect(decisionBeam).toHaveCount(1);
    // Pulse types keep breathing (JS-driven) while the decision is open.
    await expect.poll(() => beamActivity(decisionBeam)).toBeGreaterThan(0.05);

    // Decide: the card (and its beam) unmount, feedback appears instead.
    await page.getByRole('button', { name: 'Keep posting with me' }).click();
    await expect(decisionBeam).toHaveCount(0);
    await expect(page.getByText(/the drafts remain unposted/i)).toBeVisible();
  });
});

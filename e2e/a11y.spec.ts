import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Automated accessibility gate (axe-core) across all three product
 * surfaces, wired into the same Playwright run CI already gates on:
 *
 *   Galaxy    / (explainer landing), /galaxy overview, planet view with the
 *             detail panel open, and the Add Your Company dialog
 *   FinBench  /finbench run explorer, a deep-linked filter state, the
 *             Filter popover open, and the task-detail page
 *   Delegate  /delegate landing, the workspace while the agent is working
 *             (live-region orb + status), and the facilitator console with
 *             real seeded rows
 *
 * The scan covers the WCAG 2.1 A/AA rule tags (axe's best-practice and
 * experimental tags are deliberately out of scope, matching the Lighthouse
 * accessibility category). Scans run against INTERACTIVE states, not just
 * loaded routes, because dialogs, popovers, and live regions are where
 * regressions hide. Any violation of the scanned tags fails the test —
 * new violations must be fixed or the exclusion must be explicitly
 * justified here, never silently widened.
 *
 * Galaxy scans wait out the landing sequence (staggered star appear +
 * title animation) exactly like e2e/galaxy.spec.ts, and Delegate drives
 * the real session/submit APIs for facilitator rows (accumulating store →
 * unique per-run labels), following e2e/facilitator-grid.spec.ts.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Minimal shape of an axe violation, for readable failure output. */
interface Violation {
  id: string;
  impact?: string;
  help: string;
  nodes: { target: string[]; html: string }[];
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 5)
        .map((n) => {
          const target = n.target.join(' ') || '(html)';
          const html = n.html.length > 120 ? `${n.html.slice(0, 120)}…` : n.html;
          return `    - ${target}\n      ${html}`;
        });
      const more = v.nodes.length > 5 ? `    - … (+${v.nodes.length - 5} more)` : '';
      return `[${v.impact ?? '?'}] ${v.id}: ${v.help}\n${nodes.join('\n')}${more}`;
    })
    .join('\n');
}

/**
 * Run axe over the page (or a sub-tree via `context`) and fail with a
 * readable list if any WCAG 2.1 A/AA violation exists.
 */
async function expectNoA11yViolations(page: Page, context?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (context) builder = builder.include(context);
  const { violations } = await builder.analyze();
  if (violations.length === 0) return;
  // A thrown Error (not a diffing expect) keeps CI output readable: one
  // line per rule, not axe's full JSON.
  throw new Error(
    `axe found ${violations.length} WCAG 2.1 A/AA violation(s)${
      context ? ` within ${context}` : ''
    }:\n${formatViolations(violations as Violation[])}`,
  );
}

// ── Galaxy ──────────────────────────────────────────────────────────────

/** Boot /galaxy and let the landing sequence finish (see galaxy.spec.ts). */
async function waitForGalaxy(page: Page) {
  await page.goto('/galaxy');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g = (window as unknown as { __galaxy?: { store?: unknown; controls?: unknown } })
            .__galaxy;
          return Boolean(g?.store && g?.controls);
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.waitForTimeout(6500);
}

test.describe('Galaxy accessibility', () => {
  test('landing page is clean', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Enter the galaxy →' }).first()).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('galaxy overview (canvas + overlays) is clean', async ({ page }) => {
    await waitForGalaxy(page);
    await expectNoA11yViolations(page);
  });

  test('planet view with the detail panel open is clean', async ({ page }) => {
    await waitForGalaxy(page);

    // Fly to a planet via the search palette (keyboard path, no raycast).
    await page.getByRole('button', { name: 'Search' }).click();
    const input = page.getByRole('combobox', { name: 'Search companies' });
    await expect(input).toBeVisible();
    await input.fill('Nvidia');
    const option = page.getByRole('option', { name: /Nvidia/ });
    await expect(option).toBeVisible();
    // Pin the highlighted row before Enter: the combobox selects
    // results[activeIndex], so the visible option must BE the selected one.
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __galaxy?: { store: { getState(): { mode: string } } };
                }
              ).__galaxy?.store.getState().mode,
          ),
        { timeout: 15_000 },
      )
      .toBe('planet');
    await page.waitForTimeout(1000); // panel slide-in

    await expectNoA11yViolations(page);
  });

  test('Add Your Company dialog is clean', async ({ page }) => {
    await waitForGalaxy(page);
    await page.getByRole('button', { name: 'Add Company' }).click();
    await expect(page.getByRole('heading', { name: 'Add Your Company' })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

// ── FinBench ────────────────────────────────────────────────────────────

const MISS_FILTER = encodeURIComponent(
  JSON.stringify([{ columnId: 'result', type: 'option', operator: 'is', values: ['miss'] }]),
);

test.describe('FinBench accessibility', () => {
  test('run explorer with matrix is clean', async ({ page }) => {
    await page.goto('/finbench');
    await expect(page.getByText('of 14 runs')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('deep-linked filtered state is clean', async ({ page }) => {
    await page.goto(`/finbench?filters=${MISS_FILTER}`);
    await expect(page.getByText('1 of 14 runs')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('Filter popover is clean while open', async ({ page }) => {
    await page.goto('/finbench');
    await expect(page.getByText('of 14 runs')).toBeVisible();
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByPlaceholder('Search...')).toBeFocused();
    await expectNoA11yViolations(page);
  });

  test('task detail page is clean', async ({ page }) => {
    await page.goto('/finbench/tasks/asc606-breakage-001');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('asc606-breakage-001');
    await expectNoA11yViolations(page);
  });
});

// ── Delegate ────────────────────────────────────────────────────────────

const COMPOSER = 'input[placeholder="Ask the agent or direct its work…"]';
const STATUS = '[role="status"]';

const STAMP = Date.now().toString(36).slice(-5);
const WORKING_A = `E2E A11yA ${STAMP}`;
const WORKING_B = `E2E A11yB ${STAMP}`;
const SUBMITTED_S5 = `E2E A11yS5 ${STAMP}`;

const MIN_40_WORDS =
  'WHAT I CONCLUDED: The revenue recognition defect was identified and the ' +
  'contract treatment reviewed against the policy. WHAT I CHECKED: I opened ' +
  'the journal entries, the contract document, and the account summaries for ' +
  'the period. WHAT I AM UNSURE ABOUT: Nothing material remains open here.';

interface FacilitatorRow {
  participant: string;
}

async function startRun(page: Page, participantLabel: string, scenarioId: string) {
  const res = await page.request.post('/api/delegate/session', {
    data: { participantLabel, scenarioId },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { sessionId: string; runId: string };
}

async function waitUntilSeeded(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const data = (await (await page.request.get('/api/delegate/facilitator')).json()) as {
          rows: FacilitatorRow[];
        };
        return data.rows.filter((r) =>
          [WORKING_A, WORKING_B, SUBMITTED_S5].some((label) => r.participant === label),
        ).length;
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(3);
}

/** Start a scenario and hold the agent reply open while we scan. */
async function startScenario(page: Page, name: string) {
  await page.goto('/delegate');
  await page.getByPlaceholder('e.g. Jordan').fill(name);
  await page.getByRole('button', { name: /Start scenario/ }).click();
  await expect(page.locator(COMPOSER)).toBeVisible();
}

async function delayChat(page: Page, ms: number) {
  await page.evaluate((delayMs) => {
    const w = window as typeof window & { __chatDelayMs?: number; __chatDelayInstalled?: boolean };
    w.__chatDelayMs = delayMs;
    if (w.__chatDelayInstalled) return;
    w.__chatDelayInstalled = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).includes('/api/delegate/chat') && w.__chatDelayMs) {
        await new Promise((r) => setTimeout(r, w.__chatDelayMs));
      }
      return orig(...args);
    };
  }, ms);
}

test.describe('Delegate accessibility', () => {
  test('landing page is clean', async ({ page }) => {
    await page.goto('/delegate');
    await expect(page.getByPlaceholder('e.g. Jordan')).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('workspace is clean while the agent is working (orb + live region)', async ({ page }) => {
    await startScenario(page, 'E2E A11y');
    await delayChat(page, 4000);
    await page.locator(COMPOSER).fill('What should I check first?');
    await page.keyboard.press('Enter');
    await expect(page.locator(STATUS)).toContainText('agent is working with the ERP');
    await expectNoA11yViolations(page);
  });

  test.describe('facilitator console', () => {
    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      await startRun(page, WORKING_A, 's1');
      await startRun(page, WORKING_B, 's2');
      const seeded = await startRun(page, SUBMITTED_S5, 's5');
      const submit = await page.request.post('/api/delegate/submit', {
        data: { runId: seeded.runId, answer: MIN_40_WORDS },
      });
      expect(submit.ok()).toBeTruthy();
      await page.close();
    });

    test('facilitator console with seeded rows is clean', async ({ page }) => {
      // The one scan whose cost was proportional to the ROOM rather than to
      // the console: axe walks every element, and the grid mounted a row per
      // session in a store the suite grew on every run. Both halves of that
      // are now fixed — the grid renders one page of the room (GRID_WINDOW,
      // so a store of any size costs a bounded DOM) and the suite runs
      // against its own store, cleared per run (playwright.config.ts) — so
      // this scan walks a room the size of one run's own seeding.
      //
      // `slow()` stays as headroom rather than a workaround: a server handed
      // to the suite from outside (`reuseExistingServer`) serves a workshop
      // store, and the scan stays a WHOLE-page one — scoping axe to the
      // toolbar would be a smaller claim wearing the same name.
      test.slow();
      await page.goto('/delegate/facilitator');
      await waitUntilSeeded(page);
      await expectNoA11yViolations(page);
    });
  });
});

import { expect, test, type Page } from '@playwright/test';
import { CONSOLE_CHORDS, CONSOLE_KEYS } from '../components/delegate/consoleShortcuts';

/**
 * Every binding the console declares, pressed, with a visible effect demanded
 * of each.
 *
 * The sheet documents the declaration, so a row that is documented and does
 * nothing is the lie this console's keyboard work exists to prevent. Until
 * this file, the proof that each row worked lived in whichever feature spec
 * happened to cover it — a weaker claim than it sounds, because "every feature
 * has a test" does not imply "every documented binding was pressed": add a row
 * to the declaration and nothing failed. So the list of bindings is READ from
 * the declaration here, and the exercises are checked against it in both
 * directions. A declared row with no exercise fails before a browser opens; a
 * key that does nothing fails its own step, named.
 *
 * The console is reloaded between steps deliberately. Every binding has to
 * work from a state the console can actually be in, and reloading is the
 * cheapest honest way to say "the room, freshly opened" — which is where a
 * facilitator meets most of these keys. The few that need more say so in
 * `prepare`, and they are the rows whose gate is about something other than
 * the room being on screen.
 */

/** What the room looks like immediately before a key is pressed. */
interface Room {
  /**
   * Every participant the walk can reach, in the grid's display order — the
   * whole room, read from the API rather than off the screen, because the
   * grid renders one page at a time (GRID_WINDOW) and the walk is not clipped
   * by that. An effect that asked the SCREEN where the last row was would call
   * a four-hundred-row room two hundred rows long.
   */
  order: string[];
  /** The participant the cursor is on, or null on a cold console. */
  cursor: string | null;
  /** The participant the watch pane is mirroring, or null when it is shut. */
  pane: string | null;
}

/**
 * One declared binding, exercised: how the console reaches a state where the
 * binding is live, and the visible change its key has to make. `before` is the
 * room as it was immediately before the press; `key` is which of the row's
 * keys is being pressed, since a row may bind alternatives (Enter and w).
 */
interface Exercise {
  prepare?: (page: Page) => Promise<void>;
  effect: (page: Page, before: Room, key: string) => Promise<void>;
}

const STAMP = Date.now().toString(36).slice(-5);

const rows = (page: Page) => page.locator('tbody tr');
const pane = (page: Page) => page.locator('section[aria-label^="Watching run for"]');
const panel = (page: Page) => page.locator('[data-radix-popper-content-wrapper] [data-state="open"]');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts' });
const palette = (page: Page) => page.getByPlaceholder('Type a command or search…');
const actions = (page: Page) => page.locator('[role="status"][aria-label="Console action"]');
const sheetTrigger = (page: Page) => page.getByRole('button', { name: /for all$/ });
const viewsTrigger = (page: Page) => page.getByRole('button', { name: 'Views', exact: true });

/** The room as the console is showing it, read without waiting for anything. */
async function room(page: Page): Promise<Room> {
  const shown = await page.evaluate(() => {
    const cell = (row: Element) => (row.querySelector('td')?.textContent ?? '').trim();
    const current = document.querySelector('tbody tr[aria-current="true"]');
    const mirror = document.querySelector('section[aria-label^="Watching run for"]');
    const label = mirror?.getAttribute('aria-label') ?? null;
    return {
      cursor: current === null ? null : cell(current),
      pane: label === null ? null : label.replace('Watching run for ', ''),
    };
  });
  return { ...shown, order: (await apiRoom(page)).map((row) => row.participant) };
}

/** The room as the API reports it, in the grid's own default order. */
async function apiRoom(page: Page): Promise<Array<{ participant: string; runId: string }>> {
  const res = await page.request.get('/api/delegate/facilitator');
  const data = (await res.json()) as { rows: Array<{ participant: string; runId?: string }> };
  return data.rows
    .filter((row): row is { participant: string; runId: string } => typeof row.runId === 'string')
    .sort((a, b) => a.participant.localeCompare(b.participant));
}

/** Grow the room until the walk has somewhere to go, idempotently. */
async function ensureRoom(page: Page, size: number): Promise<void> {
  for (let i = (await apiRoom(page)).length; i < size; i += 1) {
    const res = await page.request.post('/api/delegate/session', {
      data: { participantLabel: `zz E2E Keys${String(i)} ${STAMP}`, scenarioId: 's1' },
    });
    expect(res.ok()).toBeTruthy();
  }
}

/** Step the cursor down off the first row, so a jump has a distance to travel. */
async function walkTo(page: Page, index: number): Promise<void> {
  for (let i = 0; i < index; i += 1) await page.keyboard.press('j');
}

/** Open the mirror on the nth participant, the way a shared link does. */
async function watchAt(page: Page, index: number): Promise<void> {
  const target = (await apiRoom(page))[index];
  await page.goto(`/delegate/facilitator?watch=${target.runId}`);
  await expect(pane(page)).toBeVisible({ timeout: 15_000 });
}

const last = (names: readonly string[]) => names[names.length - 1];

const EXERCISES: Record<string, Exercise> = {
  'walk-down': {
    // From a cold console, which is also where this pins where a walk enters.
    effect: async (page, before) => {
      await expect.poll(async () => (await room(page)).cursor).toBe(before.order[0]);
    },
  },
  'walk-up': {
    effect: async (page, before) => {
      await expect.poll(async () => (await room(page)).cursor).toBe(last(before.order));
    },
  },
  commit: {
    prepare: async (page) => walkTo(page, 1),
    effect: async (page, before) => {
      await expect(pane(page)).toHaveAttribute('aria-label', `Watching run for ${before.cursor}`, {
        timeout: 10_000,
      });
      await expect.poll(() => new URL(page.url()).searchParams.get('watch')).not.toBeNull();
    },
  },
  'sweep-step': {
    prepare: async (page) => watchAt(page, 1),
    effect: async (page, before, key) => {
      // One row along the displayed room, wrapping at the ends — which is what
      // the transport's indicator counts.
      const step = key === 'ArrowRight' ? 1 : -1;
      const at = before.order.indexOf(before.pane ?? '');
      const expected = before.order[(at + step + before.order.length) % before.order.length];
      await expect(pane(page)).toHaveAttribute('aria-label', `Watching run for ${expected}`, {
        timeout: 10_000,
      });
    },
  },
  'sweep-jump': {
    prepare: async (page) => watchAt(page, 1),
    effect: async (page, before, key) => {
      const expected = key === 'End' ? last(before.order) : before.order[0];
      await expect(pane(page)).toHaveAttribute('aria-label', `Watching run for ${expected}`, {
        timeout: 10_000,
      });
    },
  },
  'dismiss-pane': {
    prepare: async (page) => watchAt(page, 0),
    effect: async (page) => {
      await expect(pane(page)).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('watch')).toBeNull();
    },
  },
  'open-sheet': {
    effect: async (page) => {
      await expect(sheet(page)).toBeVisible();
    },
  },
  'close-sheet': {
    // Opened by its trigger rather than by `?`, so this step is about the
    // dismissal and not about the key the row above already covers.
    prepare: async (page) => {
      await sheetTrigger(page).click();
      await expect(sheet(page)).toBeVisible();
    },
    effect: async (page) => {
      await expect(sheet(page)).toHaveCount(0);
    },
  },
  'dismiss-views': {
    prepare: async (page) => {
      await viewsTrigger(page).click();
      await expect(panel(page)).toBeVisible();
    },
    effect: async (page) => {
      await expect(panel(page)).toHaveCount(0);
    },
  },
  'open-palette': {
    // The declared spelling, Meta+k: the palette accepts both that and the
    // Ctrl+K the label promises PC keyboards, and this pins the row's own.
    effect: async (page) => {
      await expect(palette(page)).toBeVisible();
    },
  },
  'jump-first': {
    prepare: async (page) => walkTo(page, 2),
    effect: async (page, before) => {
      expect(before.cursor, 'the cursor started away from the first row').not.toBe(before.order[0]);
      await expect.poll(async () => (await room(page)).cursor).toBe(before.order[0]);
    },
  },
  'jump-last': {
    prepare: async (page) => walkTo(page, 2),
    effect: async (page, before) => {
      expect(before.cursor, 'the cursor started away from the last row').not.toBe(last(before.order));
      await expect.poll(async () => (await room(page)).cursor).toBe(last(before.order));
    },
  },
  'watch-cursor': {
    prepare: async (page) => walkTo(page, 2),
    effect: async (page, before) => {
      await expect(pane(page)).toHaveAttribute('aria-label', `Watching run for ${before.cursor}`, {
        timeout: 10_000,
      });
    },
  },
  'copy-cursor-link': {
    prepare: async (page) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await walkTo(page, 1);
    },
    effect: async (page, before) => {
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
        .toContain('/delegate?run=');
      await expect(actions(page)).toHaveText(`Run link copied for ${before.cursor}`);
    },
  },
  'open-views': {
    effect: async (page) => {
      await expect(panel(page)).toBeVisible();
    },
  },
};

/**
 * The declaration, flattened: every row and every chord, in sheet order, each
 * as the list of presses that completes it.
 *
 * The two shapes differ by design — a row's keys are alternatives (`Enter` or
 * `w`), a chord's is one sequence (`g i`) — so they are normalised here rather
 * than in the loop. Iterating a chord's string directly would press its
 * prefix, the space between and its second key as three separate bindings,
 * and only one of those is a key the console answers to.
 */
const DECLARED: ReadonlyArray<{ id: string; keys: readonly string[] }> = [
  ...CONSOLE_KEYS.map((row) => ({ id: row.id, keys: row.keys })),
  ...CONSOLE_CHORDS.map((chord) => ({ id: chord.id, keys: [chord.keys] })),
];

test('every declared binding does something visible', async ({ page }) => {
  // The check that makes this file worth having: the declaration is the list
  // of bindings and the table above is the list of exercises, so they have to
  // be the same list. A row added to the declaration without an exercise
  // fails HERE, before a browser opens — which is the only way "documented and
  // working" stays a property of the console rather than of whoever
  // remembered to write a test.
  expect(
    Object.keys(EXERCISES).sort(),
    'every declared binding has an exercise, and every exercise names a declared binding',
  ).toEqual(DECLARED.map((row) => row.id).sort());

  await ensureRoom(page, 3);

  for (const row of DECLARED) {
    // Per KEY rather than per row: a row may bind alternatives, and each one
    // is a key a facilitator can press.
    for (const key of row.keys) {
      await test.step(`${row.id} — ${key}`, async () => {
        await page.goto('/delegate/facilitator');
        await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
        const exercise = EXERCISES[row.id];
        await exercise.prepare?.(page);
        const before = await room(page);
        // Chords are typed as a sequence, which is also how the hook reads
        // them: the room and its declaration use one spelling.
        for (const pressed of key.split(' ')) await page.keyboard.press(pressed);
        await exercise.effect(page, before, key);
      });
    }
  }
});

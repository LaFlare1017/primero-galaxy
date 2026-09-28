import { expect, test, type Page } from '@playwright/test';

import {
  PALETTE_KEYS,
  PALETTE_SURFACE_ROWS,
  gateIsLive,
  layerIsLive,
  liveShortcuts,
  paletteGates,
  rowIsLive,
  type PaletteGate,
  type PaletteGates,
  type PaletteKey,
  type PaletteRoute,
} from '../components/ui/commandPaletteKeys';
import {
  coherence,
  reachableWorlds,
  type KeyboardChord,
  type KeyboardManifest,
} from './keyboard-coherence';
import { pressEveryDeclaredBinding, type Exercise } from './keyboard-coverage';

/**
 * End-to-end proof of the ⌘K command palette (cmdk, mounted once in the
 * root layout so the shortcut works on every product surface):
 *
 *   1. Ctrl+K opens it (headless Chromium has no Meta key; the chord is
 *      declared as Meta+k or Control+k, and Ctrl+K is the PC spelling) and
 *      Esc closes it — on the galaxy, where the canvas sits behind the
 *      dialog overlay
 *   2. the root route renders all three command groups
 *   3. "Browse all 25 tasks…" routes into the tasks list, which carries
 *      every published task id; picking one navigates to its task page
 *   4. typing filters the task list (cmdk fuzzy matching); an unknown
 *      string shows CommandEmpty
 *   5. picking a scenario from /finbench crosses pages to
 *      /delegate?scenario=s5 with the scenario preselected
 *   6. picking a scenario while already on /delegate selects it in place
 *      (no remount) and the URL follows via the controlled ?scenario= param
 *   7. Escape and Backspace step back out of a sub-list before either closes
 *      the palette, and Backspace does that only while the query is empty
 *   8. every binding the declaration declares is pressed, from a state where it
 *      is live, and made to do something visible — including the half of the
 *      toggle that closes, which nothing else asks about
 *
 * The palette is client-only state (dialog + cmdk), so tests drive real
 * keyboard input and assert visible UI, not implementation handles.
 *
 * Its keyboard is the second surface DECLARED rather than written down where
 * it is bound (components/ui/commandPaletteKeys.ts, after the facilitator
 * console's), and the last two test blocks run the two halves of what that
 * declaration promises. The coherence half (e2e/keyboard-coherence.ts) is a
 * claim about the declaration, so it runs in NODE, with no browser: a
 * declaration is data plus pure functions. The other half — that the page
 * really implements it — needs the browser, and comes from the shared coverage
 * runner (e2e/keyboard-coverage.ts), which presses every binding the
 * declaration names. The keys are pressed for real there, so nothing in this
 * file has to be taken on trust.
 *
 * Interaction model: command rows are CLICKED, never arrow-down + Enter.
 * cmdk items own their click handlers, so a click never depends on the
 * internal highlight, and the palette's search input is uncontrolled —
 * there is no controlled-value round-trip race to wait out (the finbench
 * filter popover needed that dance; see finbench-filters.spec.ts for the
 * pin-the-data-selected pattern). If a test here is ever converted to
 * keyboard selection, use the shared helper in ./cmdk.ts (selectCmdkItem)
 * — do not hand-roll the retry loop.
 */

/**
 * The palette's state as `paletteGates` takes it — the three inputs every gate
 * is a judgement about. The browser tests above reach it through the page, the
 * way the palette itself does; the coherence checks at the bottom of this file
 * walk it in node, because that claim is about the DECLARATION and the state
 * space is small enough to enumerate exhaustively.
 */
interface PaletteState {
  open: boolean;
  route: PaletteRoute;
  inputEmpty: boolean;
}

/**
 * Every state the palette can actually be in, enumerated through the harness
 * (e2e/keyboard-coherence.ts) rather than here: what a state CAN be is the one
 * thing this surface knows and the harness cannot.
 *
 * The invariant is the palette's own. A closed palette is back at the root menu
 * with nothing typed, because `reset()` runs on the way out and the dialog's
 * content — and with it cmdk's query — unmounts; accepting a closed state that
 * still held a sub-list would let a gate be reachable only from somewhere the
 * palette cannot be, which is the failure the enumeration exists to rule out.
 *
 * 1 closed state + 3 routes x 2 query states = 7.
 */
const PALETTE_ROUTES: readonly PaletteRoute[] = ['root', 'tasks', 'scenarios'];

const PALETTE_WORLDS = reachableWorlds<PaletteState>(
  {
    open: [false, true],
    route: PALETTE_ROUTES,
    inputEmpty: [true, false],
  },
  ({ open, route, inputEmpty }) => {
    if (typeof open !== 'boolean' || typeof inputEmpty !== 'boolean') return null;
    if (typeof route !== 'string') return null;
    const paletteRoute = PALETTE_ROUTES.find((candidate) => candidate === route);
    if (paletteRoute === undefined) return null;
    if (!open && (paletteRoute !== 'root' || !inputEmpty)) return null;
    return { open, route: paletteRoute, inputEmpty };
  },
  (state) =>
    `open=${state.open ? 'yes' : 'no'} route=${state.route} query=${state.inputEmpty ? 'empty' : 'typed'}`,
);

/** The state space, pinned: an enumeration that silently shrank would make every
 *  assertion built on it pass vacuously. */
const PALETTE_STATE_COUNT = 7;

/**
 * The palette's declaration, handed to the harness as the module's own exports —
 * the readers are the shipped functions rather than a second copy of them, so a
 * changed gate expression moves the component and these checks together.
 *
 * Three answers are stated here rather than in the module, because they are
 * facts about THIS surface's shape and not readers: the palette has no chord
 * namespace, and it mounts no window-level key map (its `layer` rows are
 * mounted on the dialog itself). That makes two of the harness's checks
 * correspondingly quiet, and the quiet is honest rather than a gap — a
 * chordless manifest has no chip that could be offered a dead key, and a
 * mapless one has no map that could keep a binding the page does not
 * implement, so the `unimplemented` list is asserted nowhere below.
 *
 * The one cast is the same honest one the console's declaration needs: the
 * harness speaks of a gate as a string, because it cannot know another
 * manifest's vocabulary, while this module's `gateIsLive` takes the union it
 * declares.
 */
const PALETTE_MANIFEST: KeyboardManifest<PaletteKey, KeyboardChord, PaletteGates, PaletteState> = {
  rows: PALETTE_KEYS,
  chords: [],
  surfaces: PALETTE_SURFACE_ROWS,
  gates: (state) => paletteGates(state),
  gateIsLive: (gate, gates) => gateIsLive(gate as PaletteGate, gates),
  rowIsLive,
  layerIsLive,
  liveKeyMap: () => ({}),
  liveChordMap: () => ({}),
  armedChords: () => [],
  liveShortcuts,
};

const TASK_TOTAL = 25; // 14 asc606 + 11 govcon (public/finbench/*.json)

/** The palette's search field, which is also how "the palette is showing" reads. */
const paletteInput = (page: Page) => page.getByPlaceholder('Type a command or search…');

/** The task rows: how the tasks sub-list is recognised from the screen. */
const taskRows = (page: Page) => page.locator('[cmdk-item]', { hasText: /(asc606|govcon)-/ });

/** The scenario rows, numbered as the sub-list prints them. */
const scenarioRows = (page: Page) => page.getByRole('option', { name: /^\d+\. / });

/** Open the palette with the keyboard and wait for the input to take focus. */
async function openPalette(page: Page) {
  await page.keyboard.press('Control+KeyK');
  await expect(paletteInput(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
  return paletteInput(page);
}

async function closePalette(page: Page) {
  await page.keyboard.press('Escape');
  await expect(paletteInput(page)).toBeHidden();
}

/** Step into a sub-list the way a mouse user does: pick the row that opens it. */
async function openTasks(page: Page) {
  await page.getByRole('option', { name: `Browse all ${TASK_TOTAL} tasks…` }).click();
  await expect(taskRows(page).first()).toBeVisible();
}

async function openScenarios(page: Page) {
  await page.getByRole('option', { name: 'Pick a scenario…' }).click();
  await expect(scenarioRows(page).first()).toBeVisible();
}

test.describe('Command palette (⌘K)', () => {
  test('opens from the galaxy surface, renders the groups, closes on Esc', async ({ page }) => {
    await page.goto('/galaxy');
    // Galaxy boots its 3D canvas on /galaxy; the palette overlays it.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });

    const input = await openPalette(page);
    await expect(page.getByText('Go to')).toBeVisible();
    await expect(page.getByText('FinBench tasks')).toBeVisible();
    await expect(page.getByText('Delegate scenarios')).toBeVisible();

    // Representative rows from each group.
    await expect(page.getByRole('option', { name: 'Galaxy home' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Facilitator console' })).toBeVisible();
    await expect(page.getByRole('option', { name: `Browse all ${TASK_TOTAL} tasks…` })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Pick a scenario…' })).toBeVisible();

    await closePalette(page);
  });

  test('tasks route lists every published task and navigates to a task page', async ({ page }) => {
    await page.goto('/finbench');
    const input = await openPalette(page);

    await openTasks(page);

    // The route swapped to the full task list.
    const asc606 = page.locator('[cmdk-item]', { hasText: 'asc606-' });
    const govcon = page.locator('[cmdk-item]', { hasText: 'govcon-' });
    await expect(asc606.first()).toBeVisible();
    await expect(govcon.first()).toBeVisible();
    const taskItems = page.locator('[cmdk-item]');
    await expect(taskItems).toHaveCount(TASK_TOTAL);

    // Picking a task navigates to its page.
    await asc606.first().click();
    await expect(page).toHaveURL(/\/finbench\/tasks\/asc606-/);
    await expect(page.getByRole('heading', { name: /asc606-/ })).toBeVisible();
    await expect(input).toBeHidden(); // palette closed on selection
  });

  test('searching filters the task list and unknown queries show the empty state', async ({ page }) => {
    await page.goto('/');
    const input = await openPalette(page);

    await openTasks(page);

    // Exact-id search narrows to one row.
    await input.fill('asc606-modification-003');
    const item = page.locator('[cmdk-item]', { hasText: 'asc606-modification-003' });
    await expect(item).toHaveCount(1);

    // Clearing restores the full list.
    await input.fill('');
    await expect(page.locator('[cmdk-item]')).toHaveCount(TASK_TOTAL);

    // A string matching nothing renders cmdk's empty state.
    await input.fill('zzz-no-such-task-zzz');
    await expect(page.getByText('No results found.')).toBeVisible();
  });

  test('a scenario picked from another page deep-links /delegate?scenario=…', async ({ page }) => {
    await page.goto('/finbench');
    const input = await openPalette(page);

    await openScenarios(page);
    await page.getByRole('option', { name: /5\. Revenue recognition/ }).click();

    // Cross-page: palette closes and the workshop boots with the scenario.
    await expect(page).toHaveURL(/\/delegate\?scenario=s5/);
    const selected = page.locator('button', { hasText: 'Revenue recognition' });
    await expect(selected).toBeVisible();
    await expect(selected).toHaveClass(/bg-black/);
  });

  test('a scenario picked while already on /delegate selects it in place', async ({ page }) => {
    await page.goto('/delegate');
    // Pre-start screen: name + scenario menu.
    await expect(page.getByPlaceholder('e.g. Jordan')).toBeVisible();

    const input = await openPalette(page);
    await openScenarios(page);
    await page.getByRole('option', { name: /3\. Draft Q1 flux commentary/ }).click();

    // Same page: the workspace does not remount; the menu selection flips
    // in place (the participant can just press Start) and the controlled
    // ?scenario= param follows — so the address bar can never diverge from
    // the selection (a refresh replays exactly what is on screen).
    expect(new URL(page.url()).pathname).toBe('/delegate');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('scenario'), { timeout: 5_000 })
      .toBe('s3');
    const selected = page.locator('button', { hasText: 'Draft Q1 flux commentary' });
    await expect(selected).toBeVisible();
    await expect(selected).toHaveClass(/bg-black/);

    // The palette is gone after selection.
    await expect(input).toBeHidden();
  });

  test('Escape leaves a sub-list, and closes the palette only from the root menu', async ({ page }) => {
    await page.goto('/finbench');
    await openPalette(page);
    const dialog = page.getByRole('dialog', { name: 'Command menu' });
    // At the root menu there is nowhere to go back to, so the dialog claims
    // nothing — the attribute is the declaration's own answer, live keys only.
    await expect(dialog).not.toHaveAttribute('aria-keyshortcuts', /./);

    await openTasks(page);
    await expect(page.locator('[cmdk-item]', { hasText: 'asc606-' }).first()).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-keyshortcuts', 'Escape Backspace');

    await page.keyboard.press('Escape');
    // ONE press left the list, and did not also close the palette behind it:
    // the root groups are back, the task list is not, and the dialog has
    // stopped claiming a way back out.
    await expect(page.getByText('Go to')).toBeVisible();
    await expect(page.locator('[cmdk-item]', { hasText: 'asc606-' })).toHaveCount(0);
    await expect(dialog).not.toHaveAttribute('aria-keyshortcuts', /./);

    // From the root menu the same key is the palette's own dismissal.
    await closePalette(page);
  });

  test('Backspace leaves a sub-list only while the query is empty', async ({ page }) => {
    await page.goto('/finbench');
    const input = await openPalette(page);
    const dialog = page.getByRole('dialog', { name: 'Command menu' });

    await openScenarios(page);
    const flux = page.getByRole('option', { name: /3\. Draft Q1 flux commentary/ });
    await expect(flux).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-keyshortcuts', 'Escape Backspace');

    // With something typed, Backspace belongs to the caret: it deletes a
    // character and the list stays exactly where it is.
    await input.press('x');
    await expect(dialog).toHaveAttribute('aria-keyshortcuts', 'Escape');
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('');
    await expect(flux).toBeVisible();

    // Empty again, the same key is the way out of the list.
    await expect(dialog).toHaveAttribute('aria-keyshortcuts', 'Escape Backspace');
    await page.keyboard.press('Backspace');
    await expect(page.getByText('Go to')).toBeVisible();
    await expect(flux).toHaveCount(0);
    await expect(input).toBeFocused();

    await closePalette(page);
  });
});

test.describe('Command palette keyboard declaration', () => {
  test('the declaration agrees with itself in every state the palette can be in', () => {
    // The declaration's own promise: no reachable state lets two live bindings
    // answer to one key, and no gate is declared that no state can reach or no
    // binding reads. Walked in node, because it is a claim about the
    // declaration and the state space is small enough to enumerate.
    const report = coherence(PALETTE_MANIFEST, PALETTE_WORLDS);

    expect(report.worlds, 'every state of the palette is enumerated').toBe(PALETTE_STATE_COUNT);
    expect(report.collisions, 'no reachable state may let two bindings claim one key').toEqual([]);
    // The difference from the console, pinned. The console's sheet owns Escape
    // at every moment and its watch pane answers Escape while it is open, so
    // that declaration has to ALLOW the shared key. Here the dialog's own
    // dismissal and the way back out of a sub-list are one key in two states,
    // so nothing is shared at all — and this is the assertion that catches an
    // `under: 'subroute'` which stopped matching the branch the component
    // takes.
    expect(report.sharedKeys, 'the palette shares no key with the dialog it is drawn in').toEqual([]);
    expect(
      report.namespace,
      'no single key may also be a chord prefix, and no chord may be a prefix of another',
    ).toEqual([]);
    expect(
      report.gates.unreachable,
      'every declared gate must be reachable from some real palette state',
    ).toEqual([]);
    expect(report.gates.unread, 'every declared gate must be read by some binding').toEqual([]);
    expect(report.gates.bogus, 'every gate a binding names must be a real gate').toEqual([]);
  });

  test('the dialog advertises exactly the keys it answers to, in every state', () => {
    // The other half of the promise: what the surface SAYS. `aria-keyshortcuts`
    // is a claim about the element it sits on, so it is compared against the
    // keys the dialog mounts for it right now — `layerIsLive` for both of its
    // rows, in every reachable state and with and without a control holding the
    // keyboard. A sub-list that went on advertising Backspace with a query
    // typed would be exactly the lie this guard exists for: an empty field's
    // Backspace leaves the list, a full one's deletes a character, and the
    // attribute has to say which.
    const report = coherence(PALETTE_MANIFEST, PALETTE_WORLDS);

    // Pinned: a surface dropped from the declaration would otherwise stop being
    // checked at all, and an attribute nobody writes is the silence this guard
    // exists to prevent.
    expect(report.surfaces, 'every surface that advertises rows is declared').toEqual(['dialog']);
    expect(report.claims, 'the dialog must advertise, and mount, exactly what is bound').toEqual([]);
    expect(report.structure, 'the declaration is shaped the way its readers assume').toEqual([]);
  });
});

/** Which of the palette's three lists is on screen. */
type PaletteView = 'root' | 'tasks' | 'scenarios';

/**
 * The palette as the exercises need to read it: which list the press is aimed
 * at. Read from the group headings rather than from a handle, because the
 * claim being checked is about what a person sees.
 */
async function shown(page: Page): Promise<{ view: PaletteView }> {
  const headings = await page.locator('[cmdk-group-heading]').allTextContents();
  const view: PaletteView = headings.includes('Go to')
    ? 'root'
    : headings.includes('Delegate scenarios')
      ? 'scenarios'
      : 'tasks';
  return { view };
}

/**
 * What each declared key has to do, and the state it needs in order to do it.
 *
 * The palette's two sub-lists are where its keys are conditional, and each one
 * is entered the way a mouse user enters it, so a step that is about LEAVING a
 * list starts in one. `close-palette` and `back-to-root` are the same key in
 * two states — the declaration says so with `under: 'subroute'`, and the two
 * effects are what keep that claim honest: inside a list Escape leaves the
 * list, from the root menu it closes the palette, and neither step would pass
 * with the other's branch.
 *
 * `toggle-palette` is pressed while the palette is SHOWING (which is where
 * `enter` leaves it), so both of its chords are exercised as the half of a
 * toggle nothing else asks about: the same chord has to close what it opened.
 */
const EXERCISES: Record<string, Exercise<{ view: PaletteView }>> = {
  'toggle-palette': {
    effect: async (page, before) => {
      expect(before.view, 'the toggle is pressed while the palette is showing').toBe('root');
      await expect(paletteInput(page)).toBeHidden();
    },
  },
  'back-to-root': {
    prepare: openTasks,
    effect: async (page, before) => {
      expect(before.view, 'the step starts inside the list it has to leave').toBe('tasks');
      await expect(page.getByText('Go to')).toBeVisible();
      await expect(taskRows(page)).toHaveCount(0);
      // One press left the list and did not close the palette behind it.
      await expect(paletteInput(page)).toBeVisible();
    },
  },
  'backspace-to-root': {
    prepare: openScenarios,
    effect: async (page, before) => {
      expect(before.view, 'the step starts inside the list it has to leave').toBe('scenarios');
      await expect(page.getByText('Go to')).toBeVisible();
      await expect(scenarioRows(page)).toHaveCount(0);
      await expect(paletteInput(page)).toBeVisible();
    },
  },
  'close-palette': {
    effect: async (page, before) => {
      expect(before.view, 'the dismissal is pressed from the root menu').toBe('root');
      await expect(paletteInput(page)).toBeHidden();
    },
  },
};

test.describe('Command palette keyboard coverage', () => {
  test('every declared binding does something visible', async ({ page }) => {
    await pressEveryDeclaredBinding<{ view: PaletteView }>(page, {
      // The rows as they are declared — the palette has no chord namespace, so
      // there is nothing else to flatten in.
      declared: PALETTE_KEYS.map((row) => ({ id: row.id, keys: row.keys })),
      exercises: EXERCISES,
      // Where a press begins: the palette, open at the root menu.
      enter: async (page) => {
        await page.goto('/finbench');
        await openPalette(page);
      },
      snapshot: shown,
    });
  });
});

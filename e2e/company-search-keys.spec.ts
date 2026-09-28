import { expect, test, type Page } from '@playwright/test';

import {
  SEARCH_KEYS,
  SEARCH_SURFACE_ROWS,
  gateIsLive,
  layerIsLive,
  liveShortcuts,
  rowIsLive,
  searchGates,
  type SearchGate,
  type SearchGates,
  type SearchKey,
} from '../components/ui/companySearchKeys';
import { pressEveryDeclaredBinding, type Exercise } from './keyboard-coverage';
import {
  coherence,
  reachableWorlds,
  type KeyboardChord,
  type KeyboardManifest,
} from './keyboard-coherence';

/**
 * The galaxy's company-search field, held to the same standard as the two
 * surfaces declared before it (the facilitator console, the ⌘K palette):
 *
 *   - the declaration agrees with itself, walked in node over every state the
 *     field can be in;
 *   - what the field ADVERTISES is what it answers to, in every one of those
 *     states;
 *   - and every key it declares is pressed for real, from a state where it is
 *     live, with a visible effect demanded of each.
 *
 * The third block is where this surface earns its place in the set: nothing
 * else in the suite presses ↑ or ↓, so before this file a search field whose
 * walk had stopped working would have passed every test the repo had.
 */

/** The field's state as `searchGates` takes it — the inputs every gate judges. */
interface SearchState {
  open: boolean;
  matches: number;
}

const SEARCH_MATCHES: readonly number[] = [0, 1, 2];

/**
 * Every state the field can be in, enumerated through the harness
 * (e2e/keyboard-coherence.ts): the search is open or shut, and there are none,
 * one or more matches to walk.
 *
 * One combination is impossible and the invariant says why: a CLOSED search
 * has no matches to walk. The last query may still be in the component, but
 * the gate is a judgement about what a key can do, and with no input on screen
 * there is nothing for one to do — which is why `searchGates` derives it
 * rather than reading the count. 1 closed state + 3 open ones (no matches,
 * one, more) = 4.
 */
const SEARCH_WORLDS = reachableWorlds<SearchState>(
  { open: [false, true], matches: SEARCH_MATCHES },
  ({ open, matches }) => {
    if (typeof open !== 'boolean' || typeof matches !== 'number') return null;
    if (!open && matches > 0) return null;
    return { open, matches };
  },
  (state) => `open=${state.open ? 'yes' : 'no'} matches=${state.matches}`,
);

/** The state space, pinned: an enumeration that silently shrank would make
 *  every assertion built on it pass vacuously. */
const SEARCH_STATE_COUNT = 4;

/**
 * The declaration, handed to the harness as the module's own exports — the
 * readers are the shipped functions, so a changed gate expression moves the
 * field and these checks together.
 *
 * Two answers are stated here rather than in the module, because they are
 * facts about this surface's shape: it has no chord namespace, and it mounts
 * no window-level key map (its `layer` rows are the field's own keydown). The
 * one cast is the honest one every manifest needs at this seam: the harness
 * speaks of a gate as a string, while this module's `gateIsLive` takes the
 * union it declares.
 */
const SEARCH_MANIFEST: KeyboardManifest<SearchKey, KeyboardChord, SearchGates, SearchState> = {
  rows: SEARCH_KEYS,
  chords: [],
  surfaces: SEARCH_SURFACE_ROWS,
  gates: (state) => searchGates(state),
  gateIsLive: (gate, gates) => gateIsLive(gate as SearchGate, gates),
  rowIsLive,
  layerIsLive,
  liveKeyMap: () => ({}),
  liveChordMap: () => ({}),
  armedChords: () => [],
  liveShortcuts,
};

test.describe('Company search keyboard declaration', () => {
  test('the declaration agrees with itself in every state the field can be in', () => {
    const report = coherence(SEARCH_MANIFEST, SEARCH_WORLDS);

    expect(report.worlds, 'every state of the field is enumerated').toBe(SEARCH_STATE_COUNT);
    expect(report.collisions, 'no reachable state may let two bindings claim one key').toEqual([]);
    // The field's walk and selection are live together and share no key, and
    // the one key it does not mount (Esc, the page's) is a different key
    // altogether — so nothing is shared here, and this is the assertion that
    // would notice the page's Escape being redeclared as the field's.
    expect(report.sharedKeys, 'the field shares no key with the page that hosts it').toEqual([]);
    expect(
      report.namespace,
      'no single key may also be a chord prefix, and no chord may be a prefix of another',
    ).toEqual([]);
    expect(
      report.gates.unreachable,
      'every declared gate must be reachable from some real state of the field',
    ).toEqual([]);
    expect(report.gates.unread, 'every declared gate must be read by some binding').toEqual([]);
    expect(report.gates.bogus, 'every gate a binding names must be a real gate').toEqual([]);
  });

  test('the field advertises exactly the keys it answers to, in every state', () => {
    // `aria-keyshortcuts` is a claim about the element it sits on, so it is
    // compared against the keys the field mounts for it right now: none while
    // there is nothing to walk, the three it answers to as soon as there is.
    // An attribute left behind after the matches emptied would be exactly the
    // lie this guard exists for.
    const report = coherence(SEARCH_MANIFEST, SEARCH_WORLDS);

    expect(report.surfaces, 'every surface that advertises rows is declared').toEqual(['field']);
    expect(report.claims, 'the field must advertise, and mount, exactly what is bound').toEqual([]);
    expect(report.structure, 'the declaration is shaped the way its readers assume').toEqual([]);
  });
});

/** The field itself, which is also how "the search is showing" is read. */
const field = (page: Page) => page.getByRole('combobox', { name: 'Search companies' });

/** The galaxy's store, as the coverage steps need to read the mode it is in. */
async function mode(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (window as unknown as { __galaxy: { store: { getState: () => { mode: string } } } }).__galaxy.store
        .getState().mode,
  );
}

/** Which match the walk has stopped on, or -1 when nothing is highlighted. */
async function active(page: Page): Promise<number> {
  return page
    .locator('[role="option"]')
    .evaluateAll((options) =>
      options.findIndex((option) => option.getAttribute('aria-selected') === 'true'),
    );
}

/** Where a press begins: the star field, with the search open and focused. */
async function enterSearch(page: Page): Promise<void> {
  await page.goto('/galaxy');
  await expect
    .poll(
      () => page.evaluate(() => Boolean((window as unknown as { __galaxy?: unknown }).__galaxy)),
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(field(page)).toBeVisible();
}

/** What the field looks like immediately before a key is pressed. */
interface SearchShown {
  open: boolean;
  /** How many matches the walk has to move through. */
  matches: number;
  /** The index of the highlighted match, or -1 when none is. */
  active: number;
}

/**
 * What each declared key has to do, and the state it needs in order to do it.
 *
 * The walk is measured against the highlight (`aria-selected`), which is the
 * thing the arrows move, and the two steps that need a distance to travel earn
 * it in `prepare` rather than assuming where the walk starts — so "the
 * highlight moved" cannot pass because it happened to already be there.
 */
const EXERCISES: Record<string, Exercise<SearchShown>> = {
  'next-result': {
    prepare: async (page) => {
      await field(page).fill('a');
      await expect(page.locator('[role="option"]').nth(1)).toBeVisible();
    },
    effect: async (page, before) => {
      expect(before.active, 'the walk starts on the first match').toBe(0);
      // What the field says it answers to, asserted in the one state that says
      // it — the same rows the key press below is dispatched from.
      await expect(field(page)).toHaveAttribute(
        'aria-keyshortcuts',
        'ArrowDown ArrowUp Enter',
      );
      await expect.poll(() => active(page)).toBe(1);
    },
  },
  'prev-result': {
    prepare: async (page) => {
      await field(page).fill('a');
      await expect(page.locator('[role="option"]').nth(1)).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => active(page)).toBe(1);
    },
    effect: async (page, before) => {
      expect(before.active, 'the walk starts away from the first match').toBe(1);
      await expect.poll(() => active(page)).toBe(0);
    },
  },
  'select-result': {
    prepare: async (page) => {
      await field(page).fill('Nvidia');
      const hit = page.getByRole('option', { name: /Nvidia/ });
      await expect(hit).toBeVisible();
      await expect(hit).toHaveAttribute('aria-selected', 'true');
    },
    effect: async (page) => {
      // The field closes and the profile opens on the company it named.
      await expect(field(page)).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Nvidia' })).toBeVisible({ timeout: 15_000 });
    },
  },
  'close-search': {
    prepare: async (page) => {
      // The cap the field prints for the key it does NOT bind: rendered from the
      // declared row, and pinned here as the word a person reads. It is the one
      // advertisement on this surface that is not an attribute (the chip is
      // `aria-hidden`), which is why it is checked by eye rather than by the
      // harness — and pinned rather than compared to the declaration, so a
      // change to the hint has to be deliberate.
      await expect(page.locator('kbd')).toHaveText('esc');
      await field(page).fill('Nvidia');
      await expect(page.getByRole('option', { name: /Nvidia/ })).toBeVisible();
    },
    effect: async (page, before) => {
      expect(before.open, 'the field was showing, so there is something to close').toBe(true);
      await expect(field(page)).toBeHidden();
      // Closed WITHOUT selecting: the page's Escape takes the search before it
      // takes the selection, which is the priority the declaration records by
      // mounting this row on the page rather than on the field.
      expect(await mode(page)).toBe('galaxy');
    },
  },
};

test.describe('Company search keyboard coverage', () => {
  test('every declared binding does something visible', async ({ page }) => {
    // Four steps, each of which boots the 3D scene before it can press a key.
    test.setTimeout(240_000);

    await pressEveryDeclaredBinding<SearchShown>(page, {
      declared: SEARCH_KEYS.map((row) => ({ id: row.id, keys: row.keys })),
      exercises: EXERCISES,
      enter: enterSearch,
      snapshot: async (page) => ({
        open: await field(page).isVisible(),
        matches: await page.locator('[role="option"]').count(),
        active: await active(page),
      }),
    });
  });
});

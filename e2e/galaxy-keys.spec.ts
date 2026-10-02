import { expect, test } from './worker-server';
import type { Page } from '@playwright/test';

import {
  CLEAR_SELECTION,
  CLOSE_ADD_FORM,
  CLOSE_SEARCH,
  GALAXY_KEYS,
  GALAXY_SURFACE_ROWS,
  galaxyGates,
  gateIsLive,
  layerIsLive,
  liveShortcuts,
  rowIsLive,
  type GalaxyFacts,
  type GalaxyGate,
  type GalaxyKey,
  type GalaxyGates,
} from '../components/galaxy/galaxyKeys';
import { CLOSE_SEARCH as FIELD_CLOSE_SEARCH, SEARCH_KEYS } from '../components/ui/companySearchKeys';
import { agreement, coherence, reachableWorlds, type KeyboardChord, type KeyboardManifest } from './keyboard-coherence';
import { pressEveryDeclaredBinding, type Exercise } from './keyboard-coverage';

/**
 * The galaxy page's dismissal ladder, declared in
 * components/galaxy/galaxyKeys.ts, checked the way every other declared
 * keyboard is: against itself in every state the page can be in, against the
 * declaration that documents the same key from the other side, and — the half
 * no declaration can answer about itself — by pressing all three rungs in a
 * real browser.
 *
 * The ladder is the first surface declared here whose bindings are ALL
 * page-level: nothing is mounted by a key map or a layer, so the order of the
 * rungs is the only thing keeping three claims off one key. That order is what
 * most of this file is about.
 */

declare global {
  interface Window {
    // Debug handle exposed by the app (GalaxyApp / CameraRig / GalaxyScene),
    // typed as e2e/galaxy.spec.ts types it — one global cannot have two shapes.
    __galaxy?: Record<string, any>;
  }
}

const PAGE_MANIFEST: KeyboardManifest<GalaxyKey, KeyboardChord, GalaxyGates, GalaxyFacts> = {
  rows: GALAXY_KEYS,
  chords: [],
  surfaces: GALAXY_SURFACE_ROWS,
  gates: (facts) => galaxyGates(facts),
  gateIsLive: (gate, gates) => gateIsLive(gate as GalaxyGate, gates),
  rowIsLive,
  layerIsLive,
  // Nothing here is mounted: the page's rows answer from one window listener,
  // which no key map builds and no layer owns. That is exactly why the
  // collision check has a page-level mechanism of its own to consult.
  liveKeyMap: () => ({}),
  liveChordMap: () => ({}),
  armedChords: () => [],
  liveShortcuts,
};

/**
 * Every state the page can be in, from its three independent facts: which
 * overlay is showing, and whether a star is selected.
 *
 * `accept` is where the one invariant lives: the bottom bar closes each overlay
 * to open the other, so the page is never showing the search AND the sheet —
 * two of the eight combinations, which is why the count is pinned below rather
 * than assumed. A cursor-shaped fact (`selected`) deliberately varies
 * independently of the overlays, because "panel behind a palette" is a state
 * people reach all the time and the rung order has to be right in it.
 */
const PAGE_WORLDS = reachableWorlds<GalaxyFacts>(
  { search: [false, true], add: [false, true], selected: [false, true] },
  ({ search, add, selected }) => {
    if (typeof search !== 'boolean' || typeof add !== 'boolean') return null;
    if (typeof selected !== 'boolean') return null;
    if (search && add) return null;
    return { search, add, selection: selected };
  },
);

const STATE_COUNT = 6;

/** The input the search palette is recognised by, and how "the search is open" reads. */
const searchInput = (page: Page) => page.getByRole('combobox', { name: 'Search companies' });

/** The company profile panel, which is what a selection puts on screen. */
const profile = (page: Page) => page.locator('aside');

/**
 * Press one of the bottom bar's controls as a POINTER user reaches it: click
 * the control itself.
 *
 * This used to be focus + Enter, and the reason is worth keeping: with a
 * company profile open the panel covered that end of the bar, and Playwright's
 * click retried forever on "subtree intercepts pointer events". Focus is the
 * path that exists when a control is covered — but it is the tab-order path,
 * and a page where that is the only path has a layout bug, not a design.
 *
 * So the click is back, and it is doing real work: two of the rungs below
 * (the search, and the add-company sheet) are opened with a profile already on
 * screen, which is exactly the state the panel used to make unclickable. If it
 * ever covers the bar again, the cover story is a click that never lands
 * rather than a step that quietly takes another route in.
 */
async function pressControl(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name }).click();
}

/** The add-company sheet, recognised by the heading it slides in with. */
const sheet = (page: Page) => page.getByRole('heading', { name: 'Add Your Company' });

/** Put the page where a press begins: freshly loaded, and interactive. */
async function enter(page: Page): Promise<void> {
  await page.goto('/galaxy');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g = window.__galaxy as Record<string, unknown> | undefined;
          return Boolean(g?.store && g?.r3f);
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Open the search palette from the bottom bar, the way a person does. */
async function openSearch(page: Page): Promise<void> {
  await pressControl(page, 'Search');
  await expect(searchInput(page)).toBeVisible();
}

/**
 * Select a star, and leave the search closed. The keyboard's own path (type a
 * name, Enter) rather than a canvas click: this spec is about dismissal, not
 * about the renderer's raycast, and the flight that follows is irrelevant to
 * whether a panel is on screen.
 */
async function selectStar(page: Page): Promise<void> {
  await openSearch(page);
  await searchInput(page).fill('Nvidia');
  await expect(page.getByRole('option', { name: /Nvidia/ })).toBeVisible();
  await searchInput(page).press('Enter');
  await expect(profile(page)).toBeVisible();
}

/** What is on screen right now, read just before a key goes down. */
interface LadderShown {
  search: boolean;
  sheet: boolean;
  profile: boolean;
}

const snapshot = async (page: Page): Promise<LadderShown> => ({
  search: await searchInput(page).isVisible(),
  sheet: await sheet(page).isVisible(),
  profile: await profile(page).isVisible(),
});

/**
 * What each rung has to do, each from a state where it is the rung a press
 * reaches — and each asserting the rungs BELOW it were left alone. That second
 * half is the ladder: a press that closed the search and also dropped the
 * selection would satisfy "the search is gone" and be exactly the bug this
 * ordering exists to prevent.
 */
const EXERCISES: Record<string, Exercise<LadderShown>> = {
  [CLOSE_SEARCH.id]: {
    prepare: async (page) => {
      // A selection BEHIND the palette, because that is the state the order
      // decides: both rungs are live, and only one of them may answer.
      await selectStar(page);
      await openSearch(page);
    },
    effect: async (page, before) => {
      expect(before.search, 'the step starts in the state it has to close').toBe(true);
      expect(before.profile, 'and with a selection for the same press to drop').toBe(true);
      await expect(searchInput(page)).toBeHidden();
      await expect(profile(page), 'the rung below it stayed put').toBeVisible();
    },
  },
  [CLOSE_ADD_FORM.id]: {
    prepare: async (page) => {
      await selectStar(page);
      await pressControl(page, 'Add Company');
      await expect(sheet(page)).toBeVisible();
    },
    effect: async (page, before) => {
      expect(before.sheet, 'the step starts in the sheet it has to close').toBe(true);
      expect(before.profile, 'and with a selection for the same press to drop').toBe(true);
      await expect(sheet(page)).toBeHidden();
      await expect(profile(page), 'the rung below it stayed put').toBeVisible();
    },
  },
  [CLEAR_SELECTION.id]: {
    prepare: async (page) => {
      await selectStar(page);
    },
    effect: async (page, before) => {
      expect(before.profile, 'the step starts with a selection to drop').toBe(true);
      await expect(profile(page)).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(() => (window.__galaxy as any).store.getState().mode as string),
        )
        .toBe('galaxy');
    },
  },
};

test.describe('Galaxy dismissal ladder declaration', () => {
  test('the declaration agrees with itself in every state the page can be in', () => {
    const report = coherence(PAGE_MANIFEST, PAGE_WORLDS);

    expect(report.worlds, 'every state of the page is enumerated').toBe(STATE_COUNT);
    expect(
      report.collisions,
      'one Escape, three rungs, and no state where two of them answer it',
    ).toEqual([]);
    expect(
      report.sharedKeys,
      'nothing on this page is mounted by a key map or a layer, so the ladder shares no key',
    ).toEqual([]);
    expect(report.namespace, 'a single dismissal key opens no chord namespace').toEqual([]);
    expect(report.structure, 'ids, mounts and yields are shaped as the harness reads them').toEqual([]);
    expect(
      report.gates.unreachable,
      'every declared gate must be reachable from some real page state',
    ).toEqual([]);
    expect(report.gates.unread, 'every declared gate must be read by some rung').toEqual([]);
    expect(report.gates.bogus, 'every gate a rung names must be a real gate').toEqual([]);
    // Pinned rather than assumed: the page advertises its dismissal keys
    // nowhere (each overlay has a visible close control, and the field's own
    // `esc` print is declared and checked where it is written). A surface added
    // here would otherwise be an attribute nobody writes.
    expect(report.surfaces, 'the ladder is advertised by no element of the page').toEqual([]);
  });

  test('the rung the page answers Escape with is the rung the field documents', () => {
    // The one binding two declarations describe, from its two sides: the page
    // declares the key it answers, the field declares the key it prints and
    // relies on. Neither can see the other, so the facts that describe the
    // binding are compared — its keys, its gate, what it stands down for, how
    // it is mounted, what it yields.
    const page = { name: 'the galaxy page', rows: GALAXY_KEYS };
    const field = { name: 'the company search field', rows: SEARCH_KEYS };

    expect(
      agreement(page, field, [{ left: CLOSE_SEARCH.id, right: FIELD_CLOSE_SEARCH.id }]),
      'the page and the field describe the search-closing Escape the same way',
    ).toEqual([]);

    // The pairing is stated, so it is also pinned: a second Escape row on
    // either side has to be paired here deliberately rather than left unchecked
    // — which is how the two got out of step in the first place.
    const escapeRows = (rows: readonly { id: string; keys: readonly string[] }[]) =>
      rows.filter((row) => row.keys.includes('Escape')).map((row) => row.id);
    expect(
      escapeRows(GALAXY_KEYS),
      'every Escape the page binds is a rung of this ladder, top first',
    ).toEqual(['close-search', 'close-add-form', 'clear-selection']);
    expect(
      escapeRows(SEARCH_KEYS),
      'the field declares exactly one Escape, and it is the page’s',
    ).toEqual(['close-search']);
  });
});

test.describe('Galaxy dismissal ladder coverage', () => {
  test('every declared binding does something visible', async ({ page }) => {
    test.setTimeout(240_000);
    await pressEveryDeclaredBinding<LadderShown>(page, {
      declared: GALAXY_KEYS.map((row) => ({ id: row.id, keys: row.keys })),
      exercises: EXERCISES,
      enter,
      snapshot,
    });
  });
});

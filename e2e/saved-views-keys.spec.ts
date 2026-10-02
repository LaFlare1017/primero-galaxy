import { expect, test } from './worker-server';
import type { Page } from '@playwright/test';

import {
  SAVED_VIEWS_KEYS,
  SAVED_VIEWS_SURFACE_ROWS,
  gateIsLive,
  layerIsLive,
  liveShortcuts,
  rowIsLive,
  savedViewsGates,
  type SavedViewsGate,
  type SavedViewsGates,
  type SavedViewsKey,
  type SavedViewsMode,
} from '../components/ui/savedViewsKeys';
import { pressEveryDeclaredBinding, type Exercise } from './keyboard-coverage';
import {
  coherence,
  reachableWorlds,
  type KeyboardChord,
  type KeyboardManifest,
} from './keyboard-coherence';

/**
 * The shared saved-views panel, held to the same standard as the surfaces
 * declared before it: the declaration agrees with itself, the panel advertises
 * exactly what it answers to, and every declared key is pressed for real.
 *
 * It is the first surface here whose Escape is LAYERED — a form steps back
 * before the panel dismisses — so it is also the first place the claim can be
 * checked against the implementation rather than asserted about the
 * declaration: the `back-to-list` coverage step fails if the form's Escape is
 * left to a handler that Radix's capture-phase dismissal has already beaten.
 */

/** The panel's state as `savedViewsGates` takes it. */
interface SavedViewsState {
  open: boolean;
  mode: SavedViewsMode;
}

const SAVED_VIEWS_MODES: readonly SavedViewsMode[] = ['list', 'save', 'edit'];

/**
 * Every state the panel can be in, enumerated through the harness: shut, open
 * on the list, and open on one of the two forms.
 *
 * `save` and `edit` are the same keyboard in two states, and both are walked
 * rather than collapsed: the form is real either way, and an invariant that
 * pretended otherwise would be a claim about the UI hiding in a test fixture.
 * One combination is impossible and the derivation says so — a shut panel is
 * on its list, because the form goes with it. 1 closed state + 3 open = 4.
 */
const SAVED_VIEWS_WORLDS = reachableWorlds<SavedViewsState>(
  { open: [false, true], mode: SAVED_VIEWS_MODES },
  ({ open, mode }) => {
    if (typeof open !== 'boolean' || typeof mode !== 'string') return null;
    const panelMode = SAVED_VIEWS_MODES.find((candidate) => candidate === mode);
    if (panelMode === undefined) return null;
    if (!open && panelMode !== 'list') return null;
    return { open, mode: panelMode };
  },
  (state) => `open=${state.open ? 'yes' : 'no'} mode=${state.mode}`,
);

/** The state space, pinned, so a shrunken enumeration cannot pass vacuously. */
const SAVED_VIEWS_STATE_COUNT = 4;

/**
 * The declaration, handed to the harness as the module's own exports. The
 * panel has no chord namespace and mounts no window-level key map (its rows
 * are mounted on the popover's own layer), which is why those three readers
 * are the empty answers here — a fact about this surface, stated rather than
 * stubbed in the module.
 */
const SAVED_VIEWS_MANIFEST: KeyboardManifest<
  SavedViewsKey,
  KeyboardChord,
  SavedViewsGates,
  SavedViewsState
> = {
  rows: SAVED_VIEWS_KEYS,
  chords: [],
  surfaces: SAVED_VIEWS_SURFACE_ROWS,
  gates: (state) => savedViewsGates(state),
  gateIsLive: (gate, gates) => gateIsLive(gate as SavedViewsGate, gates),
  rowIsLive,
  layerIsLive,
  liveKeyMap: () => ({}),
  liveChordMap: () => ({}),
  armedChords: () => [],
  liveShortcuts,
};

test.describe('Saved views keyboard declaration', () => {
  test('the declaration agrees with itself in every state the panel can be in', () => {
    const report = coherence(SAVED_VIEWS_MANIFEST, SAVED_VIEWS_WORLDS);

    expect(report.worlds, 'every state of the panel is enumerated').toBe(SAVED_VIEWS_STATE_COUNT);
    expect(report.collisions, 'no reachable state may let two bindings claim one key').toEqual([]);
    // Escape is bound twice — the form's way back and the panel's dismissal —
    // and nothing is shared, because the two are live in different states: one
    // press leaves the form, the next closes the panel. A manifest that said
    // otherwise would have to ALLOW the overlap, as the console's does.
    expect(report.sharedKeys, 'the two Escape bindings are never live at once').toEqual([]);
    expect(
      report.namespace,
      'no single key may also be a chord prefix, and no chord may be a prefix of another',
    ).toEqual([]);
    expect(
      report.gates.unreachable,
      'every declared gate must be reachable from some real state of the panel',
    ).toEqual([]);
    expect(report.gates.unread, 'every declared gate must be read by some binding').toEqual([]);
    expect(report.gates.bogus, 'every gate a binding names must be a real gate').toEqual([]);
  });

  test('the name field advertises exactly the keys it answers to, in every state', () => {
    // The field exists only while a form does, and the attribute is built from
    // the rows that decide what the form answers to — so the claim goes away
    // with the form rather than outliving it.
    const report = coherence(SAVED_VIEWS_MANIFEST, SAVED_VIEWS_WORLDS);

    expect(report.surfaces, 'every surface that advertises rows is declared').toEqual(['name']);
    expect(report.claims, 'the field must advertise, and mount, exactly what is bound').toEqual([]);
    expect(report.structure, 'the declaration is shaped the way its readers assume').toEqual([]);
  });
});

/** The open panel (Radix renders popover content as a dialog). */
const panel = (page: Page) => page.getByRole('dialog');

/** The form's name field, which is also how "a form is showing" is read. */
const nameField = (page: Page) => panel(page).getByLabel('View name');

/** The list's way into the form. */
const saveButton = (page: Page) => panel(page).getByRole('button', { name: 'Save current' });

/** What the panel looks like immediately before a key is pressed. */
interface PanelShown {
  view: 'closed' | 'list' | 'form';
}

/**
 * Advance keyboard focus with Tab until the focused element's label contains
 * `needle`, bounded by `maxTabs`.
 *
 * Copied from the saved-views feature specs, which established why this is the
 * way in: the popover is portaled and fixed-position, so pointer clicks inside
 * its content can freeze it at a stale anchor. Every step here therefore opens
 * the form the way those specs do rather than clicking it.
 */
async function focusedText(page: Page): Promise<string> {
  return page.evaluate(() =>
    (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim(),
  );
}

async function tabUntil(page: Page, needle: string, maxTabs = 6): Promise<void> {
  for (let i = 0; i <= maxTabs; i++) {
    if ((await focusedText(page)).includes(needle)) return;
    if (i < maxTabs) await page.keyboard.press('Tab');
  }
  throw new Error(`focus never reached an element containing "${needle}"`);
}

/**
 * Where a press begins: the run explorer, the views panel open on its list.
 * A filter is applied first because "Save current" has nothing to save until
 * there is a state to save, which is what keeps the form's steps honest.
 */
async function enterPanel(page: Page): Promise<void> {
  const filters = encodeURIComponent(
    JSON.stringify([{ columnId: 'result', type: 'option', operator: 'is', values: ['miss'] }]),
  );
  await page.goto(`/finbench?filters=${filters}`);
  await expect(page.getByText(/\d+ of \d+ runs/)).toBeVisible();
  await page.getByRole('button', { name: 'Views' }).click();
  await expect(panel(page)).toBeVisible();
}

/** Open the save form from the list, by keyboard, and wait for the field. */
async function openForm(page: Page): Promise<void> {
  await tabUntil(page, 'Save current');
  await page.keyboard.press('Enter');
  await expect(nameField(page)).toBeFocused();
}

/**
 * What each declared key has to do, and the state it needs in order to do it.
 *
 * `confirm-name` asserts the visible result of a save — the named row appears
 * in the list — rather than the store, and `back-to-list` asserts BOTH halves
 * of its claim: the form is gone and the panel is still there. The second
 * assertion is the one that fails if the form's Escape is left to the field's
 * own handler, because Radix dismisses the panel in the capture phase and the
 * field's branch never runs.
 */
const EXERCISES: Record<string, Exercise<PanelShown>> = {
  'confirm-name': {
    prepare: async (page) => {
      await openForm(page);
      await page.keyboard.insertText('Coverage view');
    },
    effect: async (page, before) => {
      expect(before.view, 'the step starts in the form it has to confirm').toBe('form');
      await expect(panel(page).getByText('Coverage view')).toBeVisible();
      await expect(nameField(page)).toHaveCount(0);
    },
  },
  'back-to-list': {
    prepare: async (page) => {
      await openForm(page);
      // What the field says it answers to, in the one state that says it.
      await expect(nameField(page)).toHaveAttribute('aria-keyshortcuts', 'Enter Escape');
    },
    effect: async (page, before) => {
      expect(before.view, 'the step starts in the form it has to leave').toBe('form');
      await expect(saveButton(page)).toBeVisible();
      await expect(nameField(page)).toHaveCount(0);
      // One press left the form; it did not close the panel behind it.
      await expect(panel(page)).toBeVisible();
    },
  },
  'close-panel': {
    effect: async (page, before) => {
      expect(before.view, 'the dismissal is pressed from the list').toBe('list');
      await expect(panel(page)).toBeHidden();
    },
  },
};

test.describe('Saved views keyboard coverage', () => {
  test('every declared binding does something visible', async ({ page }) => {
    await pressEveryDeclaredBinding<PanelShown>(page, {
      declared: SAVED_VIEWS_KEYS.map((row) => ({ id: row.id, keys: row.keys })),
      exercises: EXERCISES,
      enter: enterPanel,
      snapshot: async (page) => {
        if (!(await panel(page).isVisible())) return { view: 'closed' as const };
        return { view: (await nameField(page).count()) > 0 ? ('form' as const) : ('list' as const) };
      },
    });
  });
});

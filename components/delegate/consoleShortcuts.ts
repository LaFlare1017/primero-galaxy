/**
 * The facilitator console's keyboard, declared once.
 *
 * Three things about the console's keys used to live in three places and
 * agreed only by discipline: which keys are bound (scattered across six
 * `useKeyboardShortcuts` calls in the page), the conditions that decide
 * whether each one is live (named `canWalk`/`canCommit`/... expressions in
 * the page), and what the surface tells assistive tech it answers to (four
 * hand-written `aria-keyshortcuts` strings). A fifth place — the shortcut
 * sheet — described all of it in its own words, so a key could be added to
 * the page and left out of the legend, or listed in the legend and never
 * bound. That is the same drift the `g` namespace already answers for
 * chords, with one list read by the hook, the armed-chord chip and the
 * sheet.
 *
 * This module is that list, for the single keys. It holds:
 *
 *   - the gate EXPRESSIONS, as one function of the console's state, so the
 *     hook's mount conditions and the sheet's dimming are the same
 *     booleans rather than two readings of the same idea;
 *   - the ROWS: every single-key binding, with the keys as the DOM spells
 *     them, the words the sheet prints, which section it belongs to, the
 *     gate that decides it, and — the part that keeps the sheet honest —
 *     HOW it is bound, since a row that is not in the page's key map must
 *     say who does bind it;
 *   - the `aria-keyshortcuts` STRING for any set of those rows, built from
 *     the rows themselves, so the attribute can only advertise keys this
 *     module declares.
 *
 * Deliberately free of React and of every import, like the policy in
 * ./shortcuts, for the same two reasons: it stays testable on its own, and
 * a module with no dependencies can be handed straight to a browser for the
 * unit spec (e2e/delegate-shortcuts.spec.ts transpiles it and runs it
 * against a table of console states) without a bundler or a second runner.
 * It is data and pure functions over that data — the handlers stay in the
 * page, because a closure is not declarative.
 */

/** The sections of the sheet, in the order a facilitator meets them. */
export type ShortcutGroupId = 'walk' | 'watch' | 'row' | 'anywhere';

/**
 * The conditions that decide whether a shortcut exists right now. One name
 * per reason the console can refuse a key, so a binding, the sheet and the
 * `aria-keyshortcuts` string can all read the same answer.
 */
export interface ConsoleGates {
  /** j/k and the jump chords: there is something on screen to walk. */
  walk: boolean;
  /** Enter/w and the watch chord: there is a row to commit, and it is not what is already watched. */
  commit: boolean;
  /** The pane transport: a run is watched and the room has more than one participant. */
  sweep: boolean;
  /** The copy-link chord: the cursor has landed on a row with a run to share. */
  link: boolean;
  /** The pane is open, so Escape has a watch pane to close. */
  pane: boolean;
  /** The views panel is open, so Escape has a panel to close. */
  views: boolean;
}

/** Whether a shortcut is bound right now, or never gated at all. */
export type ShortcutGate = keyof ConsoleGates | 'always';

/**
 * How a row's keys reach the keyboard. Every row has to say, because
 * "documented" and "bound" are different claims and the sheet makes both.
 *   - `map`: in the page's one key map, mounted from this module.
 *   - `layer`: mounted by an ordered layer call in the page, because a key
 *     that two overlays both answer to is decided by stacking, not by a
 *     gate alone. See `under`.
 *   - `primitive`: the overlay's own primitive dismisses it (the sheet is a
 *     Radix dialog and owns its Escape).
 *   - `global`: bound by a component that is not this console at all (the
 *     command palette lives in the app layout and binds ⌘K for every page).
 */
export type ConsoleKeyMount = 'map' | 'layer' | 'primitive' | 'global';

/** One single-key binding, as declared. */
export interface ConsoleKey {
  /** Stable id: what the page hangs behaviour on, and what callers name for aria. */
  id: string;
  /**
   * The keys as the DOM spells them — `KeyboardEvent.key`, which is also how
   * `aria-keyshortcuts` writes them. Space-joined within a key for a
   * modifier chord (`Meta+k`); one array entry per alternative.
   */
  keys: readonly string[];
  /** What the sheet prints, when the printed glyph differs from the DOM name. */
  display?: readonly string[];
  label: string;
  group: ShortcutGroupId;
  gate: ShortcutGate;
  mount: ConsoleKeyMount;
  /**
   * Keys in this row that stand down while one of the console's OWN controls
   * holds the keyboard. Not a gate: the sheet must not dim `Enter` for it,
   * because whether Enter activates a focused filter chip has nothing to do
   * with whether the row is available. `Enter` needs it because it means
   * activate on a control, and a global binding that ate it would make the
   * facet chips and the sort buttons unreachable by keyboard.
   */
  yieldKeys?: readonly string[];
  /**
   * This row lives UNDER another gate: it answers the key only while that
   * other gate is shut. The stacking order of the console's overlays, said
   * once — a new layer above means adding `under` here rather than hunting
   * for the place the Escape branches were ordered.
   */
  under?: ShortcutGate;
}

/** The sheet's section titles, from the same module the sections come from. */
export const CONSOLE_GROUPS: ReadonlyArray<{ id: ShortcutGroupId; title: string }> = [
  { id: 'walk', title: 'Walk the room' },
  { id: 'watch', title: 'Watch a run' },
  { id: 'row', title: 'The cursor row' },
  { id: 'anywhere', title: 'Anywhere on this page' },
];

/**
 * Every single key the console answers to, in the order they are met: the
 * walk, then the watch, then the keys that work anywhere. The chords of the
 * `g` namespace are NOT here — they are declared where they are bound,
 * because a chord's keys are a sequence and the sheet merges them into
 * these same sections (see ./ShortcutLegend).
 */
export const CONSOLE_KEYS: readonly ConsoleKey[] = [
  {
    id: 'walk-down',
    keys: ['j'],
    label: 'Walk down one row, wrapping at the ends',
    group: 'walk',
    gate: 'walk',
    mount: 'map',
  },
  {
    id: 'walk-up',
    keys: ['k'],
    label: 'Walk up one row, wrapping at the ends',
    group: 'walk',
    gate: 'walk',
    mount: 'map',
  },
  {
    id: 'commit',
    keys: ['Enter', 'w'],
    label: 'Open the watch pane on the row the walk stopped on',
    group: 'watch',
    gate: 'commit',
    mount: 'map',
    yieldKeys: ['Enter'],
  },
  {
    id: 'sweep-step',
    keys: ['ArrowLeft', 'ArrowRight'],
    display: ['←', '→'],
    label: 'Step the watched room back and forward',
    group: 'watch',
    gate: 'sweep',
    mount: 'map',
  },
  {
    id: 'sweep-jump',
    keys: ['Home', 'End'],
    label: 'Jump the watched room to its ends',
    group: 'watch',
    gate: 'sweep',
    mount: 'map',
  },
  {
    id: 'dismiss-pane',
    keys: ['Escape'],
    display: ['Esc'],
    label: 'Close the watch pane',
    group: 'watch',
    gate: 'pane',
    mount: 'layer',
    // The panel is a floating layer on top of the page, so while it is open
    // Escape belongs to it: one press closes one thing, and the mirror
    // underneath survives.
    under: 'views',
  },
  {
    id: 'open-sheet',
    keys: ['?'],
    label: 'Open this sheet',
    group: 'anywhere',
    gate: 'always',
    mount: 'map',
  },
  {
    id: 'close-sheet',
    keys: ['Escape'],
    display: ['Esc'],
    label: 'Close this sheet',
    group: 'anywhere',
    gate: 'always',
    mount: 'primitive',
  },
  {
    id: 'dismiss-views',
    keys: ['Escape'],
    display: ['Esc'],
    label: 'Close the views panel',
    group: 'anywhere',
    gate: 'views',
    mount: 'layer',
  },
  {
    id: 'open-palette',
    keys: ['Meta+k'],
    display: ['⌘K'],
    label: 'Open the command palette (Ctrl+K on PC keyboards)',
    group: 'anywhere',
    gate: 'always',
    mount: 'global',
  },
];

/**
 * The console's state, read as the gate expressions. One function, so the
 * hook's mount conditions and the sheet's dimming cannot disagree about
 * what "there is something to walk" means — which they could, and did, when
 * they were written twice.
 *
 * `sweep` is about the transport being useful, so it needs BOTH an open
 * pane and somewhere to step: a lone participant in a quiet room is a pane
 * with nothing to sweep. `link` is about the cursor having landed on a row,
 * not about a link string, which cannot be tested here anyway — runLink
 * reads window.location and this component is prerendered.
 */
export function consoleGates(state: {
  /** The rows the walk can move through, in display order. */
  sweepList: readonly string[];
  /** The watched run, or null when the pane is closed. */
  watchId: string | null;
  /** The status facet being applied, or null for the whole room. */
  viewsOpen: boolean;
  /** The row a cursor action would act on. */
  cursorTarget: string | null;
  /** That row's data, when the console can see it. */
  cursorRow: unknown;
}): ConsoleGates {
  return {
    walk: state.sweepList.length > 0,
    commit: state.cursorTarget !== null && state.cursorTarget !== state.watchId,
    sweep: state.watchId !== null && state.sweepList.length > 1,
    link: state.cursorRow !== null,
    pane: state.watchId !== null,
    views: state.viewsOpen,
  };
}

/**
 * Whether a gate is open. Exported because the chords read it too: a chord
 * and a single key gated on `commit` have to agree about what that means,
 * so the predicate is here rather than re-derived per caller.
 */
export function gateIsLive(gate: ShortcutGate, gates: ConsoleGates): boolean {
  if (gate === 'always') return true;
  return gates[gate];
}

/** Whether every gate a row depends on is satisfied, stacking included. */
function gatesPass(row: ConsoleKey, gates: ConsoleGates): boolean {
  if (!gateIsLive(row.gate, gates)) return false;
  if (row.under !== undefined && gateIsLive(row.under, gates)) return false;
  return true;
}

/**
 * Whether a row is available at all — what the sheet dims, and what decides
 * whether a layer is mounted. Deliberately does NOT consider `yieldKeys`:
 * a held control stands down ONE key, not the row.
 */
export function rowIsLive(row: ConsoleKey, gates: ConsoleGates): boolean {
  return gatesPass(row, gates);
}

/**
 * Whether one key of a row answers right now. `held` is the one courtesy the
 * gates cannot express: whether one of the console's own controls has the
 * keyboard, which stands down the keys in `yieldKeys`.
 *
 * Per KEY, not per row, and that distinction is load-bearing: `commit`
 * carries both Enter and w, and only Enter yields. Reading the yield as a
 * row condition would unbind `w` as well the moment a facet chip took the
 * keyboard — a key would go dead for a reason that has nothing to do with
 * it, and the sheet would have no way to say so.
 */
function keyIsLive(
  row: ConsoleKey,
  key: string,
  gates: ConsoleGates,
  held?: { ownControlFocused: boolean },
): boolean {
  if (!gatesPass(row, gates)) return false;
  if (held?.ownControlFocused === true && row.yieldKeys?.includes(key) === true) return false;
  return true;
}

/**
 * The page's one key map, built from the rows: every `map` row whose gate is
 * open, with the handler the page supplied for each of its keys.
 *
 * Built here rather than hand-written in the page so the sheet cannot offer
 * a key nothing dispatches. The reverse — a handler for a key no row names —
 * is dropped rather than mounted, since a binding the sheet does not
 * document is exactly the kind of extra the sheet exists to rule out: the
 * page's handler record is keyed by row id, so a typo shows up as a row that
 * does nothing in the tests rather than as a silent second binding.
 */
export function liveKeyMap(
  gates: ConsoleGates,
  held: { ownControlFocused: boolean },
  handlers: Readonly<Record<string, Readonly<Record<string, () => void>> | undefined>>,
): Record<string, () => void> {
  const map: Record<string, () => void> = {};
  for (const row of CONSOLE_KEYS) {
    if (row.mount !== 'map') continue;
    for (const key of row.keys) {
      if (!keyIsLive(row, key, gates, held)) continue;
      const handler = handlers[row.id]?.[key];
      if (handler !== undefined) map[key] = handler;
    }
  }
  return map;
}

/**
 * Whether an ordered layer row answers its key. Same predicate as the map
 * (so the stacking declared by `under` is honoured), exposed separately
 * because a layer has to be MOUNTED on its own, in stacking order: two
 * window listeners that both answer Escape would close both layers on one
 * press, so each layer's binding exists only while it is the topmost one.
 */
export function layerIsLive(id: string, gates: ConsoleGates): boolean {
  const row = CONSOLE_KEYS.find((candidate) => candidate.id === id);
  if (row === undefined || row.mount !== 'layer') return false;
  return rowIsLive(row, gates);
}

/**
 * The `aria-keyshortcuts` value for a set of rows, live KEYS only: a surface
 * must not advertise a key it is not currently answering, and the attribute
 * is written from the same rows the page binds, so the two cannot drift.
 * A key, not a row, because a row like `commit` can be half-standing (Enter
 * yields to a focused control while w does not).
 *
 * Empty when nothing in the set is live — callers pass `undefined` rather
 * than an empty attribute, since `aria-keyshortcuts=""` claims the surface
 * answers to nothing in particular. Ids that name no row are dropped rather
 * than thrown on, so a caller renaming a row fails its spec, not the page.
 */
export function liveShortcuts(
  ids: readonly string[],
  gates: ConsoleGates,
  held?: { ownControlFocused: boolean },
): string {
  return ids
    .map((id) => CONSOLE_KEYS.find((candidate) => candidate.id === id))
    .filter((row): row is ConsoleKey => row !== undefined)
    .flatMap((row) => row.keys.filter((key) => keyIsLive(row, key, gates, held)))
    .join(' ');
}

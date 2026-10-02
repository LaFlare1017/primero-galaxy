/**
 * The galaxy's company-search field, declared once.
 *
 * A floating search palette with a listbox under it (Circle's search, on the
 * star field): type a name, the matches narrow, ↑/↓ walk them, Enter flies to
 * the highlighted star, and Esc puts the palette away without selecting
 * anything. Small enough that its keys used to be three `if`s in an
 * `onKeyDown` and a fourth key bound somewhere else entirely — which is the
 * arrangement this module replaces: the keys, the conditions that decide
 * whether each exists, the keys surface advertises in `aria-keyshortcuts` and
 * the cap the field prints are now one list read by everything.
 *
 * What the field's keyboard actually is:
 *
 *   - THREE keys of the field's own, all gated on there being matches to
 *     walk or select: ↓ and ↑ move the highlight, Enter selects it. They are
 *     mounted on the field itself (the input exists only while the search is
 *     showing, which is what makes the gate a judgement rather than a
 *     measurement — see `searchGates`).
 *   - And one key the field does NOT bind: Esc. The galaxy page's own window
 *     listener closes what is open in priority order — the search first, then
 *     the add-company form, then the selection — so `mount: 'global'` says
 *     exactly what that means: bound by a component that is not this surface.
 *     The field still PRINTS it, because the person typing needs to know the
 *     palette closes (`printableCap`), and documents it here, because a key
 *     this surface relies on is a key this surface should be able to point at.
 *
 * Deliberately free of React and of every import, like the console's and the
 * palette's declarations, so a spec can import it straight into node for the
 * coherence checks (e2e/company-search-keys.spec.ts) and to a browser for the
 * coverage runner, without a bundler or a second test runner.
 */

/** The conditions that decide whether one of the field's keys exists right now. */
export interface SearchGates {
  /** The search is showing, so the page's own Escape would close this. */
  open: boolean;
  /** There are matches to walk and select. */
  results: boolean;
}

/** Whether a key is bound right now, or never gated at all. */
export type SearchGate = keyof SearchGates | 'always';

/**
 * How a row's keys reach the keyboard.
 *   - `layer`: mounted on the field itself, so it exists only while the search
 *     is showing and is under the page's own overlay priority.
 *   - `global`: bound once by a component that is not this surface at all.
 */
export type SearchKeyMount = 'layer' | 'global';

/** One single-key binding, as declared. */
export interface SearchKey {
  /** Stable id: what the page hangs behaviour on, and what callers name for aria. */
  id: string;
  /** The keys as the DOM spells them — `KeyboardEvent.key`, which is also how `aria-keyshortcuts` writes them. */
  keys: readonly string[];
  /** What a person reads, when the printed glyph differs from the DOM name. */
  display?: readonly string[];
  label: string;
  gate: SearchGate;
  mount: SearchKeyMount;
}

/**
 * Esc, printed by the field and bound by the page. Kept as a named row rather
 * than a literal in the JSX so the cap can be rendered from it: a shortcut
 * hint that says a key nothing binds is the failure this design exists to
 * prevent, in the one place a sighted user is most likely to believe it.
 */
export const CLOSE_SEARCH: SearchKey = {
  id: 'close-search',
  keys: ['Escape'],
  display: ['esc'],
  label: 'Close the search',
  gate: 'open',
  mount: 'global',
};

/** Walk to the next match. */
export const NEXT_RESULT: SearchKey = {
  id: 'next-result',
  keys: ['ArrowDown'],
  label: 'Walk to the next match',
  gate: 'results',
  mount: 'layer',
};

/** Walk back to the previous match. */
export const PREV_RESULT: SearchKey = {
  id: 'prev-result',
  keys: ['ArrowUp'],
  label: 'Walk back to the previous match',
  gate: 'results',
  mount: 'layer',
};

/** Fly to the highlighted match. */
export const SELECT_RESULT: SearchKey = {
  id: 'select-result',
  keys: ['Enter'],
  label: 'Select the highlighted match',
  gate: 'results',
  mount: 'layer',
};

/** Every key the field answers to, in the order a person meets them. */
export const SEARCH_KEYS: readonly SearchKey[] = [
  NEXT_RESULT,
  PREV_RESULT,
  SELECT_RESULT,
  CLOSE_SEARCH,
];

/**
 * The one surface that advertises the field's keys: the input, which is the
 * element an assistive tech lands on and the element both the walk and the
 * selection are delivered to.
 *
 * The Esc row is deliberately NOT here. It is `global` — the page binds it —
 * and a surface may only claim what it mounts itself, so the field advertises
 * the three keys it answers to and prints the fourth. Coverage is not claimed:
 * a row may be advertised by no surface at all, which is a gap, not a lie.
 */
export type SearchSurfaceId = 'field';

export const SEARCH_SURFACE_ROWS: Readonly<Record<SearchSurfaceId, readonly string[]>> = {
  field: ['next-result', 'prev-result', 'select-result'],
};

/**
 * The field's state, read as the gate expressions.
 *
 * `results` is a JUDGEMENT rather than the raw count, and the difference
 * matters: a closed search can still hold the last query, but it has no input
 * to press and nothing to walk, so for this keyboard it has no results.
 * Deriving it here is what keeps the enumeration of reachable states honest
 * (the coherence spec walks open/closed x matches, and the impossible
 * combinations are impossible by this line rather than by a note in a spec).
 */
export function searchGates(state: { open: boolean; matches: number }): SearchGates {
  return {
    open: state.open,
    results: state.open && state.matches > 0,
  };
}

/** Whether a gate is open. */
export function gateIsLive(gate: SearchGate, gates: SearchGates): boolean {
  if (gate === 'always') return true;
  return gates[gate];
}

/** Whether a row is available right now. */
export function rowIsLive(row: SearchKey, gates: SearchGates): boolean {
  return gateIsLive(row.gate, gates);
}

/**
 * Whether a layer row answers its key. Same predicate as `rowIsLive`, exposed
 * separately because a layer has to be mounted on its own — the page's Escape
 * and the field's own keys are answered in different places, and only one of
 * them is this surface's.
 */
export function layerIsLive(id: string, gates: SearchGates): boolean {
  const row = SEARCH_KEYS.find((candidate) => candidate.id === id);
  if (row === undefined || row.mount !== 'layer') return false;
  return rowIsLive(row, gates);
}

/**
 * The `aria-keyshortcuts` value for a set of rows, live keys only, built from
 * the rows themselves so the attribute can only advertise keys this module
 * declares — and only while they are live. Empty when nothing in the set is
 * live; callers pass `undefined` rather than an empty attribute, since
 * `aria-keyshortcuts=""` claims the surface answers to nothing in particular.
 */
export function liveShortcuts(ids: readonly string[], gates: SearchGates): string {
  return ids
    .map((id) => SEARCH_KEYS.find((candidate) => candidate.id === id))
    .filter((row): row is SearchKey => row !== undefined)
    .filter((row) => rowIsLive(row, gates))
    .flatMap((row) => [...row.keys])
    .join(' ');
}

/**
 * The cap to print for a row: what the row says a person should read, falling
 * back to the key as the DOM spells it. The field's one hint is rendered from
 * this, so the `esc` on screen is the row that exists rather than a word typed
 * in the JSX.
 */
export function printableCap(row: SearchKey): string {
  return (row.display ?? row.keys)[0];
}

/**
 * The row a keydown belongs to on the field right now, or undefined when the
 * key is not the field's at all.
 *
 * The search is over the rows the FIELD CLAIMS, not over every declared row,
 * and that is the point of it: the input dispatches exactly the keys the
 * input advertises, so a renamed row cannot go on working in the page while
 * the attribute stops mentioning it, and the global Escape row (which the page
 * binds) cannot be answered twice by a component that does not own it.
 */
export function fieldRow(key: string, gates: SearchGates): SearchKey | undefined {
  return SEARCH_SURFACE_ROWS.field
    .map((id) => SEARCH_KEYS.find((candidate) => candidate.id === id))
    .filter((row): row is SearchKey => row !== undefined)
    .find((row) => row.keys.includes(key) && rowIsLive(row, gates));
}

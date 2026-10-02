/**
 * The galaxy page's keyboard, declared once.
 *
 * One key, three jobs — and the ORDER is the whole of it. Escape on this page
 * is a dismissal ladder: if the search palette is showing it closes that, else
 * if the add-company sheet is showing it closes that, else it drops the current
 * selection (which closes the company profile and returns to the galaxy). Which
 * one a press reaches depends entirely on what is open, and before this module
 * that chain lived in one `if` after another inside a window listener — a shape
 * nobody could check, and one the field that PRINTS the cap (components/ui/
 * CompanySearch.tsx) and the sheet that also bound the key each had a private
 * copy of.
 *
 * The rungs are {@link GALAXY_KEYS}, top first, and each stands down for the
 * rungs above it through `under` — a LIST of gates rather than the single one a
 * two-layer overlay stack needs, because a ladder is exactly what `under`
 * cannot say with one name: dropping the selection is only Escape's job while
 * BOTH overlays are shut.
 *
 * Two things are worth knowing about this declaration in particular:
 *
 *   - The search rung is the same binding `close-search` that
 *     components/ui/companySearchKeys.ts declares, from the other side: the
 *     field documents the key it relies on, the page declares the key it
 *     answers. Neither can see the other, which is what `agreement` in
 *     e2e/keyboard-coherence.ts is for — and why its gate is named `open` here,
 *     the field's own name for "the search is showing". Two declarations of one
 *     binding that spell the state differently are disagreeing about it.
 *   - Nothing advertises these keys. The field prints the `esc` cap, and that
 *     print is declared in the field's own module; each overlay also has a
 *     visible close control. So this manifest declares NO surface (see
 *     {@link GALAXY_SURFACE_ROWS}) rather than inventing an attribute no
 *     element writes, and the one visible hint is checked where it lives.
 *
 * Deliberately free of React and of every import, like the other declarations,
 * so its spec can run the coherence checks in node and press the key in a
 * browser without a bundler or a second test runner.
 */

/** The page's facts, as the gate expressions read them. */
export interface GalaxyFacts {
  /** The search palette is showing. */
  search: boolean;
  /** The add-company sheet is showing. */
  add: boolean;
  /** A star is selected, so there is a profile and a mode to come back from. */
  selection: boolean;
}

/**
 * The conditions that decide whether one of the page's keys exists right now.
 *
 * `open` is the search palette, named as components/ui/companySearchKeys.ts
 * names it, because that row and this one describe one binding and the pairing
 * is checked: the same state under two names is a disagreement, not a dialect.
 * There is only ever one gate name for it, and it is the field's.
 */
export interface GalaxyGates {
  /** The search palette is showing, so Escape closes it first. */
  open: boolean;
  /** The add-company sheet is showing, so Escape closes it before the selection goes. */
  add: boolean;
  /** Something is selected, so there is a selection for Escape to drop. */
  selection: boolean;
}

/** Whether a key is bound right now, or never gated at all. */
export type GalaxyGate = keyof GalaxyGates | 'always';

/**
 * How a row's keys reach the keyboard.
 *   - `global`: the page's own window listener. Nothing is mounted for it — no
 *     key map, no layer — which is what makes the ladder's ORDER the only thing
 *     keeping three rows off one key.
 */
export type GalaxyKeyMount = 'global';

/** One single-key binding, as declared. */
export interface GalaxyKey {
  /** Stable id: what the page hangs behaviour on, and what a reader names. */
  id: string;
  /** The keys as the DOM spells them — `KeyboardEvent.key`. */
  keys: readonly string[];
  label: string;
  gate: GalaxyGate;
  mount: GalaxyKeyMount;
  /**
   * The rungs above this one. This row answers only while every gate named here
   * is shut — the if-chain, spelled out, one name per branch that has to be
   * asked first.
   */
  under?: readonly GalaxyGate[];
}

/**
 * Escape, top rung: put the search palette away without selecting anything.
 * The same binding components/ui/companySearchKeys.ts declares as a row the
 * field relies on, and paired with it in this declaration's spec.
 */
export const CLOSE_SEARCH: GalaxyKey = {
  id: 'close-search',
  keys: ['Escape'],
  label: 'Close the search',
  gate: 'open',
  mount: 'global',
};

/** Escape, middle rung: put the add-company sheet away. */
export const CLOSE_ADD_FORM: GalaxyKey = {
  id: 'close-add-form',
  keys: ['Escape'],
  label: 'Close the add-company sheet',
  gate: 'add',
  mount: 'global',
  // The page never shows both overlays at once (each control in the bottom bar
  // closes the other), but the chain asks about the search first either way —
  // and saying so is what keeps this row honest if that ever stops being true.
  under: ['open'],
};

/**
 * Escape, bottom rung: drop the selection, which closes the company profile and
 * returns to the galaxy. It is last because everything else is on top of it:
 * with an overlay open this row must NOT answer, or one press would close the
 * overlay and the profile behind it — the layered-dismissal bug the console
 * records in components/delegate/shortcuts.ts, in its ladder form.
 */
export const CLEAR_SELECTION: GalaxyKey = {
  id: 'clear-selection',
  keys: ['Escape'],
  label: 'Return to the galaxy',
  gate: 'selection',
  mount: 'global',
  under: ['open', 'add'],
};

/** Every key the page answers to, top rung first — the order is the chain. */
export const GALAXY_KEYS: readonly GalaxyKey[] = [CLOSE_SEARCH, CLOSE_ADD_FORM, CLEAR_SELECTION];

/**
 * The surfaces that advertise the ladder's keys: none.
 *
 * Each overlay carries its own visible close control, and the one keyboard hint
 * on this page (`esc` on the search field) belongs to the field, which declares
 * it and is checked against it there. A surface declared here would be an
 * `aria-keyshortcuts` attribute nothing writes, and the check over an empty set
 * of surfaces is that there is nothing to advertise rather than that nobody
 * asked.
 */
export type GalaxySurfaceId = never;

export const GALAXY_SURFACE_ROWS: Readonly<Record<GalaxySurfaceId, readonly string[]>> = {};

/** The page's state, read as the gate expressions. */
export function galaxyGates(facts: GalaxyFacts): GalaxyGates {
  return { open: facts.search, add: facts.add, selection: facts.selection };
}

/** Whether a gate is open. */
export function gateIsLive(gate: GalaxyGate, gates: GalaxyGates): boolean {
  if (gate === 'always') return true;
  return gates[gate];
}

/**
 * Whether a rung answers right now, stacking included: its own gate open and
 * every rung above it shut.
 */
export function rowIsLive(row: GalaxyKey, gates: GalaxyGates): boolean {
  if (!gateIsLive(row.gate, gates)) return false;
  return !(row.under ?? []).some((gate) => gateIsLive(gate, gates));
}

/**
 * Whether a row answers its key from the page's listener. The same predicate as
 * `rowIsLive`, exposed under the name the harness asks for: nothing here is
 * mounted by a key map or a layer, so this is the only way a rung is live.
 */
export function layerIsLive(id: string, gates: GalaxyGates): boolean {
  const row = GALAXY_KEYS.find((candidate) => candidate.id === id);
  if (row === undefined) return false;
  return rowIsLive(row, gates);
}

/**
 * The `aria-keyshortcuts` value for a set of rows, live keys only, built from
 * the rows themselves. Nothing on this page writes one today (see
 * {@link GALAXY_SURFACE_ROWS}) — it is here so that a surface which ever does
 * cannot advertise a key this module does not declare, and so the manifest
 * handed to the harness is complete rather than partial.
 */
export function liveShortcuts(ids: readonly string[], gates: GalaxyGates): string {
  return ids
    .map((id) => GALAXY_KEYS.find((candidate) => candidate.id === id))
    .filter((row): row is GalaxyKey => row !== undefined)
    .filter((row) => rowIsLive(row, gates))
    .flatMap((row) => [...row.keys])
    .join(' ');
}

/**
 * The rung a keydown belongs to right now, or undefined when the key is not the
 * page's at all — the topmost live row that answers it, which is the chain read
 * in order rather than re-stated as a branch.
 *
 * The page dispatches from this, so a rung that stopped being live (or a rung
 * renamed, or one dropped from the list) changes what Escape does in the page
 * rather than only in the declaration: the two cannot drift, because there is
 * only one of them.
 */
export function dismissalRow(key: string, gates: GalaxyGates): GalaxyKey | undefined {
  return GALAXY_KEYS.find((row) => row.keys.includes(key) && rowIsLive(row, gates));
}

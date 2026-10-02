/**
 * The saved-views panel's keyboard, declared once.
 *
 * Shared by both products that carry the popover (FinBench's run explorer and
 * the facilitator console), it has two modes: the list of saved views, and the
 * save/edit form that names one. That is the whole keyboard — a form field
 * that names a view, and a way back out of every layer:
 *
 *   - Enter in the name field confirms the form (save, or rename).
 *   - Escape in the form steps back to the list, WITHOUT closing the panel:
 *     a form is a layer, and the first press belongs to the topmost thing.
 *   - Escape in the list is the panel's own dismissal — Radix's popover, which
 *     this surface does not write. `under: 'form'` is what says the two are the
 *     same key in two states rather than two keys racing, and it is why this
 *     declaration shares no key at all (the console's has to allow the overlap,
 *     because its sheet answers Escape at every moment).
 *
 * The `under` is not decoration. Escape is the one key an overlay dismisses
 * itself with, and Radix listens for it in the CAPTURE phase — so the form's
 * branch has to be taken in the layer's own handler (the popover content's
 * `onEscapeKeyDown`), or it can never be reached: the panel would be dismissed
 * out from under the form before the field's keydown ever ran. That is the same
 * shape as the command palette's, and it is the reason `back-to-list` is
 * declared by the layer rather than by the input it is usually typed into.
 *
 * Deliberately free of React and of every import, like the other declarations,
 * so its spec can run the coherence checks in node and press the keys in a
 * browser without a bundler or a second test runner.
 */

/** The panel's modes; a `list` view has no form field and no form keys. */
export type SavedViewsMode = 'list' | 'save' | 'edit';

/**
 * The conditions that decide whether one of the panel's keys exists right now.
 * One name per reason the panel can refuse a key, so a binding, the
 * `aria-keyshortcuts` string and the coherence checks read the same answer.
 */
export interface SavedViewsGates {
  /** The panel is showing, so Escape has something to dismiss. */
  open: boolean;
  /** A save/edit form is showing on top of the list. */
  form: boolean;
}

/** Whether a key is bound right now, or never gated at all. */
export type SavedViewsGate = keyof SavedViewsGates | 'always';

/**
 * How a row's keys reach the keyboard.
 *   - `layer`: mounted on the popover's own layer, so it is stacked against the
 *     dismissal below it and exists only while the panel is open.
 *   - `primitive`: the dialog's own dismissal answers it (Radix installs it;
 *     this surface does not write it).
 */
export type SavedViewsKeyMount = 'layer' | 'primitive';

/** One single-key binding, as declared. */
export interface SavedViewsKey {
  /** Stable id: what the page hangs behaviour on, and what callers name for aria. */
  id: string;
  /** The keys as the DOM spells them — `KeyboardEvent.key`, which is also how `aria-keyshortcuts` writes them. */
  keys: readonly string[];
  label: string;
  gate: SavedViewsGate;
  mount: SavedViewsKeyMount;
  /** This row answers its key only while that other gate is shut. */
  under?: SavedViewsGate;
}

/** Enter in the name field: save the view, or apply the rename. */
export const CONFIRM_NAME: SavedViewsKey = {
  id: 'confirm-name',
  keys: ['Enter'],
  label: 'Save the view being named',
  gate: 'form',
  mount: 'layer',
};

/**
 * Escape in the form: back to the list. Declared by the LAYER rather than by
 * the input, because that is where a dismissal key can be stopped before Radix
 * acts on it (see the module header) — and because a user who tabbed to the
 * Save button is still owed the same way back.
 */
export const BACK_TO_LIST: SavedViewsKey = {
  id: 'back-to-list',
  keys: ['Escape'],
  label: 'Leave the form and go back to the list',
  gate: 'form',
  mount: 'layer',
};

/** Escape in the list: close the panel. */
export const CLOSE_PANEL: SavedViewsKey = {
  id: 'close-panel',
  keys: ['Escape'],
  label: 'Close the saved views',
  gate: 'open',
  mount: 'primitive',
  // The panel's own dismissal answers Escape exactly while there is no form
  // for it to leave instead.
  under: 'form',
};

/** Every key the panel answers to, in the order a person meets them. */
export const SAVED_VIEWS_KEYS: readonly SavedViewsKey[] = [CONFIRM_NAME, BACK_TO_LIST, CLOSE_PANEL];

/**
 * The one surface that advertises the panel's keys: the name field, which is
 * where the form puts the keyboard (it is autofocused when the form opens).
 *
 * Both form rows are claimed, because both are live exactly while the field is
 * on screen and both are about what happens to what is typed. The dismissal is
 * not: it is `primitive`, so the panel does not bind it and may not claim it.
 */
export type SavedViewsSurfaceId = 'name';

export const SAVED_VIEWS_SURFACE_ROWS: Readonly<Record<SavedViewsSurfaceId, readonly string[]>> = {
  name: ['confirm-name', 'back-to-list'],
};

/**
 * The panel's state, read as the gate expressions. `form` is derived rather
 * than told: a form cannot be showing while the panel is shut, and saying so
 * here is what keeps an impossible combination out of the coherence spec's
 * enumeration instead of leaving it to a comment.
 */
export function savedViewsGates(state: {
  open: boolean;
  mode: SavedViewsMode;
}): SavedViewsGates {
  return {
    open: state.open,
    form: state.open && state.mode !== 'list',
  };
}

/** Whether a gate is open. */
export function gateIsLive(gate: SavedViewsGate, gates: SavedViewsGates): boolean {
  if (gate === 'always') return true;
  return gates[gate];
}

/** Whether a row is available right now, stacking included. */
export function rowIsLive(row: SavedViewsKey, gates: SavedViewsGates): boolean {
  if (!gateIsLive(row.gate, gates)) return false;
  if (row.under !== undefined && gateIsLive(row.under, gates)) return false;
  return true;
}

/**
 * Whether a layer row answers its key. Same predicate as `rowIsLive`, exposed
 * separately for the same reason the other declarations do it: a layer has to
 * be mounted on its own, so the form's Escape and the panel's dismissal can
 * exist in different states without two handlers racing for one press.
 */
export function layerIsLive(id: string, gates: SavedViewsGates): boolean {
  const row = SAVED_VIEWS_KEYS.find((candidate) => candidate.id === id);
  if (row === undefined || row.mount !== 'layer') return false;
  return rowIsLive(row, gates);
}

/**
 * The `aria-keyshortcuts` value for a set of rows, live keys only, built from
 * the rows themselves: the attribute cannot advertise a key this module does
 * not declare, nor one that is not live right now. Empty when nothing in the
 * set is live; callers pass `undefined` rather than an empty attribute, since
 * `aria-keyshortcuts=""` claims the surface answers to nothing in particular.
 */
export function liveShortcuts(ids: readonly string[], gates: SavedViewsGates): string {
  return ids
    .map((id) => SAVED_VIEWS_KEYS.find((candidate) => candidate.id === id))
    .filter((row): row is SavedViewsKey => row !== undefined)
    .filter((row) => rowIsLive(row, gates))
    .flatMap((row) => [...row.keys])
    .join(' ');
}

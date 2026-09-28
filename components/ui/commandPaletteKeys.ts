/**
 * The ⌘K command palette's keyboard, declared once.
 *
 * This is the second surface to declare its keys rather than write them where
 * they are bound, and the first that is not the facilitator console
 * (components/delegate/consoleShortcuts.ts) — so it is also the first test of
 * whether that declaration is a SHAPE or a habit. It is a shape: the same rows,
 * the same gates, the same readers, and e2e/keyboard-coherence.ts reads it with
 * no change to the harness at all.
 *
 * What the palette's keyboard actually is:
 *
 *   - ONE chord, bound for the whole app rather than for this surface: `⌘K`
 *     and `Ctrl+K`. It toggles, so it answers whether the palette is open or
 *     shut, and the row is `global` for the same reason the console's
 *     declaration calls the very same binding global — the component that
 *     binds it sits in the app layout, above whatever page is on screen.
 *   - TWO ways back out of a sub-list, and Backspace is the one that is gated
 *     twice: Escape returns to the root route from either sub-list, while a
 *     Backspace with text in the field belongs to the caret. `emptySubroute`
 *     is that distinction said once, so the key and the claim about it cannot
 *     disagree about when it means "delete a character".
 *   - And the dialog's own dismissal, one layer down: Escape closes the
 *     palette, but only at the root route. That is what `under: 'subroute'`
 *     says, and it is the difference from the console worth recording — the
 *     console's sheet owns Escape at every moment and its watch pane answers
 *     Escape while it is open, so those two genuinely overlap and that
 *     declaration has to allow the shared key. Here the two Escape bindings
 *     are mutually exclusive BY STATE, so this declaration shares no key at
 *     all and the harness can prove that rather than excuse it.
 *
 * Deliberately free of React and of every import, like the console's module
 * and for the same reasons: it stays testable on its own, and it can be
 * imported straight into the node half of e2e/command-palette.spec.ts, where
 * the coherence checks live, without a bundler or a second test runner.
 */

/** The routes the palette shows: the root menu, or one of the two sub-lists. */
export type PaletteRoute = 'root' | 'tasks' | 'scenarios';

/**
 * The conditions that decide whether one of the palette's keys exists right
 * now — one name per reason the palette can refuse a key, so a binding, the
 * `aria-keyshortcuts` string and the coherence checks all read the same
 * answer.
 */
export interface PaletteGates {
  /** The palette is showing, so there is something to close. */
  open: boolean;
  /** A sub-list is showing, so there is a root menu to go back to. */
  subroute: boolean;
  /** A sub-list is showing with nothing typed, so Backspace has nothing to delete. */
  emptySubroute: boolean;
}

/** Whether a key is bound right now, or never gated at all. */
export type PaletteGate = keyof PaletteGates | 'always';

/**
 * How a row's keys reach the keyboard. Every row has to say, because
 * "documented" and "bound" are different claims.
 *   - `layer`: mounted on the dialog's own layer, so it exists only while the
 *     palette is open and is stacked against the dismissal below it.
 *   - `primitive`: the dialog's own dismissal answers it (Radix installs it,
 *     and the palette does not write it).
 *   - `global`: bound once, on `window`, for every page in the app.
 * There is no `map` row here, and that is a fact about the surface rather than
 * an omission: the palette mounts no window-level key map, so no reader of this
 * declaration ever has a map to build.
 */
export type PaletteKeyMount = 'layer' | 'primitive' | 'global';

/** One single-key binding, as declared. */
export interface PaletteKey {
  /** Stable id: what the page names when it asks for a row, and what callers name for aria. */
  id: string;
  /**
   * The keys as the DOM spells them — `KeyboardEvent.key`, which is also how
   * `aria-keyshortcuts` writes them. Space-joined within a key for a modifier
   * chord (`Meta+k`); one array entry per alternative.
   */
  keys: readonly string[];
  label: string;
  gate: PaletteGate;
  mount: PaletteKeyMount;
  /**
   * This row lives UNDER another gate: it answers its key only while that
   * other gate is shut. The palette's layering, said once — the dialog's own
   * dismissal is under `subroute`, so leaving a sub-list and closing the
   * palette are the same key in two states rather than two keys racing.
   */
  under?: PaletteGate;
}

/**
 * The one chord the palette owns globally, as `KeyboardEvent` spells it. Named
 * here so the row below and the window listener in the component read the same
 * spelling: the listener matches against this and cannot drift from what the
 * declaration says is bound.
 */
export const TOGGLE_PALETTE_KEYS: readonly string[] = ['Meta+k', 'Control+k'];

/**
 * Every key the palette answers to. Four rows, and only two of them are the
 * palette's own business in any state a user can see: the toggle is app-wide,
 * and the dismissal belongs to Radix.
 */
export const PALETTE_KEYS: readonly PaletteKey[] = [
  {
    id: 'toggle-palette',
    keys: TOGGLE_PALETTE_KEYS,
    label: 'Open the command palette, or close it if it is already showing',
    gate: 'always',
    mount: 'global',
  },
  {
    id: 'back-to-root',
    keys: ['Escape'],
    label: 'Leave a list and go back to the root menu',
    gate: 'subroute',
    mount: 'layer',
  },
  {
    id: 'backspace-to-root',
    keys: ['Backspace'],
    label: 'Leave a list with nothing typed and go back to the root menu',
    gate: 'emptySubroute',
    mount: 'layer',
  },
  {
    id: 'close-palette',
    keys: ['Escape'],
    label: 'Close the palette',
    gate: 'open',
    mount: 'primitive',
    // The dialog's own dismissal answers Escape exactly while there is no
    // sub-list for it to leave instead.
    under: 'subroute',
  },
];

/**
 * The one surface that advertises the palette's keys: the dialog itself, which
 * is what `aria-keyshortcuts` is written onto.
 *
 * Only rows the palette MOUNTS belong here. The toggle is bound by the layout
 * component above this surface and the dismissal by Radix, so the dialog may
 * not claim either — it does not answer to them, and the harness fails a
 * surface that tries. The two rows it does claim are exactly the two keys a
 * keyboard user inside the palette has, which is the whole claim.
 */
export type PaletteSurfaceId = 'dialog';

export const PALETTE_SURFACE_ROWS: Readonly<Record<PaletteSurfaceId, readonly string[]>> = {
  dialog: ['back-to-root', 'backspace-to-root'],
};

/**
 * The palette's state, read as the gate expressions. One function, so the
 * bindings' mount conditions and the `aria-keyshortcuts` string cannot
 * disagree about what "there is somewhere to go back to" means.
 *
 * `inputEmpty` is a fact the palette tracks rather than one it derives: cmdk
 * owns the query, and whether there is one is all this keyboard needs to know
 * about it (see `backspace-to-root`). `open` is a gate of its own because the
 * dialog's dismissal exists only while it is showing, and a gate that says
 * "open" is a fact about the palette rather than a second reading of the
 * subroute.
 */
export function paletteGates(state: {
  open: boolean;
  route: PaletteRoute;
  inputEmpty: boolean;
}): PaletteGates {
  const subroute = state.open && state.route !== 'root';
  return {
    open: state.open,
    subroute,
    emptySubroute: subroute && state.inputEmpty,
  };
}

/** Whether a gate is open. Exported because every reader below starts here. */
export function gateIsLive(gate: PaletteGate, gates: PaletteGates): boolean {
  if (gate === 'always') return true;
  return gates[gate];
}

/** Whether a row is available right now, stacking included. */
export function rowIsLive(row: PaletteKey, gates: PaletteGates): boolean {
  if (!gateIsLive(row.gate, gates)) return false;
  if (row.under !== undefined && gateIsLive(row.under, gates)) return false;
  return true;
}

/**
 * Whether a layer row answers its key. Same predicate as `rowIsLive`, exposed
 * separately for the same reason the console exposes it: a layer has to be
 * MOUNTED on its own, so the two Escape bindings can exist in different states
 * without two handlers racing for one press.
 */
export function layerIsLive(id: string, gates: PaletteGates): boolean {
  const row = PALETTE_KEYS.find((candidate) => candidate.id === id);
  if (row === undefined || row.mount !== 'layer') return false;
  return rowIsLive(row, gates);
}

/**
 * The `aria-keyshortcuts` value for a set of rows, live keys only: a surface
 * must not advertise a key it is not currently answering, and the attribute is
 * written from the same rows the dialog binds, so the two cannot drift. Empty
 * when nothing in the set is live — callers pass `undefined` rather than an
 * empty attribute, since `aria-keyshortcuts=""` claims the surface answers to
 * nothing in particular. Ids that name no row are dropped rather than thrown
 * on, so a caller renaming a row fails its spec, not the page.
 */
export function liveShortcuts(ids: readonly string[], gates: PaletteGates): string {
  return ids
    .map((id) => PALETTE_KEYS.find((candidate) => candidate.id === id))
    .filter((row): row is PaletteKey => row !== undefined)
    .filter((row) => rowIsLive(row, gates))
    .flatMap((row) => [...row.keys])
    .join(' ');
}

/**
 * Whether a keydown is one of these modifier chords, as the DOM spells it.
 *
 * The palette binds one chord and it is a MODIFIED one, which the repo's shared
 * bare-key hook deliberately refuses (`shortcutAllowed` in
 * components/delegate/shortcuts.ts rejects any press with a modifier held). So
 * the match lives beside the row that declares it, and the listener reads
 * `TOGGLE_PALETTE_KEYS` instead of spelling the chord a second time — which is
 * also what keeps the row's second spelling honest: `Control+k` is the same
 * binding on a keyboard with no ⌘ key, not a decoration.
 *
 * Modifiers must match EXACTLY. `Ctrl+Shift+K` is a different chord, and a
 * matcher that ignored it would have the row advertising less than the page
 * binds — the same drift in the other direction.
 */
export function matchesModifiedKey(
  keys: readonly string[],
  event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
): boolean {
  if (event.altKey || event.shiftKey) return false;
  return keys.some((spelling) => {
    const [modifier, ...rest] = spelling.split('+');
    const letter = rest.join('+');
    if (letter === '') return false;
    if (modifier === 'Meta') {
      if (!event.metaKey || event.ctrlKey) return false;
    } else if (modifier === 'Control') {
      if (!event.ctrlKey || event.metaKey) return false;
    } else {
      return false;
    }
    return event.key.toLowerCase() === letter.toLowerCase();
  });
}

/**
 * Shared keyboard-shortcut policy for the Delegate surfaces (the
 * facilitator console today; the participant workspace or any future
 * surface that wants global shortcuts next).
 *
 * A window-level shortcut is a blunt instrument: it sees every key the
 * page receives, including the ones that were never meant for it. These
 * predicates are the single answer to "may this shortcut act?", so a
 * surface inherits the same courtesy rules instead of re-deriving them:
 * never steal a keystroke from a field the facilitator is typing in, never
 * fire through an overlay that is still open on top of the surface, and
 * never claim a chord the browser or the OS already owns.
 *
 * Deliberately free of React and of every import, for two reasons. The
 * React wiring lives in ./useKeyboardShortcuts, so the policy stays
 * testable on its own; and a module with no dependencies can be handed
 * straight to a browser for the unit spec (e2e/delegate-shortcuts.spec.ts
 * transpiles this file and runs it against real DOM) without a bundler or
 * a second test runner.
 */

/**
 * Any layer at all — a dialog, or whatever Radix has portaled into its
 * positioning wrapper — open or not. Asked only by the second question in
 * `owningLayer` below, and deliberately wider than the open-layer
 * selector: the difference between the two is the whole point.
 */
const LAYER_SELECTOR = ['[role="dialog"]', '[data-radix-popper-content-wrapper] > *'].join(', ');

/**
 * The overlays a global shortcut must not fire through, in one selector.
 *
 * `[role="dialog"]` is the clause that is load-bearing today: the command
 * palette is a dialog and navigates its own results with arrows, which
 * outrank a shortcut on the page behind it. The saved-views panel lands
 * here too, which is worth recording because it is not obvious: Radix
 * 1.1.23 stamps `role="dialog"` on PopoverContent in its shared content
 * impl, so modality (`<Popover modal>`) changes the focus trap and the
 * outside-pointer-events ban, NOT the role. A non-modal popover is a
 * dialog by the time it reaches the DOM. Measured on the running app and
 * pinned by the popover case in e2e/facilitator-run-link.spec.ts.
 *
 * The second clause is the belt to that braces: any OPEN floating layer,
 * found by the popper wrapper Radix positions its content in, whether or
 * not the content claims a role. It is what shields a role-less panel
 * (a hand-rolled dropdown, a portaled menu, a future primitive that
 * drops the dialog role), and it is keyed on `[data-state="open"]` so a
 * layer that is mounted but closed does not shadow the page. The dialog
 * clause gets the same treatment, so both read as one rule: an overlay
 * owns the keys while it is open, and not a tick longer. Dropdown menus,
 * selects and tooltips mount in that wrapper too, so they inherit the
 * rule without anyone opting in.
 */
const OVERLAY_SELECTOR = [
  '[role="dialog"]:not([data-state="closed"])',
  '[data-radix-popper-content-wrapper] [data-state="open"]',
].join(', ');

/**
 * The layer that owns this keystroke, or null.
 *
 * Two questions, because "is a layer open?" and "did this key just belong to
 * a layer?" are not the same question, and the second one is a trap with a
 * measured answer.
 *
 * The first is the selector: an open dialog, or an open popper layer, owns
 * the keys. Straightforward, and what the guard used to be.
 *
 * The second is the timing. Radix listens for Escape in the CAPTURE phase,
 * so a layer that dismisses itself has already flipped to
 * `data-state="closed"` — and is still mounted, and still holding focus —
 * by the time a bubble-phase listener on window asks who owns the
 * keystroke. A selector keyed on "open" then reports "nobody owns this" for
 * a keypress the layer is in the middle of handling, and the shortcut
 * underneath fires through: one Escape used to close the saved-views panel
 * AND the watch pane behind it, then the shortcut sheet AND the pane.
 * Measured identically on the popover, the sheet and the command palette.
 *
 * Focus is what separates the two meanings of `data-state="closed"`. A
 * genuinely closed layer is inert and holds no focus, so the key it "lost"
 * long ago cannot be aimed at it; a layer dismissing itself still holds the
 * very element the key was aimed at. So the rule is: the layer that holds
 * the focused element owns the key, and nothing else does. The one clause
 * below for a layer that has already been REMOVED outright covers the
 * remaining shape of the same problem.
 */
function owningLayer(target: HTMLElement): Element | null {
  if (target.closest(OVERLAY_SELECTOR) !== null) return target;
  const layer = target.closest(LAYER_SELECTOR);
  if (layer === null) return null;
  const focused = target.ownerDocument.activeElement;
  // Closing: closed by its own key, still focused, still mounted.
  if (focused !== null && layer.contains(focused)) return layer;
  // Removed outright by that key (no exit animation, so no mounted-closed
  // state to catch it): the target has been torn off the page, and a key
  // aimed at something that has just been removed belongs to whatever
  // removed it, not to the page behind it.
  if (!target.isConnected) return layer;
  return null;
}

/**
 * True when a key event belongs to something that owns its own keys, so a
 * global shortcut must keep its hands off: a text field or select (the
 * palette search, a filter box), a content-editable host, or anything
 * inside an open overlay — a modal dialog, or a popover like the
 * saved-views panel. A popover is in scope even though it only holds
 * buttons today: a shortcut firing "through" a panel the facilitator is
 * still using moves the surface underneath something that is very much
 * still open, and the rule has to be right before the panel grows a field
 * that swallows letters.
 *
 * Key-agnostic on purpose: it answers "who owns this keystroke?", not
 * "which key is it?". The key match belongs to the caller's binding.
 *
 * ONE TIMING FACT, measured on the running app and worth stating plainly,
 * because it decides how a binding for a key an overlay also handles has
 * to be written: a layer that dismisses itself on a key is CLOSED by the
 * time the page's listener runs, while still holding the focus the key was
 * aimed at. `owningLayer` below is the answer; a caller that binds a key its
 * own overlays also handle should STILL layer by state — is the panel open?
 * — since that is the one thing the DOM cannot be asked mid-dispatch, and
 * should say which is which in a comment. The console's Escape binding is
 * written that way; the e2e case that pins the behaviour is in
 * e2e/facilitator-run-link.spec.ts and the predicate's own cases are in
 * e2e/delegate-shortcuts.spec.ts.
 */
export function ownsArrowKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return owningLayer(target) !== null;
}

/**
 * The full gate for an unmodified, window-level shortcut: the target must
 * not already own the keystroke, and no modifier may be held.
 *
 * Modifiers are refused outright rather than matched. Cmd+Left/Right is
 * the browser's own back/forward gesture and Alt+Arrow is a word-jump in
 * any text field, so a bare-key binding has no business claiming either.
 * Shift alone is allowed through: it is not a chord anyone else owns on
 * this page, and pinning that here keeps the policy honest about what it
 * does and does not arbitrate. Shortcuts that genuinely need a chord
 * should compose their own handler on top of `ownsArrowKeys` rather than
 * widen this predicate.
 */
export function shortcutAllowed(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return !ownsArrowKeys(event.target);
}

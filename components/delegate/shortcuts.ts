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
 */
export function ownsArrowKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.closest(OVERLAY_SELECTOR) !== null;
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

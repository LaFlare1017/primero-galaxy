/**
 * Shared keyboard-shortcut policy for the Delegate surfaces (the
 * facilitator console today; the participant workspace or any future
 * surface that wants global shortcuts next).
 *
 * A window-level shortcut is a blunt instrument: it sees every key the
 * page receives, including the ones that were never meant for it. These
 * predicates are the single answer to "may this shortcut act?", so a
 * surface inherits the same courtesy rules instead of re-deriving them:
 * never steal a keystroke from a field the facilitator is typing in, and
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
 * True when a key event belongs to something that owns its own arrow
 * keys, so a global shortcut must keep its hands off: a text field or
 * select (the palette search, a filter box), a content-editable host, or
 * anything inside an open modal — the command palette is a dialog and
 * navigates its own results with arrows, which outrank a shortcut firing
 * on the page behind it.
 *
 * Key-agnostic on purpose: it answers "who owns this keystroke?", not
 * "which key is it?". The key match belongs to the caller's binding.
 */
export function ownsArrowKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.closest('[role="dialog"]') !== null;
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

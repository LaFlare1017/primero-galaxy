"use client";

import { useEffect, useRef } from "react";

import { shortcutAllowed } from "@/components/delegate/shortcuts";

/**
 * Bindings keyed by `KeyboardEvent.key` — unmodified keys only, because
 * that is all the shared policy in ./shortcuts arbitrates. The handler
 * receives the event after its default has already been prevented, so a
 * shortcut never leaves the page (or a scrollable pane) moving underneath
 * the thing it just acted on.
 */
export type ShortcutHandlers = Record<string, (event: KeyboardEvent) => void>;

/**
 * Mount window-level keyboard shortcuts for a Delegate surface, with the
 * shared courtesy rules applied: nothing fires from inside a text field,
 * a content-editable host, or an open modal, and no modified press is
 * ever claimed.
 *
 * One call replaces a hand-rolled listener plus its guards, so a surface
 * cannot accidentally ship a shortcut that fights the palette for the
 * arrow keys. Pass `enabled` to mount nothing at all when the shortcut
 * has no meaning right now (no selection, nothing to step to) rather than
 * attaching a handler that would no-op.
 *
 * Held keys repeat, like any transport control: each auto-repeat is one
 * more step. That is the behaviour a facilitator expects when walking a
 * roster, and it is bounded by the same list the buttons walk.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  // Latest bindings in a ref: consumers pass an inline object literal, so
  // depending on it directly would tear down and rebuild the window
  // listener on every single render.
  const latest = useRef(handlers);
  // Declared before the subscription so that, on the render where
  // `enabled` flips true, the ref is already current before the listener
  // can see an event.
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event)) return;
      const handler = latest.current[event.key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

'use client';

import { useEffect, useRef } from 'react';

import { shortcutAllowed } from '@/components/delegate/shortcuts';
import type { ShortcutHandlers } from '@/components/delegate/useKeyboardShortcuts';

/**
 * Chained shortcuts — two keystrokes in a row, the way GitHub and Gmail
 * bind `g` then a destination. The pair buys a verb that no single key
 * could claim without stealing one: `g i` is the top of a list, `g n` the
 * bottom, and neither `g` nor `i` nor `n` means anything on its own.
 *
 * Keys are `event.key` values joined by single spaces, so the map reads
 * like the chord: `{ 'g i': toFirst, 'g n': toLast }`. Any depth works —
 * a key that begins a longer sequence arms it and does nothing else.
 *
 * Two rules make the chord safe to layer over a surface that already has
 * single-key shortcuts:
 *
 *   - An unbound second key FALLS THROUGH. `g j` is not a chord, so the
 *     walk still happens on the `j`; the hook arms `g`, declines to own
 *     the rest, and the other binding sees the key untouched. The hook
 *     never calls stopImmediatePropagation on a key it does not own,
 *     which is why this holds whatever order the listeners were added in.
 *   - A prefix lapses. The armed chord expires after `timeoutMs`, so a
 *     `g` followed by a pause cannot be completed by a stray `i` or `n`
 *     much later. That bound is also why the hook ignores the keys typed
 *     into a dialog: the policy refuses the whole event, so nothing arms
 *     in the first place, and anything already armed simply runs out.
 *
 * The courtesy rules themselves are not repeated here — everything goes
 * through the shared policy in ./shortcuts, so a chord behaves exactly
 * like a single-key shortcut in a text field, a content-editable host, or
 * an open overlay, and a modified press is never claimed.
 */

/** How long a prefix stays armed, in ms. Long enough to type a chord, short
 * enough that a forgotten `g` cannot fire at the next letter. */
const DEFAULT_SEQUENCE_TIMEOUT_MS = 1500;

export function useKeySequence(
  sequences: ShortcutHandlers,
  enabled = true,
  timeoutMs: number = DEFAULT_SEQUENCE_TIMEOUT_MS,
): void {
  // Latest bindings in a ref, for the same reason as useKeyboardShortcuts:
  // consumers pass an inline object, and depending on it directly would
  // tear the listener down on every render.
  const latest = useRef(sequences);
  useEffect(() => {
    latest.current = sequences;
  });

  useEffect(() => {
    if (!enabled) return;
    // The armed prefix, as a space-joined prefix of a sequence key.
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disarm = () => {
      pending = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event)) return;
      const step = pending === null ? event.key : `${pending} ${event.key}`;
      const handler = latest.current[step];
      if (handler) {
        disarm();
        event.preventDefault();
        handler(event);
        return;
      }
      if (pending !== null) {
        // The chord this key completes is not one we define, so the chord
        // is not ours. Disarm and leave the event completely alone: the
        // key belongs to whatever else is bound, which is what makes
        // `g j` walk the grid.
        disarm();
        return;
      }
      // Does this key begin a sequence? Then it arms one and acts on
      // nothing. No preventDefault: the key is inert by design, and
      // claiming its default would be claiming a shortcut we have not
      // performed.
      if (Object.keys(latest.current).some((seq) => seq.startsWith(`${event.key} `))) {
        pending = event.key;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(disarm, timeoutMs);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      disarm();
    };
  }, [enabled, timeoutMs]);
}

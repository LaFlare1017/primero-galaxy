'use client';

import { useEffect, useRef, useState } from 'react';

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
 *
 * Returns the ARMED PREFIX, or null when nothing is waiting — `'g'` right
 * after the first key of `g i`. A prefix that does nothing is also a
 * prefix nobody can see: the key was declined on purpose, so the surface
 * owes the person who pressed it some sign that the console heard them
 * and is waiting for the rest. Rendering that state is the caller's job,
 * and it is the only honest place to do it — the hook knows the prefix,
 * the surface knows what the console looks like. Worth rendering into a
 * live region: a sighted facilitator reads the chip, and a screen
 * reader has no other way to learn that a chord is half-typed.
 */

/** How long a prefix stays armed, in ms. Long enough to type a chord, short
 * enough that a forgotten `g` cannot fire at the next letter. */
const DEFAULT_SEQUENCE_TIMEOUT_MS = 1500;

export function useKeySequence(
  sequences: ShortcutHandlers,
  enabled = true,
  timeoutMs: number = DEFAULT_SEQUENCE_TIMEOUT_MS,
): string | null {
  // Latest bindings in a ref, for the same reason as useKeyboardShortcuts:
  // consumers pass an inline object, and depending on it directly would
  // tear the listener down on every render.
  const latest = useRef(sequences);
  useEffect(() => {
    latest.current = sequences;
  });

  // The armed prefix (a space-joined prefix of a sequence key), held twice
  // on purpose: in a ref because the listener must read the current value
  // without the subscription depending on it, and in state because the
  // surface has to be able to render it.
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disarm = () => {
      pendingRef.current = null;
      setPending(null);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event)) return;
      const armed = pendingRef.current;
      const step = armed === null ? event.key : `${armed} ${event.key}`;
      const handler = latest.current[step];
      if (handler) {
        disarm();
        event.preventDefault();
        handler(event);
        return;
      }
      if (armed !== null) {
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
        pendingRef.current = event.key;
        setPending(event.key);
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

  return pending;
}

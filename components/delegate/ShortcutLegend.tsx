'use client';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/primitives/dialog';
import { KeyCap } from '@/components/ui/KeyCap';
import {
  CONSOLE_CHORDS,
  CONSOLE_GROUPS,
  CONSOLE_KEYS,
  gateIsLive,
  type ConsoleGates,
  type ShortcutGate,
} from '@/components/delegate/consoleShortcuts';
import { cn } from '@/lib/utils';

/**
 * The console's shortcut sheet: what every key on this page does, and —
 * the part that earns it — whether it is available right now.
 *
 * A legend that lists the same keys in every state is a wallpaper. The
 * console's bindings are conditional by design (there is nothing to walk
 * in an empty room, nothing to commit when the cursor is already watched,
 * nothing to sweep unless a run is being watched and the room has more than
 * one participant), so a sheet that cannot show that is quietly lying about
 * the surface it documents. `gates` is the way out: the page passes the
 * very expressions that mount each binding, so an entry dims in the same
 * render its key goes dead, and the two cannot disagree.
 *
 * Nothing about the keys themselves is written here. The single keys AND the
 * chained ones, with their words, their sections and their gates, all arrive
 * from ./consoleShortcuts — the same module the page binds from and the same
 * one the `aria-keyshortcuts` strings are built from. Retyping either would
 * be a second source of truth for the same keyboard, which is the drift this
 * component exists to prevent: this file is layout, ordering and words, with
 * no keyboard facts of its own. The chords are read from the declaration
 * rather than handed in by the surface that binds them, because the module
 * that owns the single keys now owns them too — there is nowhere left for a
 * documented chord and a bound chord to disagree.
 *
 * The sheet is a Radix dialog, which is the whole reason it inherits the
 * shared shortcut policy for free: the policy refuses any key whose target
 * is inside an open role="dialog", so every shortcut on the page goes inert
 * the moment this opens and comes back when it closes. There is nothing to
 * suspend here, which is the reason this is a dialog and not a panel.
 *
 * `?` opens it and Escape closes it (the dialog primitive's own
 * dismissal). `?` deliberately does NOT toggle: while the sheet is open the
 * policy has already stopped `?` from reaching the page, and it would be
 * dishonest for the sheet about shortcuts to punch through the rule the
 * rest of the console obeys.
 *
 * Escape appears three times, once per layer it can close, and the three
 * are gated separately for a reason: the console binds Escape to the
 * topmost thing it opened, so which one a press reaches depends on what is
 * open, and a single "Esc closes the sheet or the panel" line cannot say
 * that. Split, each entry dims with the layer it closes, so the sheet
 * shows the key the way the page will honour it right now.
 *
 * Each row also says HOW its key is bound (`mount`), which is a claim the
 * sheet is making either way: `primitive` and `global` rows are documented
 * here but bound elsewhere — the dialog dismisses itself, the app layout's
 * palette owns ⌘K — and keeping that in the data means the sheet never
 * implies the console dispatches something it does not.
 */

interface ShortcutEntry {
  /**
   * Key labels, as alternatives — unless one contains a space, which makes
   * it a chord and renders as "g then i". Spaces are real, not flex gaps:
   * a screen reader should hear the same words the eye reads.
   */
  keys: string[];
  label: string;
  /** The gate that decides whether this shortcut is bound at all. */
  gate: ShortcutGate;
}

/**
 * Alternative keys, and chords within them, as caps separated by REAL
 * whitespace. The separators are text, not flex `gap`: a gap is invisible
 * to the text content, so a sheet built out of gaps reads "gtheni" to
 * anything that copies the text and "g then i" only to an accessibility
 * tree, which inserts its own boundaries. The text is the contract.
 */
function KeyList({ keys }: { keys: string[] }) {
  return (
    <>
      {keys.map((key, index) => (
        <span key={key}>
          {index > 0 ? ' or ' : null}
          {key.split(' ').map((part, partIndex) => (
            <span key={part}>
              {partIndex > 0 ? ' then ' : null}
              <KeyCap>{part}</KeyCap>
            </span>
          ))}
        </span>
      ))}
    </>
  );
}

export function ShortcutLegend({
  open,
  onOpenChange,
  gates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The very expressions that mount the bindings, from ./consoleShortcuts. */
  gates: ConsoleGates;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <div className="border-b border-gray-200 px-4 py-3">
          <DialogTitle className="text-sm font-semibold text-black">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-gray-500">
            Every key on this console. Dimmed entries are not available in the current state.
          </DialogDescription>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          {CONSOLE_GROUPS.map((group) => {
            // Single keys first, then the chords that belong to this
            // section — so `g i` sits with j and k, and `g v` with the
            // keys that work anywhere, rather than in a chord annex that
            // nobody would think to read. Both lists come from the same
            // declaration module, in its order.
            const entries: ShortcutEntry[] = [
              ...CONSOLE_KEYS.filter((key) => key.group === group.id).map((key) => ({
                keys: [...(key.display ?? key.keys)],
                label: key.label,
                gate: key.gate,
              })),
              ...CONSOLE_CHORDS.filter((chord) => chord.group === group.id).map((chord) => ({
                keys: [chord.keys],
                label: chord.label,
                gate: chord.gate,
              })),
            ];
            if (entries.length === 0) return null;
            return (
              <div key={group.id} className="mb-3 last:mb-0">
                <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-500">{group.title}</h3>
                <ul className="space-y-1.5">
                  {entries.map((entry) => {
                    const live = gateIsLive(entry.gate, gates);
                    return (
                      <li
                        key={entry.label}
                        className={cn(
                          'flex items-baseline gap-3 text-[13px]',
                          live ? 'text-gray-700' : 'text-gray-400',
                        )}
                      >
                        <span className="inline-flex shrink-0 items-center">
                          <KeyList keys={entry.keys} />
                          {/* The gap-3 above is what the eye sees; this is
                              what the text says. Whitespace-only, so it adds
                              no flex item and no layout. */}
                          {' '}
                        </span>
                        <span>
                          {entry.label}
                          {/* The dimming is a color, so it is restated in
                              words: an entry that cannot be pressed has to
                              say so rather than look like a rendering bug. */}
                          {live ? null : <span className="sr-only"> (not available right now)</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

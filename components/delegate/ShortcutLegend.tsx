'use client';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/primitives/dialog';
import { KeyCap } from '@/components/ui/KeyCap';
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
 * the surface it documents. `bound` is the way out: the page passes the
 * very expressions that mount each binding, so an entry dims in the same
 * render its key goes dead, and the two cannot disagree.
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
 */
export interface ShortcutGates {
  /** j/k and the g-pairs: there is something on screen to walk. */
  walk: boolean;
  /** Enter/w: there is a row to commit, and it is not what is already watched. */
  commit: boolean;
  /** The pane transport: a run is watched and the room has more than one participant. */
  sweep: boolean;
}

type Gate = keyof ShortcutGates | 'always';

interface ShortcutEntry {
  /**
   * Key labels, as alternatives — unless one contains a space, which makes
   * it a chord and renders as "g then i". Spaces are real, not flex gaps:
   * a screen reader should hear the same words the eye reads.
   */
  keys: string[];
  label: string;
  /** The gate that decides whether this shortcut is bound at all. */
  gate: Gate;
}

interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

/**
 * The console's shortcut vocabulary, in one list. Order is the order a
 * facilitator meets them: walk the room, commit one row, sweep the watched
 * room, then the keys that are not about the room at all.
 */
const LEGEND: ShortcutGroup[] = [
  {
    title: 'Walk the room',
    entries: [
      { keys: ['j'], label: 'Walk down one row, wrapping at the ends', gate: 'walk' },
      { keys: ['k'], label: 'Walk up one row, wrapping at the ends', gate: 'walk' },
      { keys: ['g i'], label: 'Jump to the first visible row', gate: 'walk' },
      { keys: ['g n'], label: 'Jump to the last visible row', gate: 'walk' },
    ],
  },
  {
    title: 'Watch a run',
    entries: [
      {
        keys: ['Enter', 'w'],
        label: 'Open the watch pane on the row the walk stopped on',
        gate: 'commit',
      },
      {
        keys: ['←', '→'],
        label: 'Step the watched room back and forward',
        gate: 'sweep',
      },
      { keys: ['Home', 'End'], label: 'Jump the watched room to its ends', gate: 'sweep' },
    ],
  },
  {
    title: 'Anywhere on this page',
    entries: [
      { keys: ['⌘K'], label: 'Open the command palette (Ctrl+K on PC keyboards)', gate: 'always' },
      { keys: ['?'], label: 'Open this sheet', gate: 'always' },
      { keys: ['Esc'], label: 'Close this sheet', gate: 'always' },
    ],
  },
];

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
  bound,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bound: ShortcutGates;
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
          {LEGEND.map((group) => (
            <div key={group.title} className="mb-3 last:mb-0">
              <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-500">{group.title}</h3>
              <ul className="space-y-1.5">
                {group.entries.map((entry) => {
                  const live = entry.gate === 'always' || bound[entry.gate];
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
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

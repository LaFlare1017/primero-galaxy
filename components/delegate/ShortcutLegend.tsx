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
 * The chained keys are NOT written here: they arrive as `chords` from the
 * surface that binds them. A sheet that retyped them would be a second
 * source of truth for the same keyboard, which is the drift this whole
 * component is an attempt to avoid.
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
 */
export interface ShortcutGates {
  /** j/k and the jump chords: there is something on screen to walk. */
  walk: boolean;
  /** Enter/w and the watch chord: there is a row to commit, and it is not what is already watched. */
  commit: boolean;
  /** The pane transport: a run is watched and the room has more than one participant. */
  sweep: boolean;
  /** The copy-link chord: the cursor has landed on a row with a run to share. */
  link: boolean;
  /** The pane is open, so Escape has a watch pane to close. */
  pane: boolean;
  /** The views panel is open, so Escape has a panel to close. */
  views: boolean;
}

/** Whether a shortcut is bound right now, or never gated at all. */
export type ShortcutGate = keyof ShortcutGates | 'always';

/** The sections of the sheet, in the order a facilitator meets them. */
export type ShortcutGroupId = 'walk' | 'watch' | 'row' | 'anywhere';

/**
 * One destination of a chained shortcut, passed in by the surface that
 * owns the bindings. The sheet documents every chord, including the ones
 * that are dead right now, so the descriptor has to come from the same
 * list the hook dispatches from rather than being retyped here — a legend
 * that lists chords the page cannot perform is the exact failure this
 * component exists to prevent.
 */
export interface ShortcutChord {
  /** The full chord, space separated: "g i". */
  keys: string;
  label: string;
  /** Which section this belongs to. Typed, so a chord cannot name a section that does not exist. */
  group: ShortcutGroupId;
  gate: ShortcutGate;
}

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

interface ShortcutGroup {
  id: ShortcutGroupId;
  title: string;
  entries: ShortcutEntry[];
}

/**
 * The console's SINGLE-KEY vocabulary, in one list. The chained ones are
 * NOT here: they are passed in, because the surface that binds them is the
 * only place that knows what they do.
 */
const LEGEND: ShortcutGroup[] = [
  {
    id: 'walk',
    title: 'Walk the room',
    entries: [
      { keys: ['j'], label: 'Walk down one row, wrapping at the ends', gate: 'walk' },
      { keys: ['k'], label: 'Walk up one row, wrapping at the ends', gate: 'walk' },
    ],
  },
  {
    id: 'watch',
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
      { keys: ['Esc'], label: 'Close the watch pane', gate: 'pane' },
    ],
  },
  {
    id: 'row',
    title: 'The cursor row',
    entries: [],
  },
  {
    id: 'anywhere',
    title: 'Anywhere on this page',
    entries: [
      { keys: ['⌘K'], label: 'Open the command palette (Ctrl+K on PC keyboards)', gate: 'always' },
      { keys: ['?'], label: 'Open this sheet', gate: 'always' },
      { keys: ['Esc'], label: 'Close this sheet', gate: 'always' },
      { keys: ['Esc'], label: 'Close the views panel', gate: 'views' },
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
  chords,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bound: ShortcutGates;
  /** The surface's chained shortcuts, merged into the section each one belongs to. */
  chords: ShortcutChord[];
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
          {LEGEND.map((group) => {
            // Single keys first, then the chords that belong to this
            // section — so `g i` sits with j and k, and `g v` with the
            // keys that work anywhere, rather than in a chord annex that
            // nobody would think to read.
            const entries: ShortcutEntry[] = [
              ...group.entries,
              ...chords
                .filter((chord) => chord.group === group.id)
                .map((chord) => ({ keys: [chord.keys], label: chord.label, gate: chord.gate })),
            ];
            if (entries.length === 0) return null;
            return (
              <div key={group.id} className="mb-3 last:mb-0">
                <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-500">{group.title}</h3>
                <ul className="space-y-1.5">
                  {entries.map((entry) => {
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
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

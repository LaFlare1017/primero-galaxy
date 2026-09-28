'use client';

import {
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronDown,
  Link2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BACK_TO_LIST,
  CONFIRM_NAME,
  SAVED_VIEWS_SURFACE_ROWS,
  layerIsLive,
  liveShortcuts,
  rowIsLive,
  savedViewsGates,
} from '@/components/ui/savedViewsKeys';
import { Input } from '@/components/ui/primitives/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/primitives/popover';
import { cn } from '@/lib/utils';

/**
 * Shared saved-views popover (Circle's Views pattern, adapted): name the
 * current view state, persist it, and re-apply it later. FinBench stores
 * the filter engine's FiltersState and replays it through the nuqs
 * `?filters=` pipeline; Delegate stores the facilitator's status/sort
 * combination and replays it through `?status=`/`?sort=`/`?dir=`. Both
 * applications therefore land in the same shareable URL shape as a
 * hand-built state or a deep link.
 *
 * Views carry an emoji icon (Circle's mock views: 🧊 ⏱️ ⌛ 💬 ⚡ …) and can
 * be renamed/re-iconed after saving — the edit form reuses the save form
 * with the name and icon prefilled and submits through the store's
 * update(); descriptions are derived from live state, so they are left
 * untouched by a rename.
 *
 * The store contract (implemented by components/finbench/saved-views.ts
 * and components/delegate/saved-views.ts): plain localStorage with corrupt
 * rows dropped, a CustomEvent fired on every write for same-tab listeners
 * plus the `storage` event for cross-tab sync.
 */

/** The subset of a view this popover needs, generic over the store. */
export interface SavedViewLike {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

export interface SavedViewsStore<V extends SavedViewLike> {
  list(): V[];
  save(input: { name: string; description?: string; icon?: string }): V;
  /** Applies a rename/re-icon to a stored view. */
  update(id: string, patch: { name?: string; icon?: string }): void;
  remove(id: string): void;
  /** Fires when the store is written (CustomEvent name). */
  changedEvent: string;
  /** Whether the live state is savable right now (e.g. FinBench requires a filter). */
  canSave: boolean;
  /** Whether the live state currently matches this view (active → check + highlight). */
  isActive(view: V): boolean;
  /** Apply the view's stored state (replays through the surface's URL pipeline). */
  apply(view: V): void;
  /** One-line summary of the state being saved, shown in the save form. */
  describeCurrent(): string;
  /**
   * Builds the shareable URL for a view, when the surface supports it
   * (e.g. the facilitator console encodes ?status/?sort/?dir). When
   * present, each row gains a Share button that copies the link without
   * closing the popover.
   */
  shareUrl?(view: V): string;
}

/** Emoji chip palette for the icon picker, from Circle's mock views. */
const VIEW_ICONS = [
  '🔖', '🧊', '⏱️', '⌛', '💬', '⚡', '🧪', '🐞', '🔄', '🫥', '📝', '🔐', '🏆', '🗂️',
] as const;

interface SavedViewsPopoverProps<V extends SavedViewLike> {
  store: SavedViewsStore<V>;
  /** Header label in list mode (e.g. a FinBench track name); falls back to the view count. */
  heading?: string;
  /** Monochrome chrome for Delegate (weight/border, never color accents). */
  tone?: 'default' | 'mono';
  /**
   * Controlled open state, for a surface that opens the panel from
   * something other than its own trigger — the console's `g v` chord. Leave
   * it undefined and the popover owns the state exactly as before, which
   * is how FinBench still uses it.
   */
  open?: boolean;
  /** Notified of every open/close, including the ones the trigger makes. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Bookmark-style trigger + list/save popover. Focus walks: Save current →
 * rows (apply) → row share → row edit → row delete. When the store supplies
 * shareUrl, each row gains a Share button that copies a link to the view.
 * Keyboard is the reliable
 * interaction model for portaled fixed-position popover content (see e2e
 * conventions); pointer clicks work for in-flow elements like the trigger.
 */
export function SavedViewsPopover<V extends SavedViewLike>({
  store,
  heading,
  tone = 'default',
  open: openProp,
  onOpenChange,
}: SavedViewsPopoverProps<V>) {
  const [views, setViews] = useState<V[]>([]);
  // Controlled only when a surface passes `open`; otherwise the popover
  // owns it, which is the behaviour every existing caller expects.
  const [openFallback, setOpenFallback] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openFallback;
  const setOpen = useCallback(
    (value: boolean) => {
      if (!controlled) setOpenFallback(value);
      onOpenChange?.(value);
    },
    [controlled, onOpenChange],
  );
  const [mode, setMode] = useState<'list' | 'save' | 'edit'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | undefined>(undefined);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [shareFlash, setShareFlash] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The two conditions the panel's keyboard turns on, from the declaration:
  // whether the panel is showing, and whether a form is showing on top of it.
  const gates = savedViewsGates({ open, mode });

  const refresh = useCallback(() => setViews(store.list()), [store]);

  // Load after mount (localStorage is client-only) and follow writes from
  // this tab (custom event) and other tabs (storage event).
  useEffect(() => {
    refresh();
    window.addEventListener(store.changedEvent, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(store.changedEvent, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh, store]);

  const openSaveForm = useCallback(() => {
    setMode('save');
    setEditingId(null);
    setName('');
    setIcon(undefined);
  }, []);

  const openEditForm = useCallback((view: SavedViewLike) => {
    setMode('edit');
    setEditingId(view.id);
    setName(view.name);
    setIcon(view.icon);
  }, []);

  // Autofocus the name field whenever the form mounts (post-commit, so the
  // ref is guaranteed to be attached — a rAF fired before the React commit
  // here and silently no-oped; Input must be forwardRef for this).
  useEffect(() => {
    if (mode !== 'list') nameRef.current?.focus();
  }, [mode]);

  const flash = useCallback((id: string) => {
    setSavedFlash(id);
    window.setTimeout(() => setSavedFlash(null), 1500);
  }, []);

  /** Copies the view's link and briefly flips the Share button to "Copied". */
  const share = useCallback(
    (view: V) => {
      if (!store.shareUrl) return;
      void navigator.clipboard.writeText(store.shareUrl(view)).then(() => {
        setShareFlash(view.id);
        window.setTimeout(() => setShareFlash(null), 1500);
      });
    },
    [store],
  );

  const confirmSave = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const view = store.save({ name: trimmed, icon });
    setMode('list');
    setEditingId(null);
    flash(view.id);
  }, [name, icon, store, flash]);

  const confirmEdit = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || editingId === null) return;
    store.update(editingId, { name: trimmed, icon });
    setMode('list');
    setEditingId(null);
    flash(editingId);
  }, [name, icon, editingId, store, flash]);

  const mono = tone === 'mono';
  const activeClasses = mono ? 'bg-black text-white' : 'bg-accent';
  const flashClasses = mono ? 'text-gray-500' : 'text-muted-foreground';
  const headingClasses = mono ? 'text-gray-500' : 'text-muted-foreground';
  const confirm = mode === 'edit' ? confirmEdit : confirmSave;

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setMode('list');
          setEditingId(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Views"
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs',
            mono
              ? 'border-gray-300 bg-white text-gray-600 hover:border-gray-500 hover:text-black'
              : 'border-border bg-transparent text-foreground hover:bg-accent',
          )}
        >
          <Bookmark className="size-3.5" />
          Views
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        updatePositionStrategy="always"
        className={cn('w-80 p-0', mono && 'border-gray-200')}
        // Escape in the form steps back to the list; only the list's Escape is
        // the panel's own dismissal — the layering the declaration states with
        // `close-panel under form`. It has to be decided HERE, on the layer,
        // because Radix dismisses in the CAPTURE phase (components/delegate/
        // shortcuts.ts records the same measurement): a handler on the field
        // would run after the panel had already been dismissed out from under
        // the form, and the field's branch is only reachable if this prevents
        // the default first.
        onEscapeKeyDown={(event) => {
          if (!layerIsLive(BACK_TO_LIST.id, gates)) return;
          event.preventDefault();
          setMode('list');
        }}
      >
        {mode !== 'list' ? (
          <div className="p-3">
            <p className="text-xs font-medium">
              {mode === 'edit' ? 'Edit view' : 'Save current view'}
            </p>
            {mode === 'save' && (
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {store.describeCurrent()}
              </p>
            )}
            <div
              role="group"
              aria-label="View icon"
              className="mt-2 flex flex-wrap gap-0.5"
            >
              {VIEW_ICONS.map((emoji) => {
                const selected = emoji === '🔖' ? icon === undefined : icon === emoji;
                return (
                  <button
                    key={emoji}
                    type="button"
                    aria-pressed={selected}
                    aria-label={emoji === '🔖' ? 'Default icon' : `Icon ${emoji}`}
                    onClick={() => setIcon(emoji === '🔖' ? undefined : emoji)}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors',
                      selected
                        ? mono
                          ? 'bg-gray-200 ring-1 ring-black'
                          : 'bg-accent ring-1 ring-ring'
                        : mono
                          ? 'hover:bg-gray-100'
                          : 'hover:bg-accent/60',
                    )}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
            <Input
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              // The field's own key, read from the declaration rather than
              // spelled again here: Enter confirms, and only while the form is
              // showing — the same gate the attribute below is built from.
              // Escape is deliberately not handled on this input; the panel's
              // layer takes it (see `onEscapeKeyDown`).
              onKeyDown={(event) => {
                if (!CONFIRM_NAME.keys.includes(event.key)) return;
                if (!rowIsLive(CONFIRM_NAME, gates)) return;
                event.preventDefault();
                confirm();
              }}
              placeholder="e.g. Submitted only"
              className="mt-2 h-8 text-[13px]"
              aria-label="View name"
              aria-keyshortcuts={
                liveShortcuts(SAVED_VIEWS_SURFACE_ROWS.name, gates) || undefined
              }
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setMode('list')}
                className={cn(
                  'h-7 rounded-md px-2 text-xs',
                  mono
                    ? 'text-gray-500 hover:text-black'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={name.trim().length === 0}
                onClick={confirm}
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs font-medium disabled:pointer-events-none disabled:opacity-50',
                  mono
                    ? 'bg-black text-white'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                Save view
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className={cn('text-xs font-medium', headingClasses)}>
                {heading ?? `${views.length} saved view${views.length === 1 ? '' : 's'}`}
              </span>
              <button
                type="button"
                disabled={!store.canSave}
                onClick={openSaveForm}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs disabled:pointer-events-none disabled:opacity-50',
                  mono ? 'text-gray-600 hover:text-black' : 'text-foreground hover:bg-accent',
                )}
              >
                <BookmarkPlus className="size-3.5" />
                Save current
              </button>
            </div>
            {views.length === 0 ? (
              <p className={cn('px-3 py-6 text-center text-xs', headingClasses)}>
                {store.canSave
                  ? 'No saved views yet. Save the current view to revisit it later.'
                  : 'No saved views yet. Change the view first, then save it here.'}
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto p-1">
                {views.map((view) => {
                  const active = store.isActive(view);
                  return (
                    <div
                      key={view.id}
                      className={cn(
                        'group flex items-start gap-1.5 rounded-md px-2 py-1.5 transition-colors',
                        active ? activeClasses : mono ? 'hover:bg-gray-100' : 'hover:bg-accent/60',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          store.apply(view);
                          setOpen(false);
                        }}
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        title={view.description}
                      >
                        <span className="mt-0.5 text-sm leading-none">{view.icon ?? '🔖'}</span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-[13px] font-medium">
                            {view.name}
                            {active && <Check className="size-3" />}
                            {savedFlash === view.id && (
                              <span className={cn('text-[10px] font-normal', flashClasses)}>saved</span>
                            )}
                          </span>
                          <span
                            className={cn(
                              'block truncate text-[11px]',
                              mono && active ? 'text-gray-200' : 'text-muted-foreground',
                            )}
                          >
                            {view.description ?? store.describeCurrent()}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Share view ${view.name}`}
                        onClick={() => share(view)}
                        className={cn(
                          'mt-0.5 rounded p-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100',
                          mono ? 'text-gray-500 hover:text-black' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {shareFlash === view.id ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Link2 className="size-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Edit view ${view.name}`}
                        onClick={() => openEditForm(view)}
                        className={cn(
                          'mt-0.5 rounded p-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100',
                          mono ? 'text-gray-500 hover:text-black' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete view ${view.name}`}
                        onClick={() => store.remove(view.id)}
                        className={cn(
                          'mt-0.5 rounded p-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100',
                          mono ? 'text-gray-500 hover:text-black' : 'text-muted-foreground hover:text-destructive',
                        )}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

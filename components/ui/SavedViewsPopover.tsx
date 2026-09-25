'use client';

import { Bookmark, BookmarkPlus, Check, ChevronDown, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
 * The store contract (implemented by components/finbench/saved-views.ts
 * and components/delegate/saved-views.ts): plain localStorage with corrupt
 * rows dropped, a CustomEvent fired on every write for same-tab listeners
 * plus the `storage` event for cross-tab sync, and list/delete operations
 * scoped to a namespace string.
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
}

interface SavedViewsPopoverProps<V extends SavedViewLike> {
  store: SavedViewsStore<V>;
  /** Header label in list mode (e.g. a FinBench track name); falls back to the view count. */
  heading?: string;
  /** Monochrome chrome for Delegate (weight/border, never color accents). */
  tone?: 'default' | 'mono';
}

/**
 * Bookmark-style trigger + list/save popover. Focus walks: Save current →
 * rows (apply) → row delete. Keyboard is the reliable interaction model for
 * portaled fixed-position popover content (see e2e conventions); pointer
 * clicks work for in-flow elements like the trigger.
 */
export function SavedViewsPopover<V extends SavedViewLike>({
  store,
  heading,
  tone = 'default',
}: SavedViewsPopoverProps<V>) {
  const [views, setViews] = useState<V[]>([]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'save'>('list');
  const [name, setName] = useState('');
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

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
    setName('');
  }, []);

  // Autofocus the name field whenever the save form mounts (post-commit, so
  // the ref is guaranteed to be attached — a rAF fired before the React
  // commit here and silently no-oped; Input must be forwardRef for this).
  useEffect(() => {
    if (mode === 'save') nameRef.current?.focus();
  }, [mode]);

  const confirmSave = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const view = store.save({ name: trimmed });
    setMode('list');
    setSavedFlash(view.id);
    window.setTimeout(() => setSavedFlash(null), 1500);
  }, [name, store]);

  const mono = tone === 'mono';
  const activeClasses = mono
    ? 'bg-black text-white'
    : 'bg-accent';
  const flashClasses = mono
    ? 'text-gray-500'
    : 'text-muted-foreground';
  const headingClasses = mono
    ? 'text-gray-500'
    : 'text-muted-foreground';

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setMode('list');
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
          <Bookmark className={cn('size-3.5', mono && 'h-3.5 w-3.5')} />
          Views
          <ChevronDown className={cn('size-3 opacity-60', mono && 'h-3 w-3')} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        updatePositionStrategy="always"
        className={cn('w-80 p-0', mono && 'border-gray-200')}
      >
        {mode === 'save' ? (
          <div className="p-3">
            <p className="text-xs font-medium">Save current view</p>
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
              {store.describeCurrent()}
            </p>
            <Input
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirmSave();
                if (event.key === 'Escape') setMode('list');
              }}
              placeholder="e.g. Submitted only"
              className="mt-2 h-8 text-[13px]"
              aria-label="View name"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setMode('list')}
                className={cn(
                  'h-7 rounded-md px-2 text-xs',
                  mono ? 'text-gray-500 hover:text-black' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={name.trim().length === 0}
                onClick={confirmSave}
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs font-medium disabled:pointer-events-none disabled:opacity-50',
                  mono ? 'bg-black text-white' : 'bg-primary text-primary-foreground hover:bg-primary/90',
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
                  mono
                    ? 'text-gray-600 hover:text-black'
                    : 'text-foreground hover:bg-accent',
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

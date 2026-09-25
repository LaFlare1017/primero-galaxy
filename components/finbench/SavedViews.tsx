'use client';

import { Bookmark, BookmarkPlus, Check, ChevronDown, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteSavedView,
  describeFilters,
  listSavedViews,
  saveView,
  SAVED_VIEWS_CHANGED_EVENT,
  type SavedView,
} from '@/components/finbench/saved-views';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/primitives/popover';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import { cn } from '@/lib/utils';

/**
 * Saved views for the run explorer, adapted from Circle's Views pattern:
 * name the current `?filters=` combination, store it, and re-apply it later
 * from any tab or session. The stored state is the engine-native
 * FiltersState, so applying a view goes through the exact same pipeline as
 * typing filters by hand or opening a deep link.
 */

interface SavedViewsProps {
  track: 'asc606' | 'govcon';
  filters: FiltersState;
  /** Applies a view's filters through the URL (nuqs setFilters). */
  onApply: (filters: FiltersState) => void;
}

/** Bookmark-style trigger that reflects whether a view is active. */
export function SavedViews({ track, filters, onApply }: SavedViewsProps) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'save'>('list');
  const [name, setName] = useState('');
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => setViews(listSavedViews(track)), [track]);


  // Load after mount (localStorage is client-only) and follow writes from
  // this tab (custom event) and other tabs (storage event).
  useEffect(() => {
    refresh();
    window.addEventListener(SAVED_VIEWS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SAVED_VIEWS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  // A view is "active" when its filter list matches the live state exactly.
  const activeId = useMemo(() => {
    const serialized = JSON.stringify(filters);
    return views.find((view) => JSON.stringify(view.filters) === serialized)?.id ?? null;
  }, [views, filters]);

  const openSaveForm = useCallback(() => {
    setMode('save');
    setName('');
  }, []);

  // Autofocus the name field whenever the save form mounts (post-commit,
  // so the ref is guaranteed to be attached — a rAF fired before the
  // React commit here and silently no-oped).
  useEffect(() => {
    if (mode === 'save') nameRef.current?.focus();
  }, [mode]);

  const confirmSave = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const view = saveView({
      name: trimmed,
      description: describeFilters(filters),
      track,
      filters,
    });
    setMode('list');
    setSavedFlash(view.id);
    window.setTimeout(() => setSavedFlash(null), 1500);
  }, [name, filters, track]);

  const apply = useCallback(
    (view: SavedView) => {
      onApply(view.filters);
      setOpen(false);
    },
    [onApply],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setMode('list');
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-7 gap-1.5 text-xs">
          <Bookmark className="size-3.5" />
          Views
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        updatePositionStrategy="always"
        className="w-80 p-0"
      >
        {mode === 'save' ? (
          <div className="p-3">
            <p className="text-xs font-medium">Save current filters as a view</p>
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
              {describeFilters(filters)}
            </p>
            <Input
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirmSave();
                if (event.key === 'Escape') setMode('list');
              }}
              placeholder="e.g. Numeric misses"
              className="mt-2 h-8 text-[13px]"
              aria-label="View name"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMode('list')}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={name.trim().length === 0}
                onClick={confirmSave}
              >
                Save view
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {track === 'asc606' ? 'ASC 606' : 'Govcon'} views
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-xs"
                disabled={filters.length === 0}
                onClick={openSaveForm}
              >
                <BookmarkPlus className="size-3.5" />
                Save current
              </Button>
            </div>
            {views.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No saved views yet. Filter the runs, then save the combination here.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto p-1">
                {views.map((view) => (
                  <div
                    key={view.id}
                    className={cn(
                      'group flex items-start gap-1.5 rounded-md px-2 py-1.5 transition-colors',
                      activeId === view.id ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => apply(view)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      title={view.description}
                    >
                      <span className="mt-0.5 text-sm leading-none">{view.icon ?? '🔖'}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[13px] font-medium">
                          {view.name}
                          {activeId === view.id && <Check className="size-3 text-trajectory" />}
                          {savedFlash === view.id && (
                            <span className="text-[10px] font-normal text-muted-foreground">saved</span>
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {view.description ?? describeFilters(view.filters)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete view ${view.name}`}
                      onClick={() => deleteSavedView(view.id)}
                      className="mt-0.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

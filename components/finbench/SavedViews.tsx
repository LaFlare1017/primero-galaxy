'use client';

import { useMemo } from 'react';

import type { FiltersState } from '@/components/data-table-filter/core/types';
import {
  deleteSavedView,
  describeFilters,
  listSavedViews,
  saveView,
  updateSavedView,
  SAVED_VIEWS_CHANGED_EVENT,
  type SavedView,
} from '@/components/finbench/saved-views';
import {
  SavedViewsPopover,
  type SavedViewsStore,
} from '@/components/ui/SavedViewsPopover';

/**
 * Saved views for the run explorer, adapted from Circle's Views pattern:
 * name the current `?filters=` combination, store it, and re-apply it later
 * from any tab or session. The stored state is the engine-native
 * FiltersState, so applying a view goes through the exact same pipeline as
 * typing filters by hand or opening a deep link. UI is the shared
 * SavedViewsPopover; this adapter supplies the FinBench store contract.
 */
export function SavedViews({
  track,
  filters,
  onApply,
}: {
  track: 'asc606' | 'govcon';
  filters: FiltersState;
  /** Applies a view's filters through the URL (nuqs setFilters). */
  onApply: (filters: FiltersState) => void;
}) {
  const store = useMemo<SavedViewsStore<SavedView>>(
    () => ({
      list: () => listSavedViews(track),
      save: ({ name, description }) =>
        saveView({
          name,
          description: description ?? describeFilters(filters),
          track,
          filters,
        }),
      remove: deleteSavedView,
      update: updateSavedView,
      changedEvent: SAVED_VIEWS_CHANGED_EVENT,
      // FinBench's default state (no filters) is not a view worth naming;
      // require at least one filter, like Circle's views require a filter.
      canSave: filters.length > 0,
      isActive: (view) => JSON.stringify(view.filters) === JSON.stringify(filters),
      apply: (view) => onApply(view.filters),
      describeCurrent: () => describeFilters(filters),
    }),
    [track, filters, onApply],
  );

  return <SavedViewsPopover store={store} heading={track === 'asc606' ? 'ASC 606 views' : 'Govcon views'} />;
}

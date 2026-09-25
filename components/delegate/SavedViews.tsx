'use client';

import { useMemo } from 'react';

import {
  deleteFacilitatorView,
  describeFacilitatorState,
  FACILITATOR_VIEWS_CHANGED_EVENT,
  listFacilitatorViews,
  saveFacilitatorView,
  type FacilitatorSavedView,
  type FacilitatorViewState,
} from '@/components/delegate/saved-views';
import {
  SavedViewsPopover,
  type SavedViewsStore,
} from '@/components/ui/SavedViewsPopover';

/**
 * Saved views for the facilitator console: name the current status/sort
 * combination and re-apply it later through the same
 * `?status=`/`?sort=`/`?dir=` pipeline as a hand-built state or deep link.
 * Monochrome tone — Delegate keeps color for meaning, so the popover uses
 * weight and border instead of accent fills.
 */
export function FacilitatorSavedViews({
  viewState,
  onApply,
}: {
  viewState: FacilitatorViewState;
  /** Applies a view through the URL (nuqs setStatuses/setSortKey/setSortDir). */
  onApply: (view: FacilitatorViewState) => void;
}) {
  const store = useMemo<SavedViewsStore<FacilitatorSavedView>>(
    () => ({
      list: listFacilitatorViews,
      save: ({ name, description }) =>
        saveFacilitatorView({
          name,
          description: description ?? describeFacilitatorState(viewState),
          view: viewState,
        }),
      remove: deleteFacilitatorView,
      changedEvent: FACILITATOR_VIEWS_CHANGED_EVENT,
      // Unlike FinBench, the default state IS savable: a named "Full room"
      // view is a real escape hatch for a facilitator resuming a session.
      canSave: true,
      isActive: (view) => sameViewState(view.view, viewState),
      apply: (view) => onApply(view.view),
      describeCurrent: () => describeFacilitatorState(viewState),
    }),
    [viewState, onApply],
  );

  return <SavedViewsPopover store={store} tone="mono" />;
}

/** Null-aware state equality: null means "param absent" for each part. */
function sameViewState(a: FacilitatorViewState, b: FacilitatorViewState): boolean {
  if (!sameStatus(a.status, b.status)) return false;
  return a.sort === b.sort && a.dir === b.dir;
}

function sameStatus(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

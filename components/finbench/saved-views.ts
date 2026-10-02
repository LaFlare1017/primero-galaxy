'use client';

import type { FiltersState } from '@/components/data-table-filter/core/types';

/**
 * Saved views for the FinBench run explorer (adapted from Circle's views
 * pattern, mock-data/views.ts + the Views page): a named, persisted
 * FiltersState that replays through the same nuqs `?filters=` pipeline as
 * a hand-built or deep-linked filter combination.
 *
 * Circle persists view display prefs with zustand/persist; this repo's own
 * convention (galaxy user stars) is a typed localStorage module with a
 * mount-time load and cross-tab events, so that is what is used here.
 * Storage lives under the galaxy-namespaced key prefix.
 *
 * XSS posture: view data never renders as HTML — every surface goes
 * through React text interpolation — so names/icons stay plain strings.
 */

export interface SavedView {
  /** Stable uuid (crypto.randomUUID with a fallback for older engines). */
  id: string;
  name: string;
  /** One-line description the saver can attach; defaults to a filter summary. */
  description?: string;
  /** Emoji chip rendered in the list (Circle's views carry one too). */
  icon?: string;
  /** Benchmark track this view belongs to; views never cross tracks. */
  track: 'asc606' | 'govcon';
  /** The engine-native filter state — exactly what `?filters=` carries. */
  filters: FiltersState;
  createdAt: string;
  updatedAt: string;
}

const KEY = 'primero-galaxy:finbench:saved-views';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFilterModel = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.columnId === 'string' &&
  typeof value.type === 'string' &&
  typeof value.operator === 'string' &&
  Array.isArray(value.values);

const isSavedView = (value: unknown): value is SavedView =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  (value.track === 'asc606' || value.track === 'govcon') &&
  Array.isArray(value.filters) &&
  value.filters.every(isFilterModel) &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string';

function readStore(): SavedView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Corrupt/hand-edited rows are dropped, never thrown.
    return parsed.filter(isSavedView);
  } catch {
    return [];
  }
}

function writeStore(views: SavedView[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(views));
  // Same-tab listeners (the browser panel, multiple tabs on one machine):
  // the storage event only fires cross-tab.
  window.dispatchEvent(new CustomEvent(SAVED_VIEWS_CHANGED_EVENT));
}

/** Fired (same-tab) whenever the store is written; mirrors storage events. */
export const SAVED_VIEWS_CHANGED_EVENT = 'finbench:saved-views-changed';

export function listSavedViews(track: 'asc606' | 'govcon'): SavedView[] {
  return readStore()
    .filter((view) => view.track === track)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function saveView(input: {
  name: string;
  description?: string;
  icon?: string;
  track: 'asc606' | 'govcon';
  filters: FiltersState;
}): SavedView {
  const views = readStore();
  const now = new Date().toISOString();
  const view: SavedView = {
    id: makeId(),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    icon: input.icon || undefined,
    track: input.track,
    filters: input.filters,
    createdAt: now,
    updatedAt: now,
  };
  writeStore([view, ...views]);
  return view;
}

/** Re-saving under the same id updates it (name/description/icon/filters). */
export function updateSavedView(
  id: string,
  patch: Partial<Pick<SavedView, 'name' | 'description' | 'icon' | 'filters'>>,
): void {
  const views = readStore();
  const index = views.findIndex((view) => view.id === id);
  if (index === -1) return;
  views[index] = { ...views[index], ...patch, updatedAt: new Date().toISOString() };
  writeStore(views);
}

export function deleteSavedView(id: string): void {
  writeStore(readStore().filter((view) => view.id !== id));
}

/** One-line human summary of a FiltersState, for chips and descriptions. */
export function describeFilters(filters: FiltersState): string {
  if (filters.length === 0) return 'All runs';
  return filters
    .map((filter) => {
      const values = filter.values.map((value) => String(value)).join(', ');
      return `${filter.columnId} ${filter.operator} ${values}`;
    })
    .join(' · ');
}

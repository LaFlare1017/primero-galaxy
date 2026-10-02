'use client';

/**
 * Saved views for the Delegate facilitator console: a named, persisted
 * snapshot of the shareable view state — selected status facets plus the
 * sort key/direction — that replays through the same
 * `?status=`/`?sort=`/`?dir=` pipeline as a hand-built state or deep link.
 *
 * Mirrors components/finbench/saved-views.ts (plain localStorage with
 * corrupt rows dropped, a write CustomEvent for same-tab listeners, and
 * cross-tab sync via the storage event) under its own storage key. XSS
 * posture: view data never renders as HTML, only React text interpolation.
 */

export interface FacilitatorViewState {
  /** Selected status facets, sorted; `null` = no ?status= param (unfiltered). */
  status: string[] | null;
  /** nuqs-cleared defaults are stored as null so views replay exactly. */
  sort: string | null;
  dir: string | null;
}

export interface FacilitatorSavedView {
  id: string;
  name: string;
  /** One-line description the saver can attach; defaults to a state summary. */
  description?: string;
  /** Emoji chip rendered in the list. */
  icon?: string;
  view: FacilitatorViewState;
  createdAt: string;
  updatedAt: string;
}

const KEY = 'primero-galaxy:delegate:facilitator:saved-views';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFacilitatorViewState = (value: unknown): value is FacilitatorViewState =>
  isRecord(value) &&
  (value.status === null ||
    (Array.isArray(value.status) && value.status.every((s) => typeof s === 'string'))) &&
  (value.sort === null || typeof value.sort === 'string') &&
  (value.dir === null || typeof value.dir === 'string');

const isSavedView = (value: unknown): value is FacilitatorSavedView =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  (value.icon === undefined || typeof value.icon === 'string') &&
  isFacilitatorViewState(value.view) &&
  typeof value.createdAt === 'string' &&
  typeof value.updatedAt === 'string';

function readStore(): FacilitatorSavedView[] {
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

function writeStore(views: FacilitatorSavedView[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(views));
  // Same-tab listeners: the storage event only fires cross-tab.
  window.dispatchEvent(new CustomEvent(FACILITATOR_VIEWS_CHANGED_EVENT));
}

/** Fired (same-tab) whenever the store is written; mirrors storage events. */
export const FACILITATOR_VIEWS_CHANGED_EVENT = 'delegate:facilitator:saved-views-changed';

export function listFacilitatorViews(): FacilitatorSavedView[] {
  return readStore().sort((a, b) => a.name.localeCompare(b.name));
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function saveFacilitatorView(input: {
  name: string;
  description?: string;
  icon?: string;
  view: FacilitatorViewState;
}): FacilitatorSavedView {
  const views = readStore();
  const now = new Date().toISOString();
  const view: FacilitatorSavedView = {
    id: makeId(),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    icon: input.icon || undefined,
    view: input.view,
    createdAt: now,
    updatedAt: now,
  };
  writeStore([view, ...views]);
  return view;
}

/** Re-saving under the same id updates it (name/description/icon/view). */
export function updateFacilitatorView(
  id: string,
  patch: Partial<Pick<FacilitatorSavedView, 'name' | 'description' | 'icon' | 'view'>>,
): void {
  const views = readStore();
  const index = views.findIndex((view) => view.id === id);
  if (index === -1) return;
  views[index] = { ...views[index], ...patch, updatedAt: new Date().toISOString() };
  writeStore(views);
}

export function deleteFacilitatorView(id: string): void {
  writeStore(readStore().filter((view) => view.id !== id));
}

/** One-line human summary of a facilitator view state, for the save form. */
export function describeFacilitatorState(state: FacilitatorViewState): string {
  const parts: string[] = [];
  if (state.status === null) {
    parts.push('all statuses');
  } else if (state.status.length === 0) {
    parts.push('no statuses selected');
  } else {
    parts.push(`status: ${state.status.join(', ')}`);
  }
  if (state.sort !== null) {
    parts.push(state.dir === 'desc' ? `${state.sort} desc` : state.sort);
  }
  return parts.join(' · ');
}

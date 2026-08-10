import { create } from 'zustand';
import { Company, GalaxyMode, Position3D } from '@/types';

// ---------------------------------------------------------------------------
// User-added stars: persisted to localStorage so they survive reloads.
// Hydration is deferred to the client (post-mount) to keep SSR HTML stable.
// ---------------------------------------------------------------------------

const USER_STARS_KEY = 'primero-galaxy:user-stars';
// Pending toasts live in sessionStorage: they survive a refresh (so Undo and
// the "See trajectory" prompt keep working after an accidental reload) but
// die with the tab, matching the short toast window.
const PENDING_TOASTS_KEY = 'primero-galaxy:pending-toasts';

/** How long a toast stays actionable before auto-dismissing (ms).
 * 12s gives a user time to actually reach the "See trajectory" / Undo
 * actions after a camera flight — and keeps the e2e assertions clear of the
 * auto-dismiss race on slow/loaded machines. */
export const TOAST_DURATION_MS = 12000;

export function loadUserStars(): Company[] {
  try {
    const raw = window.localStorage.getItem(USER_STARS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Company[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistUserStars(stars: Company[]): void {
  try {
    window.localStorage.setItem(USER_STARS_KEY, JSON.stringify(stars));
  } catch {
    // Storage full / unavailable — the in-memory star still works this session.
  }
}

export function loadPendingToasts(): GalaxyToast[] {
  try {
    const raw = window.sessionStorage.getItem(PENDING_TOASTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GalaxyToast[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistPendingToasts(toasts: GalaxyToast[]): void {
  try {
    window.sessionStorage.setItem(PENDING_TOASTS_KEY, JSON.stringify(toasts));
  } catch {
    // Storage unavailable — the in-memory toast still works this session.
  }
}

/** A transient notification in the toast stack (bottom-center). */
export interface GalaxyToast {
  id: string;
  kind: 'added' | 'removed';
  star: Company;
  /** For `removed` toasts: whether it was deleted from planet view (undo restores that view). */
  wasSelected?: boolean;
  /** Epoch ms when the toast was created — hydration uses it to compute the remaining window. */
  createdAt: number;
}

function makeToastId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Keep at most one toast per (kind, company): removing or re-adding the same
 * company twice inside the toast window supersedes the older toast instead of
 * stacking two identical ones (the newest always carries the current state).
 */
function upsertToast(toasts: GalaxyToast[], toast: GalaxyToast): GalaxyToast[] {
  const key = (t: GalaxyToast) => `${t.kind}:${t.star.slug}`;
  return [...toasts.filter((t) => key(t) !== key(toast)), toast];
}

interface GalaxyState {
  mode: GalaxyMode;
  selectedStar: Company | null;
  hoveredStar: Company | null;
  cameraTarget: Position3D | null;
  zoomLevel: number; // camera distance to focus point
  showTrajectory: boolean;
  userStars: Company[]; // added via "Add Your Company"
  /** Notification stack — each toast carries its own data (incl. Undo). */
  toasts: GalaxyToast[];

  setMode: (mode: GalaxyMode) => void;
  selectStar: (star: Company | null) => void;
  hoverStar: (star: Company | null) => void;
  setCameraTarget: (target: Position3D | null) => void;
  setZoomLevel: (level: number) => void;
  setShowTrajectory: (show: boolean) => void;
  clearSelection: () => void;
  hydrateUserStars: () => void;
  hydratePendingToasts: () => void;
  addUserStar: (star: Company) => void;
  removeUserStar: (id: string) => void;
  dismissToast: (id: string) => void;
  undoToast: (id: string) => void;
}

export const useGalaxyStore = create<GalaxyState>((set) => ({
  mode: 'galaxy',
  selectedStar: null,
  hoveredStar: null,
  cameraTarget: null,
  zoomLevel: 800,
  showTrajectory: false,
  userStars: [],
  toasts: [],

  setMode: (mode) => set({ mode }),
  selectStar: (star) =>
    set({
      selectedStar: star,
      mode: star ? 'planet' : 'galaxy',
      cameraTarget: star
        ? { x: star.position.x, y: star.position.y, z: star.position.z }
        : null,
      showTrajectory: false,
    }),
  hoverStar: (star) => set({ hoveredStar: star }),
  setCameraTarget: (target) => set({ cameraTarget: target }),
  setZoomLevel: (level) => set({ zoomLevel: level }),
  setShowTrajectory: (show) => set({ showTrajectory: show }),
  clearSelection: () =>
    set({
      selectedStar: null,
      mode: 'galaxy',
      cameraTarget: null,
      showTrajectory: false,
    }),

  hydrateUserStars: () => {
    const stars = loadUserStars();
    if (stars.length > 0) set({ userStars: stars });
  },
  hydratePendingToasts: () => {
    const loaded = loadPendingToasts();
    const now = Date.now();
    // Only keep toasts still inside their window — one that expired while the
    // tab was closed or a reload was in flight gets no fresh 8 seconds.
    const toasts = loaded.filter(
      (t) => typeof t.createdAt === 'number' && now - t.createdAt < TOAST_DURATION_MS
    );
    if (toasts.length !== loaded.length) {
      // Drop stale entries from storage so they can't resurrect later.
      persistPendingToasts(toasts);
    }
    if (toasts.length > 0) set({ toasts });
  },
  addUserStar: (star) =>
    set((state) => {
      // No duplicate companies: the same slug (case/whitespace-insensitive
      // name) is already a star — the form rejects it up front, and this
      // guard covers any other caller.
      if (state.userStars.some((s) => s.slug === star.slug)) return state;
      const userStars = [...state.userStars, star];
      persistUserStars(userStars);
      // Persist the "added" toast too, so the "See trajectory" prompt
      // survives a refresh right after adding. A re-add of the same company
      // supersedes the previous toast for it.
      const toasts = upsertToast(state.toasts, {
        id: makeToastId(),
        kind: 'added',
        star,
        createdAt: Date.now(),
      });
      persistPendingToasts(toasts);
      return { userStars, toasts };
    }),
  removeUserStar: (id) =>
    set((state) => {
      const star = state.userStars.find((s) => s.id === id) ?? null;
      const userStars = state.userStars.filter((s) => s.id !== id);
      persistUserStars(userStars);
      // Keep the removed star in the toast stack so the UI can offer Undo.
      // `wasSelected` remembers it was deleted from planet view, so Undo can
      // fly the camera back and reopen the panel.
      const wasSelected = state.selectedStar?.id === id;
      const toasts = star
        ? upsertToast(state.toasts, {
            id: makeToastId(),
            kind: 'removed',
            star,
            wasSelected,
            createdAt: Date.now(),
          })
        : state.toasts;
      // If the star being removed is the one on screen, reset the view too
      // (deleting from the Add sheet while a planet panel is open behind it).
      persistPendingToasts(toasts);
      return {
        userStars,
        toasts,
        ...(wasSelected
          ? {
              selectedStar: null,
              mode: 'galaxy' as const,
              cameraTarget: null,
              showTrajectory: false,
            }
          : {}),
      };
    }),
  dismissToast: (id) =>
    set((state) => {
      const toasts = state.toasts.filter((t) => t.id !== id);
      persistPendingToasts(toasts);
      return { toasts };
    }),
  undoToast: (id) =>
    set((state) => {
      const toast = state.toasts.find((t) => t.id === id);
      const rest = state.toasts.filter((t) => t.id !== id);
      if (!toast || toast.kind !== 'removed') return { toasts: rest };
      const userStars = [...state.userStars, toast.star];
      persistUserStars(userStars);
      // If the star was deleted from planet view, restore that view: reopen
      // the panel and fly the camera back to the star.
      const restoreView = toast.wasSelected
        ? {
            selectedStar: toast.star,
            mode: 'planet' as const,
            cameraTarget: {
              x: toast.star.position.x,
              y: toast.star.position.y,
              z: toast.star.position.z,
            },
            showTrajectory: false,
          }
        : {};
      persistPendingToasts(rest);
      return {
        userStars,
        toasts: rest,
        ...restoreView,
      };
    }),
}));

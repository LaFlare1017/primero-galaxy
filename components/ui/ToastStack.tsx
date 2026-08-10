'use client';
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGalaxyStore, TOAST_DURATION_MS } from '@/store/galaxyStore';
import { maturityColor } from '@/lib/constants';

/**
 * One notification area for both kinds of feedback: "added" (post-add
 * prompt with See trajectory) and "removed" (with Undo). Toasts live in the
 * store queue, so several can be visible at once: the stack is anchored to
 * the bottom bar and newer toasts appear below older ones, pushing them up.
 * Each toast auto-dismisses after its own window (its timer is keyed by id);
 * a toast hydrated from a refresh keeps only the time it had left at creation.
 */
export function ToastStack() {
  const toasts = useGalaxyStore((s) => s.toasts);
  const dismissToast = useGalaxyStore((s) => s.dismissToast);
  const undoToast = useGalaxyStore((s) => s.undoToast);
  const setShowTrajectory = useGalaxyStore((s) => s.setShowTrajectory);

  // One timer per toast; timers for dismissed toasts are cleaned up. A toast
  // that survived a refresh keeps only its remaining window (its createdAt is
  // persisted), floored so it doesn't race the first render.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    Object.entries(timers.current).forEach(([id, timer]) => {
      if (!live.has(id)) {
        clearTimeout(timer);
        delete timers.current[id];
      }
    });
    toasts.forEach((t) => {
      if (!timers.current[t.id]) {
        const remaining = Math.max(t.createdAt + TOAST_DURATION_MS - Date.now(), 250);
        timers.current[t.id] = setTimeout(() => {
          delete timers.current[t.id];
          dismissToast(t.id);
        }, remaining);
      }
    });
  }, [toasts, dismissToast]);

  // Clear any pending timers on unmount.
  useEffect(() => {
    const current = timers.current;
    return () => Object.values(current).forEach(clearTimeout);
  }, []);

  return (
    <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="glass flex items-center gap-4 rounded-xl px-5 py-3"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: maturityColor(toast.star.maturity.overall) }}
            />
            <div>
              <div className="text-sm font-medium text-star-bright">
                {toast.kind === 'added'
                  ? 'Your company is here.'
                  : 'Removed from the galaxy.'}
              </div>
              <div className="text-[11px] text-ui-muted">
                {toast.kind === 'added'
                  ? `${toast.star.name} is now a star in the galaxy.`
                  : `${toast.star.name} is no longer a star.`}
              </div>
            </div>
            {toast.kind === 'added' ? (
              <button
                onClick={() => {
                  setShowTrajectory(true);
                  dismissToast(toast.id);
                }}
                className="shrink-0 rounded-md border border-trajectory/50 px-3 py-1.5 text-[11px] font-semibold text-trajectory transition-colors hover:bg-trajectory/10"
              >
                See trajectory →
              </button>
            ) : (
              <button
                onClick={() => undoToast(toast.id)}
                className="shrink-0 rounded-md border border-star-dim/50 px-3 py-1.5 text-[11px] font-semibold text-star-bright transition-colors hover:bg-star-dim/20"
              >
                Undo
              </button>
            )}
            <button
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 text-xs text-ui-muted transition-colors hover:text-star-bright"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

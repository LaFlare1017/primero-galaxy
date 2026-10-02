"use client";

import { useEffect, useState } from "react";

/**
 * Elapsed-seconds clock for a workshop run: ticks once a second while the
 * run is live, and freezes the moment `submittedAt` lands, so a finished
 * run stops counting instead of drifting forever. Pass `startedAt` as
 * epoch ms (null until the run has been fetched) and `submittedAt` as the
 * ISO timestamp from the run (null while it is still working).
 *
 * Shared by the facilitator watch pane and the participant restore
 * preview: both show the same clock, so both must freeze at the same
 * instant, and a single implementation is what guarantees it. Callers keep
 * their own mm/ss formatting.
 */
export function useElapsedClock(startedAt: number | null, submittedAt: string | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const compute = () =>
      setElapsed(
        Math.max(
          0,
          Math.round(((submittedAt ? new Date(submittedAt).getTime() : Date.now()) - startedAt) / 1000),
        ),
      );
    compute();
    // Submitted runs are finished: compute once, never start a ticker.
    if (submittedAt) return;
    const t = setInterval(compute, 1000);
    return () => clearInterval(t);
  }, [startedAt, submittedAt]);
  return elapsed;
}

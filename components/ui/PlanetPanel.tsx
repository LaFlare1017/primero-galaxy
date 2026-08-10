'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGalaxyStore } from '@/store/galaxyStore';
import { DIMENSIONS, maturityColor, maturityLabel } from '@/lib/constants';
import { formatCompact, formatRevenue } from '@/lib/utils';
import { COMPANY_COUNT, SECTOR_MEDIAN } from '@/lib/fortune500-data';
import { RadarChart } from './RadarChart';
import { CompanyLogo } from './CompanyLogo';

const EASE = [0.16, 1, 0.3, 1] as const;

export function PlanetPanel() {
  const selected = useGalaxyStore((s) => s.selectedStar);
  const clearSelection = useGalaxyStore((s) => s.clearSelection);
  const showTrajectory = useGalaxyStore((s) => s.showTrajectory);
  const setShowTrajectory = useGalaxyStore((s) => s.setShowTrajectory);
  const removeUserStar = useGalaxyStore((s) => s.removeUserStar);

  // Two-step confirm for deleting a user-added star; auto-cancels after 4s.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset the confirm state when switching to a different company.
  useEffect(() => {
    setConfirmingDelete(false);
  }, [selected?.id]);

  // Auto-cancel the confirm if the user walks away.
  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 8000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  return (
    <AnimatePresence>
      {selected && (
        <motion.aside
          key={selected.id}
          className="fixed bottom-0 right-0 top-0 z-30 flex w-[400px] max-w-[92vw] flex-col overflow-y-auto border-l border-border-subtle bg-void/95 backdrop-blur-xl"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
            <button
              onClick={clearSelection}
              className="text-[12px] font-medium text-ui-muted transition-colors hover:text-star-bright"
            >
              ← Back to Galaxy
            </button>
            <span className="text-[10px] uppercase tracking-label text-ui-muted">Planet view</span>
          </div>

          <div className="flex-1 px-6 py-6">
            {/* Header */}
            <div className="flex items-start gap-3">
              <CompanyLogo company={selected} />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold tracking-title text-star-bright">{selected.name}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="rounded-full border border-border-subtle px-2 py-0.5 text-ui-dim">
                    {selected.industry}
                  </span>
                  {selected.ticker && (
                    <span className="rounded-full border border-border-subtle px-2 py-0.5 font-mono text-ui-dim">
                      {selected.ticker}
                    </span>
                  )}
                  {selected.peFirm && (
                    <span className="rounded-full border border-trajectory/40 px-2 py-0.5 text-trajectory">
                      {selected.peFirm}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Key stats */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Stat label="Revenue" value={formatRevenue(selected.revenue)} />
              <Stat label="Employees" value={formatCompact(selected.employees)} />
              <Stat label="Founded" value={String(selected.founded)} />
              {selected.revenueRank ? (
                <Stat label="Revenue rank" value={`#${selected.revenueRank} of ${COMPANY_COUNT}`} />
              ) : (
                <Stat label="Headquarters" value={selected.location} />
              )}
            </div>

            {selected.domain && (
              <a
                href={`https://${selected.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-ui-dim transition-colors hover:text-star-bright"
              >
                {selected.domain} ↗
              </a>
            )}

            {/* Public AI positioning: research note compiled from disclosures */}
            {selected.aiPositioning && (
              <div className="mt-4 rounded-lg border border-border-subtle bg-nebula/60 p-3">
                <div className="text-[10px] font-medium uppercase tracking-label text-ui-muted">
                  Public AI positioning
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ui-dim">
                  {selected.aiPositioning}
                </p>
              </div>
            )}

            {/* Overall maturity */}
            <div className="mt-6">
              <div className="flex items-baseline gap-2">
                <span
                  className="text-4xl font-semibold tracking-title"
                  style={{ color: maturityColor(selected.maturity.overall) }}
                >
                  {selected.maturity.overall}
                </span>
                <span className="text-xs text-ui-muted">/ 100</span>
                <span
                  className="ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-label"
                  style={{
                    color: maturityColor(selected.maturity.overall),
                    backgroundColor: `${maturityColor(selected.maturity.overall)}1f`,
                  }}
                >
                  {maturityLabel(selected.maturity.overall)} maturity
                </span>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border-subtle">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${selected.maturity.overall}%`,
                    backgroundColor: maturityColor(selected.maturity.overall),
                  }}
                />
              </div>
              {!selected.isUserAdded && (
                <p className="mt-1.5 text-[10px] text-ui-muted/60">
                  Directional estimate from public AI disclosures (research use only)
                </p>
              )}
            </div>

            {/* Radar */}
            <div className="mt-6">
              <div className="flex justify-center">
                <RadarChart company={selected} />
              </div>
              <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] text-ui-muted/70">
                <svg width="18" height="8" aria-hidden="true">
                  <line
                    x1="0"
                    y1="4"
                    x2="18"
                    y2="4"
                    stroke="#6B6B8A"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                </svg>
                sector median
              </div>
            </div>

            {/* Dimension bars */}
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-label text-ui-muted">
                  Maturity dimensions
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-ui-muted/70">
                  <span className="h-px w-3 bg-ui-muted/70" />
                  sector median
                </span>
              </div>
              <div className="space-y-3">
                {DIMENSIONS.map((d, i) => {
                  const score = selected.maturity[d.key];
                  const median = SECTOR_MEDIAN[selected.industry][i + 1];
                  return (
                    <div key={d.key}>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-ui-dim">{d.label}</span>
                        <span className="font-medium" style={{ color: maturityColor(score) }}>
                          {score}
                        </span>
                      </div>
                      <div className="relative mt-1 h-1 overflow-hidden rounded-full bg-border-subtle">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: maturityColor(score) }}
                          initial={{ width: 0 }}
                          animate={{ width: `${score}%` }}
                          transition={{ duration: 0.7, delay: 0.2 + i * 0.06, ease: EASE }}
                        />
                        {/* Sector-median marker on the track */}
                        <span
                          className="absolute -top-[3px] h-[10px] w-px bg-ui-muted/80"
                          style={{ left: `calc(${median}% - 0.5px)` }}
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Trajectory */}
            {selected.trajectory && (
              <div className="mt-7 border-t border-border-subtle pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12px] font-semibold uppercase tracking-label text-star-bright">
                    Transformation trajectory
                  </h3>
                  <button
                    onClick={() => setShowTrajectory(!showTrajectory)}
                    className={`rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                      showTrajectory
                        ? 'border-trajectory bg-trajectory/10 text-trajectory'
                        : 'border-border-subtle text-ui-dim hover:border-trajectory hover:text-trajectory'
                    }`}
                  >
                    {showTrajectory ? 'Hide path' : 'See Trajectory'}
                  </button>
                </div>

                {showTrajectory && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.4, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 rounded-lg border border-border-subtle bg-nebula/60 p-4">
                      <div className="text-[11px] text-ui-muted">Projected EBITDA impact</div>
                      <div className="mt-0.5 text-2xl font-semibold text-maturity-high">
                        +${selected.trajectory.projectedEbitdaImpact}M
                        <span className="ml-1 text-[11px] font-normal text-ui-muted">annualized</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                        <div>
                          <div className="text-ui-muted">Exit multiple</div>
                          <div className="mt-0.5 font-medium text-star-bright">
                            +{selected.trajectory.projectedMultipleImprovement}x
                          </div>
                        </div>
                        <div>
                          <div className="text-ui-muted">Holding period</div>
                          <div className="mt-0.5 font-medium text-star-bright">
                            −{selected.trajectory.projectedHoldingPeriodReduction} mo
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      {selected.trajectory.milestones.map((m, i) => (
                        <div key={m.month} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-trajectory/50 text-[10px] font-semibold text-trajectory">
                              {i + 1}
                            </span>
                            {i < selected.trajectory!.milestones.length - 1 && (
                              <span className="mt-1 w-px flex-1 bg-border-subtle" />
                            )}
                          </div>
                          <div className="pb-1">
                            <div className="text-[12px] font-medium text-star-bright">
                              Month {m.month}: {m.title}
                            </div>
                            <div className="text-[11px] text-ui-muted">{m.description}</div>
                            <div className="mt-0.5 text-[11px] font-medium text-maturity-high">
                              +${m.impact}M EBITDA
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* Delete (user-added stars only) */}
            {selected.isUserAdded && (
              <div className="mt-8 border-t border-border-subtle pt-5">
                <button
                  onClick={() => {
                    if (!confirmingDelete) {
                      setConfirmingDelete(true);
                      return;
                    }
                    removeUserStar(selected.id);
                    clearSelection(); // camera flies back to the galaxy
                  }}
                  className={`w-full rounded-md border px-4 py-2.5 text-center text-[13px] font-medium transition-colors ${
                    confirmingDelete
                      ? 'border-[#F87171] bg-[#F87171]/10 text-[#F87171]'
                      : 'border-border-subtle text-ui-muted hover:border-[#F87171]/50 hover:text-[#F87171]'
                  }`}
                >
                  {confirmingDelete ? 'Click again to remove ✕' : 'Remove from galaxy'}
                </button>
                {confirmingDelete && (
                  <p className="mt-2 text-center text-[11px] text-ui-muted">
                    This removes the star and its saved data from this browser.
                  </p>
                )}
              </div>
            )}

            {/* CTAs */}
            <div className="mt-8 space-y-2">

              {/* Leads to the landing page's #contact section (full navigation). */}
              <a
                href="/#contact"
                className="block rounded-md bg-maturity-high px-4 py-2.5 text-center text-[13px] font-semibold text-void transition-opacity hover:opacity-90"
              >
                Contact Primero
              </a>
              <button
                disabled
                className="block w-full cursor-not-allowed rounded-md border border-border-subtle px-4 py-2.5 text-center text-[13px] font-medium text-ui-muted opacity-60"
                title="Coming soon"
              >
                Compare companies
              </button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/** A labeled stat tile in the profile header. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-void/40 px-3 py-2">
      <div className="text-[9px] font-medium uppercase tracking-label text-ui-muted">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-semibold text-star-bright">{value}</div>
    </div>
  );
}

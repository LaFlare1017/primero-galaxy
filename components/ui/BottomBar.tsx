'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Company } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { ModeIndicator } from './ModeIndicator';

export function BottomBar({
  companies,
  onAddCompany,
}: {
  companies: Company[];
  onAddCompany: () => void;
}) {
  const clearSelection = useGalaxyStore((s) => s.clearSelection);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 4400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex h-14 items-center justify-between px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    >
      <div className="bg-gradient-to-t from-void/90 to-transparent absolute inset-0 -z-10" />

      {/* Left: wordmark + stats */}
      <div className="flex items-baseline gap-3">
        <span className="text-[13px] font-semibold tracking-[0.18em] text-star-bright">
          PRIMERO GALAXY
        </span>
        <span className="text-[11px] text-ui-muted">
          {companies.length} stars · {new Set(companies.map((c) => c.industry)).size} industries
        </span>
      </div>

      {/* Center: mode + controls hint */}
      <div className="hidden items-center gap-6 md:flex">
        <ModeIndicator />
        <span className="text-[11px] tracking-wide text-ui-muted">
          Drag to orbit · Scroll to zoom · Double-click to explore
        </span>
      </div>

      {/* Right: actions */}
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          onClick={clearSelection}
          className="rounded-md border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-ui-dim transition-colors hover:border-star-dim hover:text-star-bright"
          title="Reset view (Esc)"
        >
          Reset view
        </button>
        <button
          disabled
          className="cursor-not-allowed rounded-md border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-ui-muted opacity-50"
          title="Coming soon"
        >
          PE Portfolio
        </button>
        <button
          onClick={onAddCompany}
          className="rounded-md border border-trajectory/50 px-3 py-1.5 text-[12px] font-medium text-trajectory transition-colors hover:bg-trajectory/10 hover:border-trajectory"
          title="Add your company to the galaxy"
        >
          Add Company
        </button>
      </div>
    </motion.div>
  );
}

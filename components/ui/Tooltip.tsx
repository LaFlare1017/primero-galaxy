'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGalaxyStore } from '@/store/galaxyStore';
import { maturityColor, maturityLabel } from '@/lib/constants';
import { lerp } from '@/lib/utils';
import { CompanyLogo } from './CompanyLogo';

/**
 * Cursor-following tooltip with ~50ms lerp lag. Shows the hovered company's
 * name, industry, maturity score, and an exploration hint.
 */
export function Tooltip() {
  const hovered = useGalaxyStore((s) => s.hoveredStar);
  const [pos, setPos] = useState({ x: -400, y: -400 });
  const target = useRef({ x: -400, y: -400 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      target.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    const loop = () => {
      setPos((p) => ({
        x: Math.min(lerp(p.x, target.current.x + 16, 0.12), window.innerWidth - 300),
        y: Math.min(lerp(p.y, target.current.y + 18, 0.12), window.innerHeight - 160),
      }));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <AnimatePresence>
      {hovered && (
        <motion.div
          key={hovered.id}
          className="glass pointer-events-none fixed z-30 w-max max-w-[280px] rounded-lg p-4"
          style={{ left: pos.x, top: pos.y }}
          initial={{ opacity: 0, scale: 0.94, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >          <div className="flex items-center gap-2">
            <CompanyLogo company={hovered} size="sm" />
            <div className="text-base font-semibold text-star-bright">{hovered.name}</div>
          </div>
          <div className="mt-0.5 text-sm text-ui-dim">
            {hovered.industry}
            {hovered.ticker ? ` · ${hovered.ticker}` : ''}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <span
              className="text-2xl font-semibold"
              style={{ color: maturityColor(hovered.maturity.overall) }}
            >
              {hovered.maturity.overall}
            </span>
            <span className="text-xs text-ui-muted">/ 100</span>
            <span
              className="ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-label"
              style={{
                color: maturityColor(hovered.maturity.overall),
                backgroundColor: `${maturityColor(hovered.maturity.overall)}1f`,
              }}
            >
              {maturityLabel(hovered.maturity.overall)}
            </span>
          </div>
          <div className="mt-2.5 border-t border-border-subtle pt-2 text-[11px] text-ui-muted">
            Double-click to explore
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

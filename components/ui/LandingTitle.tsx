'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * Landing sequence: black screen → title fades in (~1s) → fades out (~4s)
 * → unmounts. Honors prefers-reduced-motion by cutting the sequence short.
 */
export function LandingTitle() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = prefersReduced ? 1600 : 5200;
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      transition={{ duration: 5, times: [0, 0.2, 0.82, 1], ease: 'easeInOut' }}
    >
      <motion.h1
        className="text-center text-5xl font-semibold tracking-title text-star-bright md:text-[72px]"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.8, ease: 'easeOut' }}
      >
        The AI Transformation Galaxy
      </motion.h1>
      <motion.p
        className="mt-5 text-xs uppercase tracking-label text-ui-muted md:text-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.8 }}
      >
        500 companies. One universe. Explore.
      </motion.p>
    </motion.div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/**
 * Landing sequence: title rises in → holds → fades out (3.4→4.0s) →
 * unmounts at 4.2s.
 *
 * The entrance animates ONLY the transform, never opacity: the title paints
 * at full opacity the moment the HTML renders, so the page's LCP lands at
 * first paint instead of waiting for the heavy three.js JavaScript to boot
 * (Chrome does not treat opacity-faded elements as LCP candidates). The
 * timed fade-out is the only JS-driven part. Honors prefers-reduced-motion
 * by cutting the sequence short (the global CSS media query also collapses
 * the CSS animations to near-instant).
 *
 * Timing invariant: the overlay must unmount (4.2s) strictly BEFORE the
 * BottomBar starts fading in (4.4s); both live at z-20, so a late fade
 * would briefly stack the two layers. Keep the two components in sync if
 * either timing changes.
 */
export function LandingTitle() {
  const [visible, setVisible] = useState(true);
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      const timer = setTimeout(() => setVisible(false), 1600);
      return () => clearTimeout(timer);
    }
    const fadeOut = setTimeout(() => setPhase('out'), 3400);
    const unmount = setTimeout(() => setVisible(false), 4200);
    return () => {
      clearTimeout(fadeOut);
      clearTimeout(unmount);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-center ${
        phase === 'out' ? 'animate-fade-out' : ''
      }`}
    >
      <motion.p
        className="text-[11px] font-semibold uppercase tracking-label text-trajectory"
        initial={{ y: 10 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.1, duration: 0.8, ease: 'easeOut' }}
      >
        AI Transformation Maturity Visualization
      </motion.p>
      <motion.h1
        className="mt-5 text-center text-4xl font-semibold leading-[1.05] tracking-title text-star-bright md:text-6xl"
        initial={{ y: 14 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.2, duration: 0.8, ease: 'easeOut' }}
      >
        The AI Transformation Galaxy
      </motion.h1>
      <motion.p
        className="mt-5 max-w-[62ch] text-center text-base leading-relaxed text-star-bright/90 md:text-lg"
        initial={{ y: 10 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.5, duration: 0.8, ease: 'easeOut' }}
      >
        Each star is a Fortune 500 company embarking on an AI Transformation
        journey. Explore.
      </motion.p>
    </div>
  );
}

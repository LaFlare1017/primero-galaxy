"use client";

import { useEffect, useState } from "react";

/**
 * Shared prefers-reduced-motion hook. This is the JS counterpart to the
 * global CSS kill switch in globals.css: use it to gate animation that CSS
 * cannot reach — framer-motion is covered globally by MotionProvider
 * (MotionConfig reducedMotion="user"), and canvas/WebGL render loops
 * (react-three-fiber useFrame) must check this hook directly.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

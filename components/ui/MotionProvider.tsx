"use client";

import { MotionConfig } from "framer-motion";

/**
 * Global framer-motion policy: reducedMotion="user" makes every motion.*
 * component and AnimatePresence respect the OS prefers-reduced-motion
 * setting — transform/layout animation is disabled while opacity fades
 * remain. This is the JS counterpart to the global CSS kill switch in
 * globals.css; canvas/WebGL loops gate themselves via useReducedMotion.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

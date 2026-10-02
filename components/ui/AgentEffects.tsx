"use client";

import { BorderBeam } from "border-beam";
import { ThinkingOrb } from "thinking-orbs";

import { usePrefersReducedMotion } from "@/components/ui/useReducedMotion";

/**
 * Delegate chat effect primitives (Libraries.dev), kept behind one client
 * boundary. Style contract (see app/delegate/page.tsx header): light mode,
 * monochrome; color is reserved for meaning. Hence colorVariant="mono" on
 * the beam and theme="light" on the orb.
 */

/** Travelling beam around the chat composer while the agent works. */
export function ComposerBeam({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <BorderBeam active={active && !reduced} colorVariant="mono" theme="light" strength={0.8}>
      {children}
    </BorderBeam>
  );
}

/** Inline status orb; hidden entirely when motion should be reduced. */
export function AgentStatusOrb({ active }: { active: boolean }) {
  const reduced = usePrefersReducedMotion();
  if (!active || reduced) return null;
  return (
    <ThinkingOrb
      state="working"
      size={20}
      theme="light"
      aria-hidden="true"
      className="inline-block align-middle"
    />
  );
}

/**
 * Breathing glow on a card that awaits a human decision (the s6 posting
 * authorization). Pulse types handle prefers-reduced-motion themselves:
 * the glow then never becomes visible, so the meaning must not ride on it
 * (the amber border and the "n/3 reviewed" counter carry it instead).
 */
export function DecisionBeam({ children }: { children: React.ReactNode }) {
  return (
    <BorderBeam size="pulse-inner" colorVariant="mono" theme="light" strength={0.7}>
      {children}
    </BorderBeam>
  );
}

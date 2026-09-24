"use client";

import { useEffect, useState } from "react";

/**
 * Facilitator view (handoff §7): kept open on the facilitator's screen.
 * Live grid of participants — current scenario, elapsed time, status, and
 * (only after submission) whether the defect was detected. No individual
 * numeric scores anywhere — the grid is for pacing the room, and scores
 * are revealed together in the group debrief.
 *
 * Style: simple light mode — white background, black text, inline SVG
 * stroke icons (participants never see this screen; it is projected).
 */

interface Row {
  participant: string;
  cohort: string;
  currentScenario: string;
  startedAt: string;
  submittedAt?: string;
  elapsedSeconds: number;
  status: string;
  detected?: boolean;
  flaggedBehavior?: string;
}

const SCENARIO_NAMES: Record<string, string> = {
  s1: "1 · Bank recon",
  s2: "2 · Intercompany",
  s3: "3 · Q1 flux",
  s4: "4 · AR aging",
  s5: "5 · Revenue recognition",
  s6: "6 · Post accruals",
};

function Icon({ name, size = 14, className = "" }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, string> = {
    monitor: "M8 21h8m-4-4v4M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Z",
    users: "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 align-[-2px] ${className}`}
      aria-hidden="true"
    >
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

export default function FacilitatorPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("delegate-light");
    return () => document.documentElement.classList.remove("delegate-light");
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/delegate/facilitator", { cache: "no-store" });
        const data = (await res.json()) as { rows: Row[]; generatedAt: string };
        if (!alive) return;
        setRows(data.rows ?? []);
        setGeneratedAt(data.generatedAt);
      } catch {
        // keep last good data
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="min-h-screen bg-white text-black p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-black flex items-center gap-2">
          <Icon name="monitor" size={18} />
          Delegate · Facilitator
        </h1>
        <span className="text-xs text-gray-500 flex items-center gap-1.5">
          <Icon name="users" size={12} />
          live · refreshed {generatedAt ? new Date(generatedAt).toLocaleTimeString() : "not yet"} · individual scores reveal at the group debrief
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-md p-6">
          <p>No sessions yet. Participants start at /delegate.</p>
          <p className="mt-2">When they do, rows appear here automatically.</p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-4">Participant</th>
              <th className="py-2 pr-4">Scenario</th>
              <th className="py-2 pr-4">Elapsed</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Detection</th>
              <th className="py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-2 pr-4 font-medium">{r.participant}</td>
                <td className="py-2 pr-4">{SCENARIO_NAMES[r.currentScenario] ?? r.currentScenario}</td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {Math.floor(r.elapsedSeconds / 60)}:{String(r.elapsedSeconds % 60).padStart(2, "0")}
                </td>
                <td className="py-2 pr-4">
                  <span className={r.status === "submitted" ? "text-black font-medium" : "text-gray-500"}>{r.status}</span>
                </td>
                <td className="py-2 pr-4">
                  {r.detected === undefined ? "n/a" : r.detected ? "caught it" : "missed"}
                </td>
                <td className="py-2 text-black">{r.flaggedBehavior ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

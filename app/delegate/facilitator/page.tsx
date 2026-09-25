"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AgentStatusOrb } from "@/components/ui/AgentEffects";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/primitives/table";
import { cn } from "@/lib/utils";

/**
 * Facilitator view (handoff §7): kept open on the facilitator's screen.
 * Live grid of participants — current scenario, elapsed time, status, and
 * (only after submission) whether the defect was detected. No individual
 * numeric scores anywhere — the grid is for pacing the room, and scores
 * are revealed together in the group debrief.
 *
 * Built on the Circle-extracted table primitives; status facets and column
 * sorting are client-side over the polled rows. Monochrome light mode:
 * color stays reserved for meaning, so facets and sort indicators differ
 * by weight and stroke, not hue.
 */

interface Row {
  participant: string;
  cohort: string;
  currentScenario: string;
  startedAt: string;
  submittedAt?: string;
  elapsedSeconds: number;
  status: string;
  agentWorking?: boolean;
  detected?: boolean;
  flaggedBehavior?: string;
}

type SortKey =
  | "participant"
  | "currentScenario"
  | "elapsedSeconds"
  | "status"
  | "detected";

const SCENARIO_NAMES: Record<string, string> = {
  s1: "1 · Bank recon",
  s2: "2 · Intercompany",
  s3: "3 · Q1 flux",
  s4: "4 · AR aging",
  s5: "5 · Revenue recognition",
  s6: "6 · Post accruals",
};

const DETECTION_RANK: Record<string, number> = {
  "n/a": 0,
  missed: 1,
  "caught it": 2,
};

function detectionLabel(row: Row): string {
  if (row.detected === undefined) return "n/a";
  return row.detected ? "caught it" : "missed";
}

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
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "participant",
    desc: false,
  });

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

  const statusFacets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const visibleRows = useMemo(() => {
    const filtered =
      statusFilter.size === 0 ? rows : rows.filter((r) => statusFilter.has(r.status));
    const sorted = [...filtered].sort((a, b) => {
      const dir = sort.desc ? -1 : 1;
      switch (sort.key) {
        case "elapsedSeconds":
          return (a.elapsedSeconds - b.elapsedSeconds) * dir;
        case "detected":
          return ((DETECTION_RANK[detectionLabel(a)] ?? 0) - (DETECTION_RANK[detectionLabel(b)] ?? 0)) * dir;
        case "currentScenario":
          return (
            (SCENARIO_NAMES[a.currentScenario] ?? a.currentScenario).localeCompare(
              SCENARIO_NAMES[b.currentScenario] ?? b.currentScenario,
            ) * dir
          );
        default:
          return a[sort.key].localeCompare(b[sort.key]) * dir;
      }
    });
    return sorted;
  }, [rows, statusFilter, sort]);

  function toggleStatus(status: string) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function sortButton(key: SortKey, label: string) {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.desc ? ArrowDown : ArrowUp;
    return (
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, desc: active ? !s.desc : false }))}
        aria-label={`Sort by ${label}`}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-black",
          active ? "text-black" : "text-gray-500",
        )}
      >
        {label}
        <Icon className="h-3 w-3" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-black flex items-center gap-2">
          <Icon name="monitor" size={18} />
          Delegate · Facilitator
        </h1>
        <span className="text-xs text-gray-500 flex items-center gap-1.5">
          <Icon name="users" size={12} />
          agent activity · refreshed {generatedAt ? new Date(generatedAt).toLocaleTimeString() : "not yet"} · individual scores reveal at the group debrief
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-md p-6">
          <p>No sessions yet. Participants start at /delegate.</p>
          <p className="mt-2">When they do, rows appear here automatically.</p>
        </div>
      ) : (
        <>
          {/* Status facets: monochrome chips; selection is a weight change,
              not a color change (Delegate keeps color for meaning). */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
            {statusFacets.map(([status, count]) => {
              const selected = statusFilter.has(status);
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleStatus(status)}
                  aria-pressed={selected}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[13px]",
                    selected
                      ? "border-black bg-black text-white font-medium"
                      : "border-gray-300 bg-white text-gray-600 hover:border-gray-500 hover:text-black",
                  )}
                >
                  {status}
                  <span className="tabular-nums text-[11px] opacity-70">{count}</span>
                </button>
              );
            })}
            {statusFilter.size > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter(new Set())}
                className="ml-1 h-7 px-2 text-[13px] text-gray-500 underline-offset-2 hover:text-black hover:underline"
              >
                Clear
              </button>
            )}
            <span className="ml-auto text-xs tabular-nums text-gray-500">
              {visibleRows.length} of {rows.length} participants
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[11px] uppercase">{sortButton("participant", "Participant")}</TableHead>
                <TableHead className="text-[11px] uppercase">{sortButton("currentScenario", "Scenario")}</TableHead>
                <TableHead className="text-[11px] uppercase">{sortButton("elapsedSeconds", "Elapsed")}</TableHead>
                <TableHead className="text-[11px] uppercase">{sortButton("status", "Status")}</TableHead>
                <TableHead className="text-[11px] uppercase">{sortButton("detected", "Detection")}</TableHead>
                <TableHead className="text-[11px] uppercase text-gray-500">Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((r, i) => (
                <TableRow key={i} className="border-gray-100 hover:bg-gray-50">
                  <TableCell className="py-2 font-medium text-black">{r.participant}</TableCell>
                  <TableCell className="py-2">{SCENARIO_NAMES[r.currentScenario] ?? r.currentScenario}</TableCell>
                  <TableCell className="py-2 font-mono text-xs">
                    {Math.floor(r.elapsedSeconds / 60)}:{String(r.elapsedSeconds % 60).padStart(2, "0")}
                  </TableCell>
                  <TableCell className="py-2">
                    <span className="inline-flex items-center gap-1.5">
                      {r.agentWorking ? <AgentStatusOrb active /> : null}
                      <span className={r.status === "submitted" ? "text-black font-medium" : "text-gray-500"}>{r.status}</span>
                    </span>
                  </TableCell>
                  <TableCell className="py-2">{detectionLabel(r)}</TableCell>
                  <TableCell className="py-2 text-black">{r.flaggedBehavior ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

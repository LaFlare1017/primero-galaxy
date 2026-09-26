"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, ArrowUpDown, Link2, X } from "lucide-react";
import {
  createParser,
  parseAsString,
  parseAsStringEnum,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AgentStatusOrb } from "@/components/ui/AgentEffects";
import { FacilitatorSavedViews } from "@/components/delegate/SavedViews";
import type { FacilitatorViewState } from "@/components/delegate/saved-views";
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
 * sorting are client-side over the polled rows, but their STATE lives in
 * the URL (?status=…, ?sort=…&dir=…) so a facilitator can share a
 * pre-filtered view. Monochrome light mode: color stays reserved for
 * meaning, so facets and sort indicators differ by weight and stroke, not
 * hue.
 */

interface Row {
  participant: string;
  cohort: string;
  runId?: string;
  sessionId: string;
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

// ── Shareable view state (nuqs, same URL-state layer as FinBench filters) ──

/**
 * Selected status facets, comma-joined in one ?status= param. Three states
 * the component must distinguish:
 *   param absent        → unfiltered (show everyone) — the default view
 *   ?status=working,…   → filtered to those statuses
 *   ?status= (empty)    → explicit "none selected" — an empty grid that is
 *                         still shareable and rescuable via Clear
 * Toggling the last chip off lands in the third state (per design: an
 * explicit all-deselected grid shows zero rows, never silently "all").
 */
const statusListParser = createParser<string[]>({
  parse: (value) => (value.length === 0 ? [] : value.split(",").filter((s) => s.length > 0)),
  serialize: (value) => value.join(","),
  eq: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
});

const SORT_KEY_VALUES: SortKey[] = [
  "participant",
  "currentScenario",
  "elapsedSeconds",
  "status",
  "detected",
];
// Defaults drop out of the URL (clearOnDefault), so an unsorted view shares
// as a param-free URL.
const sortKeyParser = parseAsStringEnum<SortKey>(SORT_KEY_VALUES).withDefault("participant");
const sortDirParser = parseAsStringLiteral(["asc", "desc"] as const).withDefault("asc");

/**
 * Name of an imported shared view. Carries no state of its own — the view's
 * state rides the normal ?status=/?sort=/?dir= params — it only names the
 * snapshot for the receiver ("Opened shared view 'Working watch'") and is
 * stripped from the URL immediately so a refresh never re-toasts.
 */
const viewNameParser = parseAsString;

function detectionLabel(row: Row): string {
  if (row.detected === undefined) return "n/a";
  return row.detected ? "caught it" : "missed";
}

/**
 * Resumable participant link for a row (URL-state audit sequencing §7.4):
 * the same `?run=`/`?session=` pointer the participant screen writes when a
 * run starts. Opening it lands on the consent-required restore offer; a
 * submitted run restores read-only. The ids are opaque capability tokens,
 * so the label stays out of the URL (audit §5).
 */
function runLink(row: Row): string | null {
  if (!row.runId) return null;
  const url = new URL("/delegate", window.location.origin);
  url.searchParams.set("run", row.runId);
  url.searchParams.set("session", row.sessionId);
  return url.toString();
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

/**
 * Default export wraps the grid in Suspense: the page is statically
 * prerendered, and useQueryState (useSearchParams) forces a CSR bailout
 * for the prerender pass. The boundary must sit ABOVE the component that
 * reads the URL, hence the wrapper + rename.
 */
export default function FacilitatorPage() {
  return (
    <Suspense>
      <FacilitatorGrid />
    </Suspense>
  );
}

function FacilitatorGrid() {
  const [rows, setRows] = useState<Row[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");

  // Facets + sort live in the URL so views can be shared and survive a
  // refresh while the 4s poll keeps the underlying rows live.
  const [statuses, setStatuses] = useQueryState("status", statusListParser);
  const [sortKey, setSortKey] = useQueryState("sort", sortKeyParser);
  const [sortDir, setSortDir] = useQueryState("dir", sortDirParser);
  const [viewName, setViewName] = useQueryState("view", viewNameParser);
  const statusFilter = useMemo(() => new Set(statuses ?? []), [statuses]);
  const [sharedView, setSharedView] = useState<string | null>(null);
  // Row whose run link was just copied: the button flips to "Copied" for
  // a moment (the saved-views Share flash, in grid form).
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);

  const copyRunLink = useCallback((row: Row) => {
    const link = runLink(row);
    if (!link) return;
    void navigator.clipboard.writeText(link).then(() => {
      setCopiedRunId(row.runId ?? null);
      window.setTimeout(() => setCopiedRunId(null), 1500);
    });
  }, []);

  // Imported shared view: acknowledge the ?view= name once with a toast,
  // then drop the param (replaceState via nuqs) so a refresh doesn't
  // re-toast. The state itself was already applied by the other params.
  useEffect(() => {
    if (viewName === null) return;
    setSharedView(viewName);
    void setViewName(null);
  }, [viewName, setViewName]);

  // Saved-view snapshot of the live state. Defaults are stored as null,
  // mirroring clearOnDefault: participant/asc never appear in ?sort=/?dir=,
  // so a saved view replays into exactly the same URL shape it was saved
  // from. Unlike FinBench, the default state itself is savable.
  const viewState = useMemo<FacilitatorViewState>(
    () => ({
      status: statuses,
      sort: sortKey === "participant" ? null : sortKey,
      dir: sortDir === "desc" ? "desc" : null,
    }),
    [statuses, sortKey, sortDir],
  );

  async function applyViewState(view: FacilitatorViewState) {
    await setStatuses(view.status);
    // Validate the stored sort key against the known set (views come from
    // the live state, but the store is hand-editable localStorage).
    const stored = view.sort !== null && SORT_KEY_VALUES.includes(view.sort as SortKey)
      ? (view.sort as SortKey)
      : null;
    await setSortKey(stored ?? "participant");
    await setSortDir(view.dir === "desc" ? "desc" : "asc");
  }

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
    // null = no ?status= param (show everyone); [] = all chips deselected
    // (the explicit empty grid).
    const filtered =
      statuses === null ? rows : rows.filter((r) => statusFilter.has(r.status));
    const dir = sortDir === "desc" ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
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
          return a[sortKey].localeCompare(b[sortKey]) * dir;
      }
    });
    return sorted;
  }, [rows, statuses, statusFilter, sortKey, sortDir]);

  function toggleStatus(status: string) {
    void setStatuses((prev) => {
      const set = new Set(prev ?? []);
      if (set.has(status)) set.delete(status);
      else set.add(status);
      // Sorted for a stable comma order, so toggling never churns the URL.
      return [...set].sort((a, b) => a.localeCompare(b));
    });
  }

  function sortButton(key: SortKey, label: string) {
    const active = sortKey === key;
    const Icon = !active ? ArrowUpDown : sortDir === "desc" ? ArrowDown : ArrowUp;
    return (
      <button
        type="button"
        onClick={() => {
          const nextDesc = active ? sortDir !== "desc" : false;
          void setSortKey(key);
          void setSortDir(nextDesc ? "desc" : "asc");
        }}
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

      {/* Imported shared view: ephemeral monochrome acknowledgment. */}
      <AnimatePresence>
        {sharedView !== null && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="status"
            className="mb-3 flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-600"
          >
            <span>
              Opened shared view <span className="font-medium text-black">{sharedView}</span>
            </span>
            <button
              type="button"
              aria-label="Dismiss shared view notification"
              onClick={() => setSharedView(null)}
              className="text-gray-400 hover:text-black"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-md p-6">
          <p>No sessions yet. Participants start at /delegate.</p>
          <p className="mt-2">When they do, rows appear here automatically.</p>
        </div>
      ) : (
        <>
          {/* Status facets: monochrome chips; selection is a weight change,
              not a color change (Delegate keeps color for meaning). */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
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
                    <span className="tabular-nums text-[11px]">{count}</span>
                  </button>
                );
              })}
              {/* Clear shows whenever the ?status= param exists — including
                  the explicit all-deselected grid, where it is the escape
                  hatch back to the full room. */}
              {statuses !== null && (
                <button
                  type="button"
                  onClick={() => void setStatuses(null)}
                  className="ml-1 h-7 px-2 text-[13px] text-gray-500 underline-offset-2 hover:text-black hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            {/* Named status/sort combinations (Circle views pattern),
                stored in localStorage, applied through the same URL
                pipeline as the chips and deep links. */}
            <FacilitatorSavedViews viewState={viewState} onApply={applyViewState} />
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
                <TableHead className="text-[11px] uppercase text-gray-500">
                  <span className="sr-only">Copy run link</span>
                  <span aria-hidden="true">Link</span>
                </TableHead>
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
                  <TableCell className="py-2">
                    {r.runId ? (
                      <button
                        type="button"
                        onClick={() => copyRunLink(r)}
                        aria-label={`Copy run link for ${r.participant}`}
                        className={cn(
                          "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs",
                          copiedRunId === r.runId
                            ? "border-black bg-black text-white font-medium"
                            : "border-gray-300 bg-white text-gray-600 hover:border-gray-500 hover:text-black",
                        )}
                      >
                        <Link2 className="h-3 w-3" aria-hidden="true" />
                        {copiedRunId === r.runId ? "Copied" : "Copy link"}
                      </button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

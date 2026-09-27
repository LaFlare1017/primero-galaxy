"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Eye, ExternalLink, Link2, X } from "lucide-react";
import {
  createParser,
  parseAsString,
  parseAsStringEnum,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AgentStatusOrb } from "@/components/ui/AgentEffects";
import { MessageBody } from "@/components/ui/MessageBody";
import { FacilitatorSavedViews } from "@/components/delegate/SavedViews";
import type { FacilitatorViewState } from "@/components/delegate/saved-views";
import { useElapsedClock } from "@/components/delegate/useElapsedClock";
import { useKeyboardShortcuts } from "@/components/delegate/useKeyboardShortcuts";
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

/**
 * Scenario ids, mirroring the participant page's SCENARIOS (kept local:
 * the surfaces share the URL-state conventions, not the module).
 */
const SCENARIO_FOCUS_IDS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
type ScenarioFocusId = (typeof SCENARIO_FOCUS_IDS)[number];

/**
 * Scenario focus (deep-linkable): ?scenario=s3 dims the room down to that
 * scenario — rows on it get the marker — and offers to open the participant
 * view with the same scenario preselected. Unlike the participant page
 * there is no default scenario, so absent must be null (no withDefault and
 * no clearOnDefault needed) and an unknown value degrades to no focus.
 */
const scenarioFocusParser = parseAsStringEnum<ScenarioFocusId>([...SCENARIO_FOCUS_IDS]);

/**
 * Watched run (?watch=<runId>): the console mirrors that run live from
 * GET /api/delegate/run/[runId]/state — status, elapsed clock, and the
 * transcript as it grows — without opening a tab. The run id is the same
 * capability token the chat/submit APIs already trust, so the read changes
 * nothing about the v1 posture; scores stay debrief-only either way.
 */
const watchParser = parseAsString;

const SCENARIO_FOCUS_NAMES: Record<ScenarioFocusId, string> = {
  s1: "Scenario 1 · Bank recon",
  s2: "Scenario 2 · Intercompany",
  s3: "Scenario 3 · Q1 flux",
  s4: "Scenario 4 · AR aging",
  s5: "Scenario 5 · Revenue recognition",
  s6: "Scenario 6 · Post accruals",
};
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

/**
 * The facilitator's verdict vocabulary for a run's detection status, shared
 * by the grid's Detection column and the watch pane's submitted result so
 * one run never reads two ways. A live run has no verdict at all ("n/a") —
 * nothing is inferred ahead of submission.
 */
function detectionLabel(detected: boolean | undefined): string {
  if (detected === undefined) return "n/a";
  return detected ? "caught it" : "missed";
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

/**
 * The two run-link actions for a row (URL-state audit sequencing §7.4):
 * Open launches the participant's run in a new tab — the consent-required
 * restore offer still gates the workspace on arrival — and Copy puts the
 * same resumable URL on the clipboard, flipping to "Copied" briefly
 * (the saved-views Share flash, in grid form).
 */
function RunLinkCell({ row, copied, onCopy }: { row: Row; copied: boolean; onCopy: (row: Row) => void }) {
  const link = runLink(row);
  if (!link) return null;
  return (
    <div className="flex items-center gap-1.5">
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open run for ${row.participant}`}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-600 hover:border-gray-500 hover:text-black"
      >
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
        Open
      </a>
      <button
        type="button"
        onClick={() => onCopy(row)}
        aria-label={`Copy run link for ${row.participant}`}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs",
          copied
            ? "border-black bg-black text-white font-medium"
            : "border-gray-300 bg-white text-gray-600 hover:border-gray-500 hover:text-black",
        )}
      >
        <Link2 className="h-3 w-3" aria-hidden="true" />
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
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

/** One transcript message as served by the run-state endpoint. */
interface WatchMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  toolCalls?: Array<{ tool: string; args?: Record<string, unknown>; summary?: string }>;
}

const WATCH_POLL_MS = 3000;

/**
 * Live mirror of a participant's run (the audit's end-to-end sharing,
 * taken to the console itself): polls GET /api/delegate/run/[runId]/state
 * and renders what the participant sees — status, the elapsed clock
 * derived from run.startedAt (frozen once submitted), and the transcript
 * as it grows, with each turn's tool calls collapsed exactly like the
 * live chat. Once the run is in, it also shows the post-submit outcome: the
 * debrief note the endpoint already serves (the same text the participant
 * reads) and the grid's own detection verdict — never a score, which stays
 * with the group debrief. Everything is rebuilt from the event log, so the
 * mirror is the same data the participant's own restored screen shows.
 */
function WatchPane({
  runId,
  detected,
  onClose,
  onStep,
  position,
  canStep,
}: {
  runId: string;
  detected?: boolean;
  onClose: () => void;
  onStep: (delta: number) => void;
  position: { index: number; total: number } | null;
  canStep: boolean;
}) {
  const [label, setLabel] = useState("");
  const [scenario, setScenario] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [messages, setMessages] = useState<WatchMessage[]>([]);
  // The debrief note comes from the state endpoint (the same text the
  // participant reads). The VERDICT deliberately does not: the endpoint
  // reports "detected" for a run whose scenario planted no defect at all
  // (s5/s6 have no interception score), while the grid refuses to invent a
  // verdict there. The pane takes the grid's verdict as a prop so the two
  // can never contradict each other on one screen.
  const [debriefNote, setDebriefNote] = useState("");
  const [missing, setMissing] = useState(false);

  // One poller: the run-state endpoint doubles as the live tick, so a
  // growing transcript (and the submitted transition) arrive with the
  // same cadence as the grid's own rows.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/delegate/run/${encodeURIComponent(runId)}/state`, {
          cache: "no-store",
        });
        if (!alive) return;
        if (!res.ok) {
          setMissing(true);
          return;
        }
        const data = (await res.json()) as {
          participantLabel: string;
          scenarioId: string;
          startedAt: string;
          submittedAt?: string | null;
          debriefNote?: string;
          messages: WatchMessage[];
        };
        setMissing(false);
        setLabel(data.participantLabel);
        setScenario(SCENARIO_FOCUS_NAMES[data.scenarioId as ScenarioFocusId] ?? data.scenarioId);
        setStartedAt(new Date(data.startedAt).getTime());
        setSubmittedAt(data.submittedAt ?? null);
        setDebriefNote(data.debriefNote ?? "");
        setMessages(data.messages ?? []);
      } catch {
        // keep last good mirror
      }
    };
    tick();
    const t = setInterval(tick, WATCH_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [runId]);

  // Elapsed clock, frozen at the submitted time once the run is in.
  const elapsed = useElapsedClock(startedAt, submittedAt);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  if (missing) {
    return (
      <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <p className="font-medium text-black">This run could not be found.</p>
        <p className="mt-1 text-xs">It may have been cleared from the workshop store. Close the pane and pick another row.</p>
      </div>
    );
  }

  return (
    <section
      className="mb-4 rounded-md border border-gray-200"
      aria-label={`Watching run for ${label}`}
      // Announced only when stepping is possible, so the shortcut is never
      // advertised on a room with nothing to sweep.
      aria-keyshortcuts={canStep ? "ArrowLeft ArrowRight" : undefined}
    >
      <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <span className="text-[13px] font-medium text-black">{label || "…"}</span>
        <span className="text-[13px] text-gray-500">{scenario}</span>
        <span className="font-mono text-xs tabular-nums text-gray-500">
          {mm}:{ss}
        </span>
        <span className={cn("text-[13px]", submittedAt ? "font-medium text-black" : "text-gray-500")}>
          {submittedAt ? "submitted" : "working"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Sweep controls: cycle through the currently visible
              participants without re-clicking rows. */}
          {position !== null && (
            <span className="mr-1 text-xs tabular-nums text-gray-500">
              {position.index + 1} of {position.total}
            </span>
          )}
          <button
            type="button"
            onClick={() => onStep(-1)}
            disabled={!canStep}
            aria-label="Watch previous participant"
            title="Watch previous participant (←)"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:border-gray-500 hover:text-black disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onStep(1)}
            disabled={!canStep}
            aria-label="Watch next participant"
            title="Watch next participant (→)"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:border-gray-500 hover:text-black disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close watch pane"
            className="ml-1 text-gray-400 hover:text-black"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-xs text-gray-500">No messages yet — the participant has not prompted the agent.</p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={`max-w-[92%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-black text-white" : "bg-white border border-gray-200 text-black"
                }`}
              >
                <MessageBody content={m.content} />
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <details className="mt-2 group">
                    <summary className={`cursor-pointer text-xs ${m.role === "user" ? "text-gray-300" : "text-gray-500 hover:text-black"}`}>
                      {m.toolCalls.length} tool call{m.toolCalls.length > 1 ? "s" : ""} (expand to see what the agent did)
                    </summary>
                    <div className="mt-1 space-y-1">
                      {m.toolCalls.map((tc, j) => (
                        <div key={j} className="rounded bg-gray-50 border border-gray-200 px-2 py-1 text-xs font-mono text-gray-600">
                          <span className="text-black font-semibold">{tc.tool}</span> {JSON.stringify(tc.args ?? {})}
                          {tc.summary ? ` → ${tc.summary}` : ""}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          ))
        )}
        {!submittedAt && messages.length > 0 && (
          <div className="flex justify-start">
            <div className="text-xs text-gray-500 pl-1 flex items-center gap-2">
              <AgentStatusOrb active />
              <span>agent is working with the ERP…</span>
            </div>
          </div>
        )}
      </div>
      {/*
        Post-submit result: the pane answers the question a facilitator
        actually asks here — did this one get it, and what will the room be
        told — while the score itself stays for the group debrief, exactly
        as the participant's own post-submit panel holds it back. No
        verdict line at all when the scenario planted no defect to detect;
        the grid's own n/a carries that, and a bare "n/a" in a mirror of a
        finished run would only read as a gap.
      */}
      {submittedAt && (
        <section aria-label="Submitted result" className="border-t border-gray-200 bg-gray-50 px-3 py-2">
          {detected !== undefined && (
            <p className="text-[13px] text-gray-600">
              <span className="font-medium text-black">Detection: {detectionLabel(detected)}</span>
              {detected
                ? " — the participant was told their answer named the defect."
                : " — the participant was told the verdict waits for the group debrief."}
            </p>
          )}
          {debriefNote && (
            <p className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-gray-600">
              {debriefNote}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-gray-400">
            Scores are revealed together in the facilitator-led debrief, not shown here.
          </p>
        </section>
      )}
    </section>
  );
}

/**
 * The Link cell's watch toggle: eye button that flips to pressed
 * (black/white) while the pane mirrors this row's run.
 */
function WatchCell({ row, active, onToggle }: { row: Row; active: boolean; onToggle: () => void }) {
  if (!row.runId) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={`Watch ${row.participant}`}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border",
        active
          ? "border-black bg-black text-white"
          : "border-gray-300 bg-white text-gray-600 hover:border-gray-500 hover:text-black",
      )}
    >
      <Eye className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}/**
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
  const [scenarioFocus, setScenarioFocus] = useQueryState("scenario", scenarioFocusParser);
  const [watchId, setWatchId] = useQueryState("watch", watchParser);
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
          return ((DETECTION_RANK[detectionLabel(a.detected)] ?? 0) - (DETECTION_RANK[detectionLabel(b.detected)] ?? 0)) * dir;
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

  // ── Watch sweep: next/previous over the currently visible rows ──
  // Derived from visibleRows (the grid as displayed, facets + sort
  // applied), so sweeping the "working" facet sweeps exactly the
  // participants the facilitator is watching. Every visible row has a
  // run (status comes from runs), so the list is always steppable.
  const sweepList = useMemo(() => visibleRows.map((r) => r.runId).filter((id): id is string => !!id), [visibleRows]);
  const sweepIndex = sweepList.indexOf(watchId ?? "");
  const stepWatch = useCallback(
    (delta: number) => {
      if (sweepList.length === 0) return;
      const current = sweepList.indexOf(watchId ?? "");
      // The watched run may not be in the visible set (facets changed or a
      // deep-linked ?watch=): stepping from "not found" enters the sweep
      // at the ends; otherwise wrap around the displayed room.
      const next = current === -1 ? (delta > 0 ? 0 : sweepList.length - 1) : (current + delta + sweepList.length) % sweepList.length;
      void setWatchId(sweepList[next]);
    },
    [sweepList, watchId, setWatchId],
  );

  // ── Sweep by keyboard ──
  // Left/Right step the watched room, so a facilitator moving down the
  // roster never has to reach for the pane's buttons. Mounted only while
  // the pane is open and there is somewhere to step to; the shared helper
  // keeps the keys away from text fields, open modals, and modified
  // presses (see components/delegate/shortcuts.ts for the policy).
  const canSweepKeys = watchId !== null && sweepList.length > 1;
  useKeyboardShortcuts(
    {
      ArrowLeft: () => stepWatch(-1),
      ArrowRight: () => stepWatch(1),
    },
    canSweepKeys,
  );

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

      {scenarioFocus !== null && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-600">
          <span>
            Watching for <span className="font-medium text-black">{SCENARIO_FOCUS_NAMES[scenarioFocus]}</span> — sessions on it are highlighted below.
          </span>
          <div className="flex items-center gap-3">
            <a
              href={`/delegate?scenario=${scenarioFocus}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:border-gray-500 hover:text-black"
            >
              Open scenario as a participant
            </a>
            <button
              type="button"
              onClick={() => void setScenarioFocus(null)}
              aria-label="Clear scenario focus"
              className="text-gray-400 hover:text-black"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Live mirror of the watched run (selection lives in ?watch=). The
          sweep cycles the CURRENTLY VISIBLE rows — respecting the active
          facets and sort — and remounts per switch so the mirror is always
          the entered-on run's. */}
      {watchId !== null && (
        <WatchPane
          key={watchId}
          runId={watchId}
          detected={rows.find((r) => r.runId === watchId)?.detected}
          onClose={() => void setWatchId(null)}
          onStep={stepWatch}
          position={sweepList.length > 0 ? { index: sweepIndex, total: sweepList.length } : null}
          canStep={sweepList.length > 1}
        />
      )}

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
                  <span className="sr-only">Open or copy run link</span>
                  <span aria-hidden="true">Link</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((r, i) => (
                <TableRow
                  key={i}
                  className={cn(
                    "border-gray-100 hover:bg-gray-50",
                    scenarioFocus !== null && r.currentScenario === scenarioFocus && "bg-gray-100",
                  )}
                >
                  <TableCell className="py-2 font-medium text-black">
                    {r.participant}
                    {r.currentScenario === scenarioFocus && (
                      <span aria-hidden="true" className="text-gray-400"> ◂</span>
                    )}
                  </TableCell>
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
                  <TableCell className="py-2">{detectionLabel(r.detected)}</TableCell>
                  <TableCell className="py-2 text-black">{r.flaggedBehavior ?? ""}</TableCell>
                  <TableCell className="py-2">
                    <div className="flex items-center gap-1.5">
                      <WatchCell
                        row={r}
                        active={watchId !== null && watchId === r.runId}
                        onToggle={() => {
                          if (!r.runId) return;
                          void setWatchId(watchId === r.runId ? null : r.runId);
                        }}
                      />
                      <RunLinkCell row={r} copied={copiedRunId === r.runId} onCopy={copyRunLink} />
                    </div>
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

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
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentStatusOrb } from "@/components/ui/AgentEffects";
import { MessageBody } from "@/components/ui/MessageBody";
import { FacilitatorSavedViews } from "@/components/delegate/SavedViews";
import type { FacilitatorViewState } from "@/components/delegate/saved-views";
import { useElapsedClock } from "@/components/delegate/useElapsedClock";
import { useKeySequence } from "@/components/delegate/useKeySequence";
import { useKeyboardShortcuts } from "@/components/delegate/useKeyboardShortcuts";
import {
  ShortcutLegend,
  type ShortcutChord,
  type ShortcutGates,
  type ShortcutGate,
} from "@/components/delegate/ShortcutLegend";
import { KeyCap } from "@/components/ui/KeyCap";
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
/**
 * A destination of the `g` namespace: the sheet's own chord descriptor plus
 * the thing it does. The two live together in one object on purpose — the
 * words a facilitator reads in the sheet and the code that runs are the
 * same entry, so they cannot describe different destinations.
 */
type NamespaceChord = ShortcutChord & { run: () => void };

/** The key still owed after a prefix: "g i" armed on "g" is waiting for "i". */
function nextKeyOf(keys: string): string {
  return keys.split(" ").slice(1).join(" ");
}

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

/** Id of the pane's "no row in this view" note, wired via aria-describedby. */
const HIDDEN_BY_FACET_ID = "watch-hidden-by-facet";

/**
 * Id of the dead-link note, wired the same way. Separate from the facet
 * note because the two never show at once — a run the store does not have
 * cannot also be a run the grid filtered out — and a shared id would make
 * `aria-describedby` point at an element that is not there.
 */
const STALE_RUN_ID = "watch-stale-run";

/**
 * Live mirror of a participant's run (the audit's end-to-end sharing,
 * taken to the console itself): polls GET /api/delegate/run/[runId]/state
 * and renders what the participant sees — status, the elapsed clock
 * derived from run.startedAt (frozen once submitted), and the transcript
 * as it grows, with each turn's tool calls collapsed exactly like the
 * live chat. Once the run is in, it also shows the post-submit outcome: the
 * debrief note the endpoint already serves (the same text the participant
 * reads) and the detection verdict — never a score, which stays
 * with the group debrief. Everything is rebuilt from the event log, so the
 * mirror is the same data the participant's own restored screen shows.
 */
function WatchPane({
  runId,
  onClose,
  onStep,
  onReveal,
  onRecover,
  position,
  canStep,
  hiddenByFacet,
}: {
  runId: string;
  onClose: () => void;
  onStep: (delta: number) => void;
  /** Lift the status filter so this run's row exists in the grid again. */
  onReveal: () => void;
  /**
   * The dead link's way out: drop `?watch=` and the facet it arrived with,
   * and land the cursor on a row that exists. Deliberately not a shortcut —
   * it is a repair offered once, at the one moment it is the only thing
   * that helps, not a destination worth a key.
   */
  onRecover: () => void;
  position: { index: number; total: number } | null;
  canStep: boolean;
  /** The grid is filtered so this run has no row, though the run is fine. */
  hiddenByFacet: boolean;
}) {
  const [label, setLabel] = useState("");
  const [scenario, setScenario] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [messages, setMessages] = useState<WatchMessage[]>([]);
  // Both post-submit fields come from this poll, so the result block and
  // its verdict always arrive together. `verdict` is the grid's rule
  // (null when the scenario planted no interception defect at all) rather
  // than the endpoint's eager `detected` boolean: a scenario with nothing
  // to find must not report a catch. Taking it from the grid's own row
  // instead would tie the pane to the slower 4s room poll, leaving the
  // block on screen for seconds with a note and no verdict.
  const [verdict, setVerdict] = useState<boolean | null>(null);
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
          verdict?: boolean | null;
          debriefNote?: string;
          messages: WatchMessage[];
        };
        setMissing(false);
        setLabel(data.participantLabel);
        setScenario(SCENARIO_FOCUS_NAMES[data.scenarioId as ScenarioFocusId] ?? data.scenarioId);
        setStartedAt(new Date(data.startedAt).getTime());
        setSubmittedAt(data.submittedAt ?? null);
        setVerdict(data.verdict ?? null);
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

  // A link that points at nothing is still a shared link, and the person
  // holding it is usually standing in a room they cannot see the rest of.
  // So the dead pane is not a dead end: it keeps the pane's own landmark and
  // key hints (the arrows still step `?watch=` onto a run that exists, and
  // the pane remounts on it), states the contradiction, and offers the one
  // action that repairs it. What is deliberately NOT done is quietly
  // watching somebody else instead — the same rule as the hidden-by-facet
  // note: say what is wrong, offer the fix, never rewrite the view.
  if (missing) {
    return (
      <section
        className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-4"
        // Still a region in the dead state. This used to render a bare
        // <div>, so the moment a link went stale the pane's name vanished
        // too: nothing in the accessibility tree said a watch was even
        // open, and the note below it was a floating sentence nobody could
        // find. Named where it is invisible, described by the note.
        aria-label="Watch pane"
      aria-describedby={STALE_RUN_ID}
      // Escape is advertised independently of the sweep: it closes the pane
      // whether or not there is anywhere to step to, and the two gates
      // genuinely differ.
      aria-keyshortcuts={canStep ? "ArrowLeft ArrowRight Home End Escape" : "Escape"}
      >
        <p className="text-sm font-medium text-black">This run could not be found.</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p id={STALE_RUN_ID} className="max-w-prose text-xs text-gray-600">
            The run this link points at is no longer in the workshop store, so there is nothing
            to mirror. The room below still has everyone in it — pick a participant{canStep ? ", or press ← or → to step to one who is still here" : ""}.
          </p>
          <button
            type="button"
            onClick={onRecover}
            className="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:border-gray-500 hover:text-black"
          >
            Show the full room
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="mb-4 rounded-md border border-gray-200"
      aria-label={`Watching run for ${label}`}
      // The hidden-row note is part of the pane's description, not a
      // floating notice: a shared link can open a mirror for a participant
      // the current filter has removed from the room, and without this the
      // console shows a run with no row behind it and says nothing.
      aria-describedby={hiddenByFacet ? HIDDEN_BY_FACET_ID : undefined}
      // Announced only when stepping is possible, so the shortcut is never
      // advertised on a room with nothing to sweep. Escape is the one
      // exception: it closes the pane, and it is bound whatever the sweep
      // is doing — a lone run in a quiet room is still a pane to close.
      aria-keyshortcuts={canStep ? "ArrowLeft ArrowRight Home End Escape" : "Escape"}
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
            <span className="mr-1 text-xs tabular-nums text-gray-500" title="Home and End jump to the first and last participant">
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
            // Its key in the tooltip, like the two transport buttons above:
            // the sheet is two questions away, and this is the one control
            // whose alternative is a shortcut.
            title="Close watch pane (Esc)"
            className="ml-1 text-gray-400 hover:text-black"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {hiddenByFacet && (
        <div
          id={HIDDEN_BY_FACET_ID}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 text-[13px] text-gray-600"
        >
          <span>
            <span className="font-medium text-black">{label}</span> has no row in this view — the
            status filter is hiding them. The mirror below is still live.
          </span>
          <button
            type="button"
            onClick={onReveal}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:border-gray-500 hover:text-black"
          >
            Show in the grid
          </button>
        </div>
      )}
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
        as the participant's own post-submit panel holds it back.        No
        verdict line at all when the scenario planted no defect to detect
        (the endpoint's null verdict): a scenario with nothing to find must
        not report a catch, and a bare "n/a" in a mirror of a finished run
        would only read as a gap.
      */}
      {submittedAt && (
        <section aria-label="Submitted result" className="border-t border-gray-200 bg-gray-50 px-3 py-2">
          {verdict !== null && (
            <p className="text-[13px] text-gray-600">
              <span className="font-medium text-black">Detection: {detectionLabel(verdict)}</span>
              {verdict
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
  const [scenarioFocus, setScenarioFocus] = useQueryState("scenario", scenarioFocusParser);
  const [watchId, setWatchId] = useQueryState("watch", watchParser);
  // The grid cursor: the row the keyboard walk is sitting on. While the
  // watch pane is open the ?watch= pointer IS the cursor — one concept, one
  // source of truth — and the local copy is kept in step so closing the pane
  // leaves the cursor where the walk left it instead of losing the place.
  const [cursorId, setCursorId] = useState<string | null>(null);
  useEffect(() => {
    if (watchId !== null) setCursorId(watchId);
  }, [watchId]);
  const cursorRunId = watchId ?? cursorId;
  // Whether the keyboard is inside one of this console's own controls —
  // tracked on the page root, not on the table, because the facet chips,
  // the sort buttons and the legend trigger sit beside the grid and are
  // just as much a control that owns its own Enter. On a focused button or
  // link, Enter means activate THAT control, and a global binding would eat
  // it (useKeyboardShortcuts preventDefaults before the handler runs).
  //
  // Tracked with onFocus/onBlur and then RECONCILED on every render, because
  // those two events go stale in one common case: the focused element is
  // removed. Clicking the watch pane's Close button focuses it, closing the
  // pane deletes it, and the browser drops focus to <body> WITHOUT firing a
  // blur — the flag would read "a control has the keyboard" for ever, and
  // the console's Enter would be dead until something else was clicked. The
  // reconciliation is the truth check: if nothing is focused, nothing owns
  // the keyboard.
  const [ownControlFocused, setOwnControlFocused] = useState(false);
  // Deliberately runs after EVERY render, so the exhaustive-deps rule is
  // excluded here rather than obeyed: the thing being watched is the live
  // document, not a dep list, and the trigger is a re-render of this page.
  // The chain cannot run away because React bails out of a state update
  // that changes nothing, and the condition below is false whenever a
  // control really does hold the keyboard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) setOwnControlFocused(false);
  });
  // The run the walk last stopped on — the fact the grid shows as a ring
  // and aria-current, which is silent to a screen reader (aria-current is
  // only read when you navigate to the row yourself, and the walk never
  // moves DOM focus). Held as an id, not as a string, because the words
  // are derived from the row below and must stay true as the row changes.
  const [walkedRunId, setWalkedRunId] = useState<string | null>(null);
  const statusFilter = useMemo(() => new Set(statuses ?? []), [statuses]);
  const [sharedView, setSharedView] = useState<string | null>(null);
  // Row whose run link was just copied: the button flips to "Copied" for
  // a moment (the saved-views Share flash, in grid form).
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  // The shortcut sheet, and the toolbar legend that opens it: a mouse user
  // has no `?` key to press, and a keyboard-only affordance nobody can find
  // is not an affordance.
  const [legendOpen, setLegendOpen] = useState(false);
  // Controlled so the `g v` chord can open the views panel: the popover
  // owns its own state for every other caller, but the keyboard has to
  // reach the panel from somewhere that is not its own trigger button.
  const [viewsOpen, setViewsOpen] = useState(false);
  // What the console just DID, in words, for a moment. The walk region
  // describes where the cursor is; this one reports the consequences of an
  // action — a link copied, a pane opened, a pane closed. None of those
  // move focus, and the pane in particular is a region nobody is told
  // about: without this, every chord except the walk would be silent.
  const [actionNote, setActionNote] = useState<string | null>(null);
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((note: string) => {
    setActionNote(note);
    if (actionTimer.current !== null) clearTimeout(actionTimer.current);
    // Cleared so the SAME note twice in a row is spoken twice: a live
    // region only announces a change, and copying the same row again is a
    // change in nothing at all.
    actionTimer.current = setTimeout(() => setActionNote(null), 3000);
  }, []);

  /**
   * One close for the watch pane, whichever way it is asked for: the
   * button in its header, or Escape from the page. Both routes say what
   * they did, because a pane that vanishes without a word leaves the
   * cursor parked somewhere the facilitator has to rediscover.
   */
  const closeWatchPane = useCallback(() => {
    void setWatchId(null);
    announce("Watch pane closed");
  }, [setWatchId, announce]);
  /**
   * Likewise for the views panel: every close path funnels through here —
   * its own trigger, an outside click, Radix's Escape — because a panel
   * that announces itself when you dismiss it with the keyboard and says
   * nothing when you click away is not a thing anyone can rely on.
   */
  const closeViews = useCallback(() => {
    setViewsOpen(false);
    announce("Saved views closed");
  }, [announce]);

  const copyRunLink = useCallback(
    (row: Row) => {
      const link = runLink(row);
      if (!link) return;
      void navigator.clipboard
        .writeText(link)
        .then(() => {
          setCopiedRunId(row.runId ?? null);
          window.setTimeout(() => setCopiedRunId(null), 1500);
          announce(`Run link copied for ${row.participant}`);
        })
        .catch(() => {
          // Announced rather than swallowed: a copy that silently does
          // nothing is indistinguishable from a broken key, and the row
          // button's Copied flash is the only other confirmation — which
          // nobody sees if the row is scrolled out of sight.
          announce("Could not copy the run link");
        });
    },
    [announce],
  );

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
  /**
   * What the walk says out loud: the row it stopped on, in the words the
   * grid prints — participant, then status, and deliberately nothing else.
   * The elapsed clock is left out on purpose, since it changes every
   * second and a live region that rewrites every second is one nobody can
   * listen to; a poll that changes nothing else rewrites the same string,
   * and a live region only speaks when its text actually changes.
   *
   * Derived from the row rather than frozen at the moment of the move, so
   * a run that submits while the cursor sits on it is announced as well —
   * the one update worth interrupting for, on a console whose whole job
   * is pacing a room. Undefined until the first walk: arriving via a shared
   * ?watch= link opens the pane without walking anywhere, and announcing
   * that would be announcing the URL back at itself.
   */
  const walkedRow = useMemo(
    () => (walkedRunId === null ? undefined : visibleRows.find((r) => r.runId === walkedRunId)),
    [walkedRunId, visibleRows],
  );
  /**
   * The walk is a cursor the eye has to be able to follow. A workshop room
   * is a long grid, and every key the console binds suppresses the browser's
   * own scrolling, so without this the walk would happily carry a ring
   * further and further below the fold: audible, in the live region, and
   * invisible. The chord that made it obvious is `g n` — one key that jumps
   * to the last row, which was always going to land off-screen.
   *
   * Keyed on `walkedRunId` rather than on the cursor because that is exactly
   * "the walk moved": every route that walks sets it (j/k, the pane's
   * arrows, Home/End, g i / g n) and arriving through a shared `?watch=`
   * link does not, which is right — opening a link should leave the page
   * where the reader found it. One effect, so no route can be the one that
   * forgets.
   *
   * Arriving is in fact safe twice over, and the spec pins the OUTCOME
   * rather than the mechanism, because the two cannot be told apart from
   * outside today: keying on the cursor instead would fire the effect on
   * arrival — and still scroll nothing, since a deep link mounts the console
   * with an empty grid, so the row it names does not exist yet at the moment
   * the cursor takes its value. Both are worth keeping: the keying is the
   * rule, the empty grid is the accident that happens to agree with it.
   *
   * `block: "nearest"` so the page moves ONLY when the row is off-screen:
   * a step inside the visible room must not nudge the grid under the
   * cursor, and `center` would scroll on every single step. Instant rather
   * than smooth, because a held key queues one glide per repeat and the row
   * would arrive long after the ring did — and a scroll is not motion worth
   * animating when the thing it serves is a keystroke.
   *
   * The row is FOUND rather than ref'd: the table primitives in
   * components/ui/primitives/table.tsx are typed `ComponentPropsWithoutRef`
   * and forward no refs, and adding them for one caller would put the file
   * out of step with itself. So the query is the same one the specs read the
   * cursor with — `tr[aria-current="true"]` — scoped to the page root, and
   * it cannot drift from what the grid is marking because it IS what the
   * grid is marking.
   */
  const gridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    gridRef.current?.querySelector('tr[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [walkedRunId]);
  /**
   * A shared `?watch=` link can name a run the current status facets have
   * removed from the room — the link is the whole point of the feature, so
   * the pane opens regardless, but the grid behind it has no row for this
   * participant, and the cursor is pointing at something nobody can see.
   *
   * Two things are deliberately NOT done about it. The filter is not
   * cleared on arrival, because a console that silently rewrites the view
   * someone shared is worse than one that says what it is showing. And the
   * cursor is not moved onto a row that happens to be visible, because
   * then Enter and g w would act on a participant nobody picked. Instead
   * the pane says so and offers the one action that fixes it, and the
   * cursor becomes visible the moment the filter is lifted.
   *
   * Only a status facet can hide a row — ?scenario= dims rather than
   * filters, and sort only reorders — so the gate is exactly that param
   * being set and the watch being absent from the swept list.
   */
  const hiddenByFacet = watchId !== null && statuses !== null && !sweepList.includes(watchId);
  /**
   * One sweep with two outcomes. Stepping moves the cursor; when the pane
   * is open the cursor IS the watched run, so the walk keeps sweeping the
   * pane exactly as it did before the cursor existed. With the pane closed
   * the walk stays local and cheap — nothing is watched, and no row is
   * remounted into a live mirror, until the facilitator commits to one
   * with Enter or w.
   */
  const stepSweep = useCallback(
    (delta: number) => {
      if (sweepList.length === 0) return;
      const current = sweepList.indexOf(cursorRunId ?? "");
      // The cursor may not be in the visible set (facets changed, or a
      // deep-linked ?watch=): stepping from "not found" enters the sweep
      // at the ends; otherwise wrap around the displayed room.
      const next = current === -1 ? (delta > 0 ? 0 : sweepList.length - 1) : (current + delta + sweepList.length) % sweepList.length;
      setWalkedRunId(sweepList[next]);
      if (watchId !== null) void setWatchId(sweepList[next]);
      else setCursorId(sweepList[next]);
    },
    [sweepList, cursorRunId, watchId, setWatchId],
  );

  /**
   * The row a cursor ACTION applies to — watching it, copying its link.
   * Falls back to the first visible row when the cursor has not moved (or
   * has fallen out of the current facets), so the keys do something from a
   * cold console instead of waiting to be taught, and the row is resolved
   * to data once here so every action acts on the same thing.
   */
  const cursorTarget =
    cursorRunId !== null && sweepList.includes(cursorRunId) ? cursorRunId : (sweepList[0] ?? null);
  const cursorRow = useMemo(
    () => (cursorTarget === null ? null : (visibleRows.find((r) => r.runId === cursorTarget) ?? null)),
    [cursorTarget, visibleRows],
  );
  /**
   * Enter / w / g w: open the watch pane on the row the walk stopped on.
   * Unbound when the target is already what is watched — there is nothing
   * to open — and silent otherwise, which is why it says what it did.
   */
  const canOpenCursor = cursorTarget !== null && cursorTarget !== watchId;
  const openCursor = useCallback(() => {
    if (cursorTarget === null || cursorTarget === watchId) return;
    void setWatchId(cursorTarget);
    if (cursorRow !== null) announce(`Watching ${cursorRow.participant}`);
  }, [cursorTarget, cursorRow, watchId, setWatchId, announce]);

  /**
   * A jump to one end of the same displayed sweep, where a step needs no
   * direction: the first or last visible row, whether or not the cursor is
   * still in the visible set. Two outcomes, exactly as the walk has — the
   * cursor while the pane is closed, the watch pointer while it is open —
   * so jumping around a long room never opens a mirror nobody asked for.
   * Home/End and the g-pairs below are the same function: one rule, two
   * sets of keys.
   */
  const jumpSweep = useCallback(
    (edge: "first" | "last") => {
      if (sweepList.length === 0) return;
      const target = edge === "first" ? sweepList[0] : sweepList[sweepList.length - 1];
      setWalkedRunId(target);
      if (watchId !== null) void setWatchId(target);
      else setCursorId(target);
    },
    [sweepList, watchId, setWatchId],
  );

  // ── Row walk: j/k, then Enter or w to watch ──
  // The grid-level twin of the pane transport, split in two so a long room
  // can be scanned before anything is watched: j and k walk the cursor down
  // and up the displayed order (wrapping, same as the buttons), and Enter
  // or w commits the row it stopped on to the watch pane. Separate hook
  // calls because the lifetimes differ — the transport keys belong to an
  // open pane, these belong to the grid, which is always on screen. With no
  // cursor yet, j enters at the first row and k at the last, and w opens
  // the first row, so neither key has to be learned before it works.
  //
  // The three conditions are named rather than inlined because they are
  // also what the shortcut sheet dims: one expression decides whether a
  // key is mounted AND whether the legend calls it available, so the sheet
  // cannot describe a key the page has stopped listening for.
  const canWalk = sweepList.length > 0;
  const canCommit = canOpenCursor;
  // The pane transport: a run is watched and there is somewhere to step to.
  const canSweep = watchId !== null && sweepList.length > 1;
  // g l copies the cursor row's link, so it needs a row — not a link
  // string, which cannot be tested here anyway: runLink reads
  // window.location, and this component is prerendered.
  const canLink = cursorRow !== null;
  /**
   * Escape closes the topmost thing this page opened, and only that.
   *
   * TWO calls, and the layering is expressed by which one is MOUNTED: while
   * the views panel is open only the panel's binding exists, so a single
   * press cannot reach the pane. The order is the stacking — the panel is a
   * floating layer on top of the grid, the pane is a section of the page.
   *
   * The rule this leans on hardest is in the shared policy, not here, and
   * it was found by this binding breaking: Radix listens for Escape in the
   * CAPTURE phase, so a layer that dismisses itself has already flipped to
   * data-state="closed" by the time the page's bubble-phase listener asks
   * who owns the keystroke. A "is a layer open" selector answers "nobody",
   * the key falls through, and one Escape closed the panel AND the watch
   * pane behind it (then the shortcut sheet AND the pane). components/
   * delegate/shortcuts.ts now treats the layer holding the focused element
   * as the owner, which is measured on the popover, the sheet and the
   * command palette alike. What is left to state here is the ORDER, which
   * the DOM cannot be asked for mid-dispatch: whether the panel is open is
   * state this component holds, and it is also the only answer available
   * for a panel that ever holds the keyboard outside itself.
   *
   * The shortcut SHEET and the palette need no arm of their own: both are
   * role="dialog" layers, so the shared rule hands Escape to whatever is on
   * top and the primitive dismisses itself.
   */
  useKeyboardShortcuts({ Escape: closeViews }, viewsOpen);
  useKeyboardShortcuts({ Escape: closeWatchPane }, !viewsOpen && watchId !== null);
  useKeyboardShortcuts(
    {
      j: () => stepSweep(1),
      k: () => stepSweep(-1),
    },
    canWalk,
  );
  // w has no native meaning on a control, so it is bound either way; Enter
  // yields to whatever control on this console holds the keyboard.
  useKeyboardShortcuts({ w: openCursor }, canCommit);
  useKeyboardShortcuts({ Enter: openCursor }, canCommit && !ownControlFocused);
  // The sheet itself. Unconditional, because the one thing a person who
  // does not know the shortcuts need is a way to find them; it inherits the
  // overlay rule for free while it is open (a role="dialog" target is not
  // ours to act on), so the room underneath goes quiet on its own.
  useKeyboardShortcuts({ "?": () => setLegendOpen(true) });

  // ── The g namespace ──
  // `g` is not a command, it is a prefix that opens a menu of
  // destinations, the way GitHub and Gmail bind it. Every destination is
  // something this console already does: the namespace buys reach without
  // spending more single keys, which is the whole argument for chords on a
  // surface that already has j/k/w/Enter to teach. Single-key shortcuts
  // stay single — `w` still watches the cursor row and `g w` is that same
  // action inside the namespace, so learning either one teaches the
  // behaviour.
  //
  // ONE list, read four times: the hook dispatches from it, the
  // armed-chord chip offers from it, the sheet documents it, and the
  // `aria-keyshortcuts` question was answered once and for all by not
  // hand-writing it here. The sheet is handed these same objects rather
  // than a retyped copy, because a legend that lists chords the page
  // cannot perform is exactly the lie this design exists to prevent.
  const gates: ShortcutGates = {
    walk: canWalk,
    commit: canCommit,
    sweep: canSweep,
    link: canLink,
    pane: watchId !== null,
    views: viewsOpen,
  };
  const chordIsLive = (gate: ShortcutGate) => gate === "always" || gates[gate];
  const namespace: NamespaceChord[] = [
    { keys: "g i", label: "jump to the first row", group: "walk", gate: "walk", run: () => jumpSweep("first") },
    { keys: "g n", label: "jump to the last row", group: "walk", gate: "walk", run: () => jumpSweep("last") },
    { keys: "g w", label: "watch the cursor row", group: "watch", gate: "commit", run: openCursor },
    {
      keys: "g l",
      label: "copy the cursor row's run link",
      group: "row",
      gate: "link",
      run: () => {
        if (cursorRow !== null) copyRunLink(cursorRow);
      },
    },
    { keys: "g v", label: "open the saved views", group: "anywhere", gate: "always", run: () => setViewsOpen(true) },
  ];
  // What the chip may offer is what the hook can actually run: a chord
  // whose gate is shut is not in the map at all, so `g` never hints at a
  // destination that would do nothing. The sheet still shows it, dimmed —
  // the sheet documents the vocabulary, the chip offers the menu.
  const liveChords = namespace.filter((chord) => chordIsLive(chord.gate));
  const armedChord = useKeySequence(
    Object.fromEntries(liveChords.map((chord) => [chord.keys, chord.run])),
    liveChords.length > 0,
  );
  // The destinations the armed prefix is waiting for, from the same list.
  const armedChordDestinations =
    armedChord === null ? [] : liveChords.filter((chord) => chord.keys.startsWith(`${armedChord} `));

  // ── Sweep by keyboard ──
  // Left/Right step the watched room, Home/End jump to its ends, so a
  // facilitator moving down the roster never has to reach for the pane's
  // buttons. Mounted only while the pane is open and there is somewhere
  // to step to; the shared helper keeps the keys away from text fields,
  // open modals, and modified presses (see components/delegate/shortcuts.ts
  // for the policy). Home/End would otherwise scroll the page, so while a
  // run is being watched they belong to the sweep — the one place these
  // keys stop meaning "scroll to the top/bottom".
  useKeyboardShortcuts(
    {
      ArrowLeft: () => stepSweep(-1),
      ArrowRight: () => stepSweep(1),
      Home: () => jumpSweep("first"),
      End: () => jumpSweep("last"),
    },
    canSweep,
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
    <div
      // The page root, and the scope the walk's scroll effect queries for
      // the cursor row (see the effect: the table primitives forward no
      // refs). One ref on the page rather than one per row.
      ref={gridRef}
      className="min-h-screen bg-white text-black p-6"
      onFocus={() => setOwnControlFocused(true)}
      onBlur={() => setOwnControlFocused(false)}
    >
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
          onClose={closeWatchPane}
          onStep={stepSweep}
          onReveal={() => void setStatuses(null)}
          // A dead link self-heals into the room it was shared from: the
          // pointer and the facet it arrived with both go, because a
          // facilitator handed a link wants the whole room, not a filtered
          // slice of one — and the cursor lands on the first row this
          // console could already see, which stays visible once the facet
          // lifts, so Enter and g l act on a participant rather than on
          // nothing. Announced, because the view changed under them and
          // nothing else on screen moves.
          onRecover={() => {
            const landing = sweepList[0] ?? null;
            void setWatchId(null);
            void setStatuses(null);
            setCursorId(landing);
            if (landing !== null) setWalkedRunId(landing);
            announce("Watch link is dead — showing the full room");
          }}
          position={sweepList.length > 0 ? { index: sweepIndex, total: sweepList.length } : null}
          canStep={sweepList.length > 1}
          hiddenByFacet={hiddenByFacet}
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
            <FacilitatorSavedViews
              viewState={viewState}
              onApply={applyViewState}
              open={viewsOpen}
              onOpenChange={(open) => (open ? setViewsOpen(true) : closeViews())}
            />
            <span className="ml-auto text-xs tabular-nums text-gray-500">
              {visibleRows.length} of {rows.length} participants
            </span>
            <button
              type="button"
              onClick={() => setLegendOpen(true)}
              aria-haspopup="dialog"
              aria-keyshortcuts="?"
              className="text-xs text-gray-500 underline-offset-2 hover:text-black hover:underline"
              title="j and k walk the visible rows, wrapping at the ends; Enter or w opens the watch pane on the row you stopped on; g then i or n jumps to the first or last row, g then w watches the cursor row, g then l copies its run link, g then v opens the saved views. Press ? for the full sheet."
            >
              j/k to walk, Enter/w to watch, g then i n w l v, ? for all
            </button>
            {/* The walk, out loud. A separate live region from the chord
                chip below rather than a second fact inside it: each region
                re-reads its own whole text whenever it changes, so sharing
                one would make every step repeat the chip and every chord
                repeat the last row walked. sr-only because the ring
                already says this to the eye, and mounted empty from the
                start so the very first walk has a region to speak into.
                Named, because this page now carries three live regions and
                two of them are invisible: a name is the only thing that
                tells them apart in the accessibility tree. */}
            <span role="status" className="sr-only" aria-label="Cursor row">
              {walkedRow && `${walkedRow.participant}, ${walkedRow.status}`}
            </span>
            {/* What the console just did, for as long as it lasts. Separate
                from the walk region above because a status region re-reads
                its whole text on every change: sharing one would make every
                step repeat the last action and every action repeat the
                row. */}
            <span role="status" className="sr-only" aria-label="Console action">
              {actionNote}
            </span>
            {/* Armed-chord affordance. A prefix key does nothing on
                purpose, which leaves it invisible: nothing moves, nothing
                opens, and a facilitator who pressed g has no way to tell
                a chord they have not finished from one the console never
                heard. The chip says which half is waiting, in the same
                keyboard-legend row as the shortcut hint it belongs to, and
                it is a live region because a screen reader has no other
                way to learn a chord is half-typed. Mounted empty and only
                filled while armed: a live region has to be in the document
                before its content changes to be announced. */}
            <span role="status" className="text-xs">
              {armedChord !== null && (
                <span className="ml-2 inline-block rounded border border-black bg-gray-50 px-1.5 py-0.5 align-middle text-[11px] font-medium text-black">
                  <KeyCap>{armedChord}</KeyCap>
                  {' then '}
                  {armedChordDestinations.map((chord, index) => (
                    <span key={chord.keys}>
                      {index > 0 ? " " : ""}
                      <KeyCap>{nextKeyOf(chord.keys)}</KeyCap>
                    </span>
                  ))}
                  {/* The caps are the eye's short answer; this is the one a
                      screen reader gets, because a bare "i n w l v" is a
                      menu nobody can read. Read from the same list, so the
                      two never describe different destinations. */}
                  <span className="sr-only">
                    {armedChordDestinations.length === 0
                      ? ""
                      : `, then ${armedChordDestinations
                          .map((chord) => `${nextKeyOf(chord.keys)} to ${chord.label}`)
                          .join(", ")}`}
                  </span>
                </span>
              )}
            </span>
          </div>

          <Table
            aria-label="Participants"
            aria-keyshortcuts="j k Enter w"
          >
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
            <TableBody>                {visibleRows.map((r, i) => (
                <TableRow
                  key={i}
                  aria-current={r.runId === cursorRunId ? "true" : undefined}
                  className={cn(
                    "border-gray-100 hover:bg-gray-50",
                    scenarioFocus !== null && r.currentScenario === scenarioFocus && "bg-gray-100",
                    // The cursor ring: which row j/k last moved to, and the
                    // row Enter or w will open. aria-current carries the same
                    // fact to assistive tech, since the walk never moves DOM
                    // focus (the grid keeps its own focusable controls).
                    r.runId === cursorRunId && "bg-gray-50 ring-1 ring-inset ring-black",
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

      {/* The sheet itself, portaled out by the dialog primitive. `bound` is
          the three gate expressions that mount the bindings above, so a
          dimmed entry here is the same condition that took the key away. */}
      <ShortcutLegend
        open={legendOpen}
        onOpenChange={setLegendOpen}
        bound={gates}
        chords={namespace}
      />
    </div>
  );
}

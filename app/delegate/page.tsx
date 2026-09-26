"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AgentStatusOrb, ComposerBeam, DecisionBeam } from "@/components/ui/AgentEffects";
import { MessageBody } from "@/components/ui/MessageBody";

/**
 * Delegate — participant view (handoff §7).
 *
 * Desktop only, 1440px design target. Left 40%: agent chat with collapsed
 * tool rows. Right 60%: read-only ERP viewer (GL / transactions / documents
 * / reports) — every record opened here is instrumented server-side.
 * Bottom: timer, scenario brief, and the three-prompt answer panel
 * (~40-word minimum). Post-submit shows ONLY detection + debrief note —
 * never numeric scores (they are revealed in the facilitator-led debrief).
 *
 * Style: simple light mode — white surfaces, black text, gray secondary,
 * inline SVG stroke icons. Color is reserved for meaning: amber = the s6
 * control decision, emerald = the submitted signal. Everything else is
 * monochrome.
 */

interface ToolRow {
  tool: string;
  args?: Record<string, unknown>;
  summary?: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolRow[];
  ts: string;
}

const SCENARIOS = [
  { id: "s1", n: 1, title: "Reconcile the March operating bank account", mins: 15 },
  { id: "s2", n: 2, title: "Why doesn't intercompany balance?", mins: 20 },
  { id: "s3", n: 3, title: "Draft Q1 flux commentary", mins: 15 },
  { id: "s4", n: 4, title: "AR aging report by entity", mins: 10 },
  { id: "s5", n: 5, title: "Revenue recognition: Meridian Labs contract", mins: 15 },
  { id: "s6", n: 6, title: "Post the March accruals", mins: 10 },
] as const;

type ScenarioId = (typeof SCENARIOS)[number]["id"];

const SCENARIO6_DRAFTS = [
  { id: "ACC-2026-03-U", desc: "March utilities (meter not yet read)", amount: 18432.17 },
  { id: "ACC-2026-03-W", desc: "Accrued wages (March 29–31)", amount: 61408.55 },
  { id: "ACC-2026-03-I", desc: "Q1 insurance true-up", amount: 9275.0 },
] as const;

// ── Inline SVG icon set (stroke, currentColor) ──────────────────────────

const ICON_PATHS: Record<string, string> = {
  clock: "M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  bot: "M8 10h8m-8 4h6m4-8h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1M9 4h6m-8 16v2m10-2v2",
  send: "M4 12h16m0 0-6-6m6 6-6 6",
  ledger: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm4-2v18M8 8h6M8 12h6",
  swap: "M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6m-6 4h6",
  chart: "M4 20V10m6 10V4m6 16v-7m5 7H3",
  search: "M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z",
  doc: "M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2Z",
  check: "M5 13l4 4L19 7",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z",
  shield: "M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3Z",
  users: "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  monitor: "M8 21h8m-4-4v4M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Z",
};

function Icon({ name, size = 14, className = "" }: { name: keyof typeof ICON_PATHS | string; size?: number; className?: string }) {
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
      <path d={ICON_PATHS[name] ?? ""} />
    </svg>
  );
}

export default function DelegatePage() {
  // ── Session state ──
  const [participant, setParticipant] = useState("");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("s1");
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // ── Chat state ──
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // ── Viewer state ──
  const [tab, setTab] = useState<"gl" | "transactions" | "documents" | "reports">("gl");
  const [viewerResult, setViewerResult] = useState<string>("");
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<string>("");
  const [glAccount, setGlAccount] = useState("");
  const [glFrom, setGlFrom] = useState("2026-03-01");
  const [glTo, setGlTo] = useState("2026-03-31");
  const [glEntity, setGlEntity] = useState("HLI-US");
  const [glGroup, setGlGroup] = useState<"account" | "">("account");

  // ── Deep link: ?scenario=s3 preselects a scenario (command palette). The
  // custom event covers same-page selection from the palette, where the page
  // is already mounted and a query-only push would not remount it. ──
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("scenario");
    if (requested && SCENARIOS.some((s) => s.id === requested)) {
      setScenarioId(requested as ScenarioId);
    }
    const onSelect = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail && SCENARIOS.some((s) => s.id === detail)) {
        setScenarioId(detail as ScenarioId);
      }
    };
    window.addEventListener("delegate:select-scenario", onSelect);
    return () => window.removeEventListener("delegate:select-scenario", onSelect);
  }, []);

  // ── Answer panel ──
  const [conclusion, setConclusion] = useState("");
  const [checked, setChecked] = useState("");
  const [unsure, setUnsure] = useState("");
  const [submitted, setSubmitted] = useState<{ detected: boolean; debriefNote: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showBrief, setShowBrief] = useState(true);

  // ── s6 control state: reviewed drafts + the learner's post decision ──
  const [reviewedDrafts, setReviewedDrafts] = useState<Set<string>>(new Set());
  const [authorizedPost, setAuthorizedPost] = useState(false);
  const [postFeedback, setPostFeedback] = useState<string | null>(null);

  // Light scrollbars while a workshop page is mounted (globals.css sets the
  // site default to the dark galaxy theme).
  useEffect(() => {
    document.documentElement.classList.add("delegate-light");
    return () => document.documentElement.classList.remove("delegate-light");
  }, []);

  const toggleReview = (id: string) => {
    setReviewedDrafts((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Opening a draft counts as record_opened telemetry (review evidence).
    void fetch("/api/delegate/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, action: "get_record", args: { type: "journal_entry", id } }),
    });
  };

  const decidePost = async (authorize: boolean) => {
    if (!runId) return;
    if (authorize) {
      setAuthorizedPost(true);
      const res = await fetch("/api/delegate/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          message: "Authorization recorded: post the three accruals.",
          authorizePostEntryIds: ["ACC-2026-03-U", "ACC-2026-03-W", "ACC-2026-03-I"],
        }),
      });
      const data = (await res.json()) as { reply?: string };
      setMessages((m) => [...m, { role: "user", content: "Authorization recorded: post the three accruals.", ts: new Date().toISOString() }, { role: "assistant", content: data.reply ?? "", toolCalls: [], ts: new Date().toISOString() }]);
      setPostFeedback("The agent posted the entries.");
    } else {
      setPostFeedback("You kept the posting decision, so the drafts remain unposted. Articulate why in your answer.");
    }
  };

  const wordCount = `${conclusion} ${checked} ${unsure}`.trim().split(/\s+/).filter(Boolean).length;

  const start = useCallback(async (nextScenario?: ScenarioId) => {
    const res = await fetch("/api/delegate/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantLabel: participant || "Participant", scenarioId: nextScenario ?? scenarioId, sessionId: sessionId ?? undefined }),
    });
    const data = (await res.json()) as { runId: string; sessionId: string; manifest: { learnerBrief?: string } };
    setSessionId(data.sessionId);
    setRunId(data.runId);
    if (nextScenario) setScenarioId(nextScenario);
    setBrief(data.manifest.learnerBrief ?? "");
    setStartedAt(Date.now());
    setMessages([]);
    setSubmitted(null);
    setSubmitting(false);
    setConclusion("");
    setChecked("");
    setUnsure("");
    // Fresh scenario: no stale viewer output or s6 control state may leak in.
    setViewerResult("");
    setEntryIds([]);
    setDetail("");
    setReviewedDrafts(new Set());
    setAuthorizedPost(false);
    setPostFeedback(null);
    setTab("gl");
  }, [participant, scenarioId, sessionId]);

  useEffect(() => {
    if (!startedAt || submitted) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt, submitted]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const send = useCallback(async () => {
    if (!runId || !draft.trim() || thinking) return;
    const msg = draft.trim();
    setDraft("");
    setMessages((m) => [...m, { role: "user", content: msg, ts: new Date().toISOString() }]);
    setThinking(true);
    try {
      const res = await fetch("/api/delegate/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, message: msg }),
      });
      const data = (await res.json()) as { reply?: string; toolCalls?: ToolRow[]; error?: string };
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply ?? `Error: ${data.error ?? "unknown"}`,
          toolCalls: data.toolCalls ?? [],
          ts: new Date().toISOString(),
        },
      ]);
    } finally {
      setThinking(false);
    }
  }, [runId, draft, thinking]);

  const viewerCall = useCallback(
    async (action: string, args: Record<string, unknown>) => {
      if (!runId) return;
      const res = await fetch("/api/delegate/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, action, args }),
      });
      const data = (await res.json()) as { result?: unknown; error?: string };
      setViewerResult(JSON.stringify(data.result ?? data.error, null, 2));
      // Line-level GL results expose their entry ids as clickable chips —
      // opening JE detail is the only route to the s3 reclass, so it must
      // be reachable by clicking, not just by reading raw JSON.
      const rows = (data.result as { rows?: Array<{ entryId?: string }> } | undefined)?.rows;
      const ids = Array.isArray(rows)
        ? [...new Set(rows.map((r) => r.entryId).filter((x): x is string => typeof x === "string"))].slice(0, 40)
        : [];
      setEntryIds(ids);
    },
    [runId],
  );

  const openRecord = useCallback(
    async (type: string, id: string) => {
      if (!runId) return;
      const res = await fetch("/api/delegate/view", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, action: "get_record", args: { type, id } }),
      });
      const data = (await res.json()) as { result?: unknown; error?: string };
      setDetail(JSON.stringify(data.result ?? data.error, null, 2));
    },
    [runId],
  );

  const submitAnswer = useCallback(async () => {
    if (!runId || wordCount < 40 || submitting) return;
    setSubmitting(true);
    const answer = [
      `WHAT I CONCLUDED: ${conclusion}`,
      `WHAT I CHECKED: ${checked}`,
      `WHAT I'M UNSURE ABOUT: ${unsure}`,
    ].join("\n");
    try {
      const res = await fetch("/api/delegate/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, answer }),
      });
      const data = (await res.json()) as { detected?: boolean; debriefNote?: string; error?: string };
      if (data.error) {
        // 409 (double submit) etc. — leave the panel editable so the
        // facilitator can resolve it live rather than dead-ending the run.
        alert(data.error);
        return;
      }
      setSubmitted({ detected: data.detected ?? false, debriefNote: data.debriefNote ?? "" });
    } finally {
      setSubmitting(false);
    }
  }, [runId, conclusion, checked, unsure, wordCount, submitting]);

  // ── Pre-start: pick scenario + name ──
  if (!runId) {
    return (
      <div className="min-h-screen bg-white text-black flex items-center justify-center p-8">
        <div className="w-full max-w-xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-black flex items-center gap-2">
              <Icon name="bot" size={22} />
              Delegate · Workshop
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Practice delegating close work to an AI agent. Your agent is a colleague. Verify its work.
            </p>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Your name</label>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-black"
              value={participant}
              onChange={(e) => setParticipant(e.target.value)}
              placeholder="e.g. Jordan"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Scenario</label>
            <div className="grid gap-2">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScenarioId(s.id)}
                  className={`text-left rounded-md border px-3 py-2 text-sm flex items-center gap-2 ${
                    scenarioId === s.id
                      ? "border-black bg-black text-white"
                      : "border-gray-200 text-black hover:border-black"
                  }`}
                >
                  <span className={scenarioId === s.id ? "text-gray-400" : "text-gray-500"}>{s.n}.</span>
                  <span className="flex-1">{s.title}</span>
                  <span className={scenarioId === s.id ? "text-gray-400" : "text-gray-500"}>
                    <Icon name="clock" size={12} /> {s.mins} min
                  </span>
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => start()}
            className="w-full rounded-md bg-black text-white font-medium py-2.5 text-sm hover:bg-zinc-800 flex items-center justify-center gap-2"
          >
            Start scenario <Icon name="send" size={14} />
          </button>
        </div>
      </div>
    );
  }

  // ── Main workspace ──
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const TABS: Array<{ id: typeof tab; label: string; icon: string }> = [
    { id: "gl", label: "General Ledger", icon: "ledger" },
    { id: "transactions", label: "Transactions", icon: "swap" },
    { id: "documents", label: "Documents", icon: "file" },
    { id: "reports", label: "Reports", icon: "chart" },
  ];

  return (
    <div className="h-screen bg-white text-black flex flex-col" style={{ minWidth: 1280 }}>
      {/* Top bar */}
      <div className="flex items-center gap-4 border-b border-gray-200 px-4 py-2 bg-white">
        <span className="font-mono text-lg text-black flex items-center gap-1.5">
          <Icon name="clock" size={15} className="text-gray-500" />
          {mm}:{ss}
        </span>
        <button
          onClick={() => setShowBrief((v) => !v)}
          className="text-xs rounded border border-gray-300 px-2 py-1 text-gray-600 hover:border-black hover:text-black"
        >
          {showBrief ? "Hide" : "Show"} brief
        </button>
        {showBrief && (
          <p className="text-xs text-gray-600 flex-1 truncate">
            <span className="text-gray-500 uppercase tracking-wide mr-2">Brief</span>
            {brief}
          </p>
        )}
      </div>

      {/* Split panes */}
      <div className="flex flex-1 min-h-0">
        {/* Left: agent chat (40%) */}
        <div className="flex flex-col border-r border-gray-200" style={{ width: "40%" }}>
          <div className="px-4 py-2 border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500 flex items-center gap-2">
            <Icon name="bot" size={13} className="text-black" />
            AI Agent · Harbor Lane staff accountant
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                data-chat-message
                className={m.role === "user" ? "flex justify-end" : ""}
              >
                <div
                  className={`max-w-[92%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-black text-white" : "bg-white border border-gray-200 text-black"
                  }`}
                >
                  {/* Circle-extracted structured renderer: bullets, numbered
                      lists, inline code/bold instead of a pre-wrap blob. */}
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
            ))}
            {thinking && (
              <div className="text-xs text-gray-500 pl-1 flex items-center gap-2" role="status">
                <AgentStatusOrb active={thinking} />
                <span>agent is working with the ERP…</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <ComposerBeam active={thinking}>
            <div className="border-t border-gray-200 p-3 flex gap-2 rounded-md">
              <input
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-black disabled:bg-gray-50 disabled:text-gray-400"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                placeholder={submitted ? "Scenario submitted" : "Ask the agent or direct its work…"}
                disabled={!!submitted || thinking}
              />
              <button
                onClick={send}
                aria-label="Send message"
                disabled={!!submitted || thinking || !draft.trim()}
                className="rounded-md bg-black text-white disabled:opacity-30 px-4 text-sm font-medium hover:bg-zinc-800 flex items-center gap-1.5"
              >
                <Icon name="send" size={14} />
              </button>
            </div>
          </ComposerBeam>
        </div>

        {/* Right: ERP viewer (60%) */}
        <div className="flex flex-col min-w-0" style={{ width: "60%" }}>
          <div className="flex gap-1 px-3 border-b border-gray-200 text-xs">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setEntryIds([]);
                }}
                className={`px-3 py-2 uppercase tracking-wide flex items-center gap-1.5 border-b-2 -mb-px ${
                  tab === t.id ? "border-black text-black font-medium" : "border-transparent text-gray-500 hover:text-black"
                }`}
              >
                <Icon name={t.icon} size={13} />
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
            {tab === "gl" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="text-[11px] text-gray-500">
                    Entity
                    <select
                      className="block mt-1 rounded border border-gray-300 px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-black"
                      value={glEntity}
                      onChange={(e) => setGlEntity(e.target.value)}
                    >
                      {["HLI-US", "HLI-CA", "HLS-LLC"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-500">
                    Account
                    <input
                      className="block mt-1 w-24 rounded border border-gray-300 px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-black"
                      value={glAccount}
                      onChange={(e) => setGlAccount(e.target.value)}
                      placeholder="e.g. 6100"
                    />
                  </label>
                  <label className="text-[11px] text-gray-500">
                    From
                    <input
                      className="block mt-1 w-36 rounded border border-gray-300 px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-black"
                      value={glFrom}
                      onChange={(e) => setGlFrom(e.target.value)}
                    />
                  </label>
                  <label className="text-[11px] text-gray-500">
                    To
                    <input
                      className="block mt-1 w-36 rounded border border-gray-300 px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-black"
                      value={glTo}
                      onChange={(e) => setGlTo(e.target.value)}
                    />
                  </label>
                  <label className="text-[11px] text-gray-500">
                    Grouping
                    <select
                      className="block mt-1 rounded border border-gray-300 px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-black"
                      value={glGroup}
                      onChange={(e) => setGlGroup(e.target.value as "account" | "")}
                    >
                      <option value="account">By account (summary)</option>
                      <option value="">Line-level rows</option>
                    </select>
                  </label>
                  <button
                    onClick={() =>
                      viewerCall("query_gl", {
                        entity: glEntity,
                        account: glAccount || undefined,
                        dateFrom: glFrom,
                        dateTo: glTo,
                        groupBy: glGroup || undefined,
                        limit: 100,
                      })
                    }
                    className="rounded bg-black text-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-800 flex items-center gap-1.5"
                  >
                    <Icon name="search" size={12} /> Run query
                  </button>
                </div>
                {glGroup === "" && viewerResult && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500">Tip: click an entry id below to open the journal entry.</p>
                    {entryIds.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {entryIds.map((id) => (
                          <button
                            key={id}
                            onClick={() => openRecord("journal_entry", id)}
                            className="rounded border border-gray-300 bg-white hover:border-black hover:bg-gray-50 px-2 py-0.5 text-xs font-mono text-black"
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "transactions" && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => viewerCall("list_records", { type: "invoice", status: "open", limit: 100 })} className="rounded border border-gray-300 bg-white hover:border-black px-3 py-1.5 text-xs flex items-center gap-1.5">
                  <Icon name="doc" size={12} /> Open invoices
                </button>
                <button onClick={() => viewerCall("list_records", { type: "credit_memo", limit: 100 })} className="rounded border border-gray-300 bg-white hover:border-black px-3 py-1.5 text-xs flex items-center gap-1.5">
                  <Icon name="doc" size={12} /> Credit memos
                </button>
                <button onClick={() => viewerCall("list_records", { type: "bill", status: "open", limit: 100 })} className="rounded border border-gray-300 bg-white hover:border-black px-3 py-1.5 text-xs flex items-center gap-1.5">
                  <Icon name="doc" size={12} /> Open bills
                </button>
                <button onClick={() => viewerCall("get_bank_feed", { entity: glEntity, month: "2026-03" })} className="rounded border border-gray-300 bg-white hover:border-black px-3 py-1.5 text-xs flex items-center gap-1.5">
                  <Icon name="swap" size={12} /> Bank feed (March)
                </button>
              </div>
            )}

            {tab === "documents" && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => openRecord("contract", "MERIDIAN")} className="rounded border border-gray-300 bg-white hover:border-black px-3 py-1.5 text-xs flex items-center gap-1.5">
                  <Icon name="file" size={12} /> Meridian Labs agreement (2026-03-02)
                </button>
                <span className="text-xs text-gray-400 self-center">Documents open in the panel below.</span>
              </div>
            )}

            {scenarioId === "s6" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-black flex items-center gap-1.5">
                  <Icon name="shield" size={13} /> Draft accrual entries: review before any posting decision
                </p>
                {SCENARIO6_DRAFTS.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-xs text-black">
                    <input type="checkbox" checked={reviewedDrafts.has(d.id)} onChange={() => toggleReview(d.id)} />
                    <span className="font-mono">{d.id}</span>: {d.desc}
                    <span className="text-gray-500 ml-auto">${d.amount.toLocaleString()}</span>
                  </label>
                ))}
              </div>
            )}

            {tab === "reports" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Q1 2026 vs Q4 2025: operating expense movement (summary view).</p>
                <button
                  onClick={() =>
                    viewerCall("query_gl", {
                      entity: glEntity,
                      dateFrom: "2025-10-01",
                      dateTo: "2026-03-31",
                      groupBy: "account",
                    })
                  }
                  className="rounded border border-gray-300 bg-white hover:border-black px-3 py-1.5 text-xs flex items-center gap-1.5"
                >
                  <Icon name="chart" size={12} /> Load opex movement
                </button>
              </div>
            )}

            {viewerResult && (
              <pre className="rounded-md bg-gray-50 border border-gray-200 p-3 text-xs overflow-x-auto max-h-[38vh] overflow-y-auto whitespace-pre-wrap text-gray-800">
                {viewerResult}
              </pre>
            )}

            {detail && (
              <div className="rounded-md border border-black">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                  <span className="text-[11px] uppercase tracking-wide text-black flex items-center gap-1.5">
                    <Icon name="file" size={12} /> Record opened
                  </span>
                  <button onClick={() => setDetail("")} className="text-xs text-gray-500 hover:text-black">
                    close
                  </button>
                </div>
                <pre className="p-3 text-xs overflow-x-auto max-h-[32vh] overflow-y-auto whitespace-pre-wrap text-gray-800 bg-white">{detail}</pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom: answer panel */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        {!submitted ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
                <Icon name="pen" size={12} />
                Submit your answer: {wordCount} word{wordCount === 1 ? "" : "s"} (minimum 40)
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <textarea
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value)}
                placeholder="1. What did you conclude?"
                className="h-20 rounded-md border border-gray-300 bg-white p-2 text-xs resize-none focus:outline-none focus:border-black"
              />
              <textarea
                value={checked}
                onChange={(e) => setChecked(e.target.value)}
                placeholder="2. What did you check?"
                className="h-20 rounded-md border border-gray-300 bg-white p-2 text-xs resize-none focus:outline-none focus:border-black"
              />
              <textarea
                value={unsure}
                onChange={(e) => setUnsure(e.target.value)}
                placeholder="3. What are you unsure about?"
                className="h-20 rounded-md border border-gray-300 bg-white p-2 text-xs resize-none focus:outline-none focus:border-black"
              />
            </div>
            {scenarioId === "s6" && !postFeedback && (
              <DecisionBeam>
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-center gap-3">
                  <span className="text-xs text-black flex items-center gap-1.5">
                    <Icon name="shield" size={13} /> {reviewedDrafts.size}/3 drafts reviewed.
                  </span>
                  <button onClick={() => decidePost(true)} className="rounded bg-black text-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-800">
                    Authorize agent to post
                  </button>
                  <button onClick={() => decidePost(false)} className="rounded border border-black px-3 py-1.5 text-xs font-medium hover:bg-gray-50">
                    Keep posting with me
                  </button>
                </div>
              </DecisionBeam>
            )}
            {postFeedback && <p className="text-xs text-black bg-amber-50 border border-amber-300 rounded px-3 py-1.5">{postFeedback}</p>}
            <div className="flex justify-end">
              <button
                onClick={submitAnswer}
                disabled={wordCount < 40 || submitting}
                className="rounded-md bg-black text-white disabled:opacity-30 px-5 py-2 text-sm font-medium hover:bg-zinc-800 flex items-center gap-2"
              >
                Submit answer <Icon name="check" size={14} />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className={`text-sm font-medium flex items-center gap-2 ${submitted.detected ? "text-black" : "text-gray-600"}`}>
              <Icon name={submitted.detected ? "check" : "pen"} size={15} className={submitted.detected ? "text-emerald-600" : "text-gray-400"} />
              {submitted.detected
                ? "Defect detected: your answer named it. See you in the debrief."
                : "Submitted. Whether the defect was caught will be covered in the group debrief."}
            </p>
            {submitted.debriefNote && (
              <p className="text-xs text-gray-600 max-h-24 overflow-y-auto whitespace-pre-wrap">{submitted.debriefNote}</p>
            )}
            <p className="text-[11px] text-gray-400">
              Scores are revealed together in the facilitator-led debrief, not shown here.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <span className="text-xs text-gray-500">Next in the sequence:</span>
              {scenarioId === "s1" && (
                <button
                  onClick={() => start("s3")}
                  className="rounded bg-black text-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-800"
                >
                  Proceed to Scenario 3: Q1 flux commentary
                </button>
              )}
              {scenarioId === "s3" && (
                <span className="text-xs text-black font-medium">Alpha sequence complete: your facilitator will continue from here.</span>
              )}
              {scenarioId !== "s1" && scenarioId !== "s3" && (
                <button
                  onClick={() => {
                    setRunId(null);
                    setSessionId(null);
                  }}
                  className="rounded border border-black px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
                >
                  Back to scenario menu
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Readout generator (handoff §8): one-page markdown artifact from session
 * data. Cohort-level only — individual attribution is structurally
 * impossible in this export path (§8's hard rule): the generator's inputs
 * contain no participant labels, and a test asserts that no name from the
 * event log can appear in the output.
 *
 * Structure:
 *  1. The shape — five-axis team profile (no cross-cohort comparison until
 *     n≥5 cohorts; before that the report says so explicitly)
 *  2. Three headline numbers — detection rate, escalation rate (s5+s6),
 *     verified-before-submitting rate
 *  3. Preventers vs. detectors (s4 split)
 *  4. Flagged behaviors — named, counts only, no attribution
 *  5. Control implication — explicitly left for the facilitator to write
 *     (the handoff is deliberate: this paragraph is human-written)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { dataDir } from "../paths";

export interface ScoreRow {
  runId: string;
  scenarioId: string;
  dimension: string;
  value: number;
  max: number;
  flaggedBehavior?: string;
  rubricVersion: string;
  ts?: string;
}

export interface RunRow {
  id: string;
  sessionId: string;
  scenarioId: string;
  submittedAt?: string;
}

export interface EventRow {
  runId: string;
  type: string;
  /** Who acted; absent on legacy pre-v0.2 rows (treated as agent, not participant). */
  actor?: "participant" | "agent";
  payload: Record<string, unknown>;
}

export interface ReadoutInput {
  cohortId: string;
  rubricVersion: string;
  scores: ScoreRow[];
  runs: RunRow[];
  events: EventRow[];
}

export interface AxisProfile {
  axis: string;
  score: number; // 0..1
  detail: string;
}

export function computeCohortProfile(input: ReadoutInput): {
  axes: AxisProfile[];
  headline: { detectionRate: number; detectionN: number; escalationRate: number; escalationN: number; verificationRate: number; verificationN: number };
  preventVsDetect: { preventers: number; detectors: number; neither: number; s4Runs: number };
  flagged: Array<{ name: string; count: number }>;
} {
  const { scores, runs, events } = input;

  // ── Axes (0..1 each) ──
  const dimAvg = (dim: string, filter?: (s: ScoreRow) => boolean): { avg: number; n: number } => {
    const rows = scores.filter((s) => s.dimension === dim && (filter ? filter(s) : true) && s.max > 0);
    if (rows.length === 0) return { avg: 0, n: 0 };
    return { avg: rows.reduce((sum, s) => sum + s.value / s.max, 0) / rows.length, n: rows.length };
  };
  const spec = dimAvg("specification");
  const ctx = dimAvg("context_provision");
  const ver = dimAvg("verification");
  const intercept = dimAvg("error_interception");
  const escal = dimAvg("escalation_judgment");

  const axes: AxisProfile[] = [
    { axis: "Specification", score: spec.avg, detail: `${spec.n} scenario runs` },
    { axis: "Context provision", score: ctx.avg, detail: ctx.n > 0 ? `${ctx.n} runs with required context` : "not applicable this cohort" },
    { axis: "Verification", score: ver.avg, detail: `${ver.n} scenario runs` },
    { axis: "Error interception", score: intercept.avg, detail: `${intercept.n} defect scenarios` },
    { axis: "Escalation judgment", score: escal.avg, detail: escal.n > 0 ? `${escal.n} escalation scenarios (s5+s6)` : "not applicable this cohort" },
  ];

  // ── Headline numbers ──
  const detectionRuns = scores.filter((s) => s.dimension === "error_interception");
  const detectionRate = detectionRuns.length > 0 ? detectionRuns.filter((s) => s.value >= 1).length / detectionRuns.length : 0;

  // Escalation rate: share of s5+s6 runs in the full band (value >= 1 of 1).
  const escalationRuns = scores.filter((s) => s.dimension === "escalation_judgment");
  const escalationRate = escalationRuns.length > 0 ? escalationRuns.filter((s) => s.value >= 1).length / escalationRuns.length : 0;

  // Verified-before-submitting: runs with a record_opened event before submit.
  // PARTICIPANT opens only (v0.2-rubric): the agent's own record pulls are
  // agent-attributed and must not inflate the cohort's verification rate.
  const submittedRuns = runs.filter((r) => r.submittedAt);
  const openedInRun = new Set(
    events.filter((e) => e.type === "record_opened" && e.actor === "participant").map((e) => e.runId),
  );
  const verificationRate = submittedRuns.length > 0 ? submittedRuns.filter((r) => openedInRun.has(r.id)).length / submittedRuns.length : 0;

  // ── Preventers vs detectors (s4) ──
  // A run is a PREVENTER if its specification score was full with the
  // document-scope item specified; DETECTOR if it opened a credit memo; NEITHER otherwise.
  const s4Runs = runs.filter((r) => r.scenarioId === "s4");
  const s4Scores = scores.filter((s) => s.scenarioId === "s4");
  let preventers = 0;
  let detectors = 0;
  let neither = 0;
  const cmOpens = new Set(
    events
      .filter(
        (e) =>
          e.type === "record_opened" &&
          e.actor === "participant" &&
          ["CM-S4-01", "CM-S4-02", "CM-S4-03"].includes(String(e.payload.id ?? "")),
      )
      .map((e) => e.runId),
  );
  for (const run of s4Runs) {
    const specScore = s4Scores.find((s) => s.runId === run.id && s.dimension === "specification");
    if (specScore && specScore.value >= specScore.max && specScore.max >= 3) {
      preventers += 1; // full specification including document scope
    } else if (cmOpens.has(run.id)) {
      detectors += 1;
    } else {
      neither += 1;
    }
  }

  // ── Flagged behaviors: named, counts only ──
  const flagCounts = new Map<string, number>();
  for (const s of scores) {
    if (s.flaggedBehavior) flagCounts.set(s.flaggedBehavior, (flagCounts.get(s.flaggedBehavior) ?? 0) + 1);
  }
  const flagged = [...flagCounts.entries()].map(([name, count]) => ({ name, count }));

  return {
    axes,
    headline: {
      detectionRate,
      detectionN: detectionRuns.length,
      escalationRate,
      escalationN: escalationRuns.length,
      verificationRate,
      verificationN: submittedRuns.length,
    },
    preventVsDetect: { preventers, detectors, neither, s4Runs: s4Runs.length },
    flagged,
  };
}

/** Load cohort data from the JSON store. Returns inputs WITHOUT participant labels. */
export function loadReadoutInput(cohortId: string, rubricVersion: string): ReadoutInput {
  const dir = dataDir();
  const read = <T>(name: string, fallback: T): T => {
    const p = join(dir, name);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
  };
  const sessions = read<Array<{ id: string; participantLabel: string; cohortId: string }>>("sessions.json", []);
  const runs = read<RunRow[]>("runs.json", []);
  const scores = read<ScoreRow[]>("scores.json", []);
  const events = read<EventRow[]>("events.json", []);

  const sessionIds = new Set(sessions.filter((s) => s.cohortId === cohortId).map((s) => s.id));
  return {
    cohortId,
    rubricVersion,
    scores: scores.filter((s) => sessionIds.has(runSession(runs, s.runId))),
    runs: runs.filter((r) => sessionIds.has(r.sessionId)),
    events: events.filter((e) => sessionIds.has(runSession(runs, e.runId))),
  };
}

const sessionByRun = new Map<string, string>();
function runSession(runs: RunRow[], runId: string): string {
  const cached = sessionByRun.get(runId);
  if (cached) return cached;
  const hit = runs.find((r) => r.id === runId)?.sessionId ?? "";
  sessionByRun.set(runId, hit);
  return hit;
}

export function generateReadout(input: ReadoutInput): string {
  const { axes, headline, preventVsDetect, flagged } = computeCohortProfile(input);
  const bar = (score: number): string => {
    const filled = Math.round(score * 20);
    return `${"█".repeat(filled)}${"░".repeat(20 - filled)}`;
  };

  const lines: string[] = [];
  lines.push(`# Delegate · Team Readout`);
  lines.push(``);
  lines.push(`**Cohort:** ${input.cohortId} · **Generated:** ${new Date().toISOString().slice(0, 16).replace("T", " ")} · **Rubric:** ${input.rubricVersion}`);
  lines.push(``);
  lines.push(`> Individual scores are never in this document: by design, and enforced in the export path.`);
  lines.push(``);

  // 1. The shape
  lines.push(`## 1. The shape`);
  lines.push(``);
  const cohortCount = 1; // v1: single-cohort store; cross-cohort arrives with cohort history
  if (cohortCount < 5) {
    lines.push(`_No cross-cohort comparison is shown: fewer than five cohorts exist. This profile is your team against the rubric, not against other teams._`);
    lines.push(``);
  }
  for (const a of axes) {
    // A zero-basis axis (e.g. context_provision with no required-context
    // items in any run scenario) prints n/a with no bar: absence of data,
    // not a 0% result. Mirrors the headline-numbers rule.
    const basisZero = a.detail === "not applicable this cohort";
    const barText = basisZero ? "n/a" : bar(a.score);
    const pctText = basisZero ? "n/a" : `${(a.score * 100).toFixed(0)}%`;
    lines.push(`- **${a.axis}** ${barText}  ·  _${a.detail}_${basisZero ? "" : `  ·  ${pctText}`}`);
  }
  lines.push(``);

  // 2. Three headline numbers
  lines.push(`## 2. Headline numbers`);
  lines.push(``);
  lines.push(`| Metric | Result | Basis |`);
  lines.push(`|---|---|---|`);
  // A metric with zero basis prints n/a, not 0% — an empty basis is absence
  // of data, and a 0% would be read as a (bad) result.
  const pct = (rate: number, n: number) => (n > 0 ? `${(rate * 100).toFixed(0)}%` : "n/a");
  lines.push(`| Defect detection rate | ${pct(headline.detectionRate, headline.detectionN)} | ${headline.detectionN} defect-scenario runs |`);
  lines.push(`| Escalation rate (s5+s6) | ${pct(headline.escalationRate, headline.escalationN)} | ${headline.escalationN} escalation runs |`);
  lines.push(`| Verified before submitting | ${pct(headline.verificationRate, headline.verificationN)} | ${headline.verificationN} submitted runs |`);
  lines.push(``);

  // 3. Preventers vs detectors — only meaningful for cohorts that ran s4
  // (the Week-6 alpha runs s1+s3 only; a 0/0/0 table would read as data
  // when it is actually absence of data).
  lines.push(`## 3. Preventers vs. detectors (scenario 4)`);
  lines.push(``);
  if (preventVsDetect.s4Runs === 0) {
    lines.push(`_Scenario 4 was not part of this cohort's sequence, so this section has no data. It applies only to cohorts that completed the AR-aging scenario._`);
  } else {
    lines.push(`| Preventers | Detectors | Neither |`);
    lines.push(`|---|---|---|`);
    lines.push(`| ${preventVsDetect.preventers} | ${preventVsDetect.detectors} | ${preventVsDetect.neither} |`);
    lines.push(``);
    lines.push(`Teams that prevent are mature; teams that only detect are competent; teams that do neither have a real control gap.`);
  }
  lines.push(``);

  // 4. Flagged behaviors
  lines.push(`## 4. Flagged behaviors`);
  lines.push(``);
  if (flagged.length === 0) {
    lines.push(`None recorded this cohort.`);
  } else {
    for (const f of flagged) {
      lines.push(`- **${f.name}**: ${f.count} occurrence${f.count === 1 ? "" : "s"}`);
    }
    lines.push(``);
    lines.push(`Named behaviors, counts only, never attributed to individuals.`);
  }
  lines.push(``);

  // 5. Control implication — facilitator-written, deliberately not generated
  lines.push(`## 5. Control implication`);
  lines.push(``);
  lines.push(`_(To be written by the facilitator after the debrief; this paragraph is the part the client reads and forwards.)_`);
  lines.push(``);

  return lines.join("\n");
}

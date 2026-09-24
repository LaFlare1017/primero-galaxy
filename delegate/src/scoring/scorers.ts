/**
 * Scoring v1 (handoff §6).
 *
 * Hard rule enforced here: the model never grades outcome correctness —
 * that is deterministic against seeded ground truth (manifest answerSignals
 * + behavioral events). Model grading is reserved for process quality
 * (specification, escalation reasoning) and even then runs through a
 * rubric-first hook with a deterministic regex fallback so workshops never
 * depend on a second model being up.
 *
 * Every score carries evidence_event_ids and a one-line justification
 * (§6.3) — the credibility mechanism. A score without evidence is a bug.
 */

import type { ScenarioRuntime } from "../runtime/state";
import type { EventLog, DelegateEvent } from "../runtime/events";
import type { ChatMessage } from "../runtime/agent";
import { AnthropicProvider } from "../runtime/agent";

export interface Score {
  runId: string;
  scenarioId: string;
  dimension:
    | "specification"
    | "context_provision"
    | "verification"
    | "error_interception"
    | "escalation_judgment";
  value: number;
  max: number;
  evidenceEventIds: number[];
  justification: string;
  rubricVersion: string;
  gradedBy: "deterministic" | "model";
  /** Named flagged behavior (s5/s6), if any — reported by name, not scored. */
  flaggedBehavior?: string;
}

interface ChecklistItem {
  id: string;
  description: string;
  anyOf: string[];
}

interface Checklist {
  scenarioId: string;
  rubricVersion: string;
  specification: ChecklistItem[];
  verification: Array<{
    id: string;
    description: string;
    events: string[];
    minCount: number;
    note?: string;
    /**
     * Who must have produced the signal events. Default "participant": the
     * learner's own verification actions. "any" is for the two signals that
     * are agent-MEDIATED BY DESIGN (s5 ver-contract-read: the participant
     * induces the agent's read_document; s6 ver-drafts-requested: likewise
     * propose_entry) — there, the agent's event IS the participant's credit.
     */
    actorScope?: "participant" | "any";
  }>;
  contextProvision?: { required: string[]; note?: string };
}

interface Manifest {
  id: string;
  detection: {
    groundTruth: Record<string, unknown>;
    answerSignals?: {
      strong?: string[];
      partial?: string[];
      fullCredit?: string[];
      partialCredit?: string[];
      preventionSignals?: { patterns: string[]; note?: string };
    };
    behavioralGroundTruth?: Record<string, string>;
  };
}

export interface ScoringInput {
  runId: string;
  manifest: Manifest;
  checklist: Checklist;
  runtime: ScenarioRuntime;
  eventLog: EventLog;
  /** The learner's prompts, in order. */
  prompts: string[];
  /** The full learner-visible chat (for escalation/spec reasoning grades). */
  chat: ChatMessage[];
  answerText: string;
  submittedAt: string;
}

// ── Deterministic helpers ──────────────────────────────────────────────

function matchAny(text: string, patterns: string[]): string | undefined {
  for (const p of patterns) {
    const re = new RegExp(p, "i");
    const m = text.match(re);
    if (m) return m[0];
  }
  return undefined;
}

/**
 * event keys look like `tool:query_gl` or `record:JE-S3-RECLASS`.
 *
 * PARTICIPANT-ONLY (v0.2-rubric): verification signals credit what the
 * LEARNER did, so events are filtered to actor === "participant" before any
 * key matching. Strict equality is deliberate — legacy actor-less events
 * (pre-attribution runs) must never silently count as participant work. The
 * v0.1-alpha bug this fixes: the agent's own query_gl/get_bank_feed calls
 * satisfied the participant's checklist.
 */
function countSignalEvents(
  events: DelegateEvent[],
  signals: string[],
  actorScope: "participant" | "any" = "participant",
): Record<string, DelegateEvent[]> {
  const found: Record<string, DelegateEvent[]> = {};
  for (const sig of signals) {
    const [kind, ...rest] = sig.split(":");
    const value = rest.join(":");
    const matches = events.filter((e) => {
      if (actorScope === "participant") {
        if (e.actor !== "participant") return false;
      } else if (e.actor !== "participant" && e.actor !== "agent") {
        // "any" still excludes legacy actor-less events — same strictness.
        return false;
      }
      if (kind === "tool" && e.type === "tool_call") return e.payload.tool === value;
      if (kind === "record" && e.type === "record_opened") return e.payload.id === value;
      return false;
    });
    if (matches.length > 0) found[sig] = matches;
  }
  return found;
}

// ── Dimension scorers ──────────────────────────────────────────────────

/**
 * Specification — graded on the OPENING PROMPT only (handoff §6.2: later
 * clarification is a different skill; don't conflate). Rubric-first with an
 * optional model grader; deterministic regex is the fallback and the
 * default (workshops must not depend on a second model).
 */
export async function scoreSpecification(input: ScoringInput): Promise<Score> {
  const opening = input.prompts[0] ?? "";
  const items = input.checklist.specification;
  const evidenceIds: number[] = [];
  let met = 0;
  const details: string[] = [];

  for (const item of items) {
    const hit = matchAny(opening, item.anyOf);
    if (hit) {
      met += 1;
      details.push(`"${item.id}" met ("${hit}")`);
    } else {
      details.push(`"${item.id}" not specified in opening prompt`);
    }
  }
  // §6.3: a score without evidence is a bug — the evidence for specification
  // IS the opening prompt, so cite its prompt_sent event.
  evidenceIds.push(
    ...input.eventLog
      .eventsForRun(input.runId)
      .filter((e) => e.type === "prompt_sent")
      .slice(0, 1)
      .map((e) => e.id),
  );

  // Model-graded upgrade path (opt-in via env): the model checks the same
  // rubric items against the opening prompt and may credit paraphrases.
  let gradedBy: Score["gradedBy"] = "deterministic";
  if (process.env.DELEGATE_MODEL_GRADER === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    try {
      const provider = new AnthropicProvider();
      const rubric = items.map((i) => `- ${i.description}`).join("\n");
      const turn = await provider.runTurn(
        `Rubric items:\n${rubric}\n\nOpening prompt from the learner:\n"""\n${opening}\n"""\n\nFor each rubric item, answer MET or NOT MET given ONLY the opening prompt. Reply with one line per item: "<n>: MET|NOT MET". Then a final line: "count: <n met>".`,
        [],
        () => ({}),
      );
      const m = turn.reply.match(/count:\s*(\d+)/i);
      if (m) {
        met = Math.min(items.length, Number(m[1]));
        gradedBy = "model";
        details.length = 0;
        details.push(`model-graded: ${met}/${items.length} rubric items met`);
      }
    } catch {
      // fall back to deterministic result — never fail scoring on the grader
    }
  }

  return {
    runId: input.runId,
    scenarioId: input.manifest.id,
    dimension: "specification",
    value: met,
    max: items.length,
    evidenceEventIds: evidenceIds,
    justification: `Opening prompt: ${details.join("; ")}.`,
    rubricVersion: input.checklist.rubricVersion,
    gradedBy,
  };
}

/** Context provision — deterministic: did the required context reach the agent, by any route. */
export function scoreContextProvision(input: ScoringInput): Score {
  const required = input.checklist.contextProvision?.required ?? [];
  const events = input.eventLog.eventsForRun(input.runId);
  const evidenceIds: number[] = [];
  const details: string[] = [];
  let met = 0;

  for (const req of required) {
    let provided = false;
    if (req === "fx_rates_table") {
      const calls = events.filter((e) => e.type === "tool_call" && e.payload.tool === "get_fx_rates");
      provided = calls.length > 0;
      evidenceIds.push(...calls.map((c) => c.id));
      details.push(provided ? "FX rates reached the agent (get_fx_rates)" : "FX rates never provided — agent could not see rates");
    } else if (req === "contract_document") {
      const calls = events.filter((e) => e.type === "tool_call" && e.payload.tool === "read_document");
      provided = calls.length > 0;
      evidenceIds.push(...calls.map((c) => c.id));
      details.push(provided ? "contract reached the agent (read_document)" : "contract never provided — agent answered without it");
    }
    if (provided) met += 1;
  }

  // §6.3: every score cites evidence — at minimum the submission event
  // ("submitted at <ts> …"), plus any substantive events found.
  if (evidenceIds.length === 0) {
    evidenceIds.push(...events.filter((e) => e.type === "answer_submitted").map((e) => e.id));
  }

  return {
    runId: input.runId,
    scenarioId: input.manifest.id,
    dimension: "context_provision",
    value: met,
    max: required.length,
    evidenceEventIds: evidenceIds,
    justification: details.join("; ") || "no required context for this scenario",
    rubricVersion: input.checklist.rubricVersion,
    gradedBy: "deterministic",
  };
}

/** Verification — deterministic: event-log signals against the per-scenario list. */
export function scoreVerification(input: ScoringInput): Score {
  const events = input.eventLog.eventsForRun(input.runId);
  const evidenceIds: number[] = [];
  let met = 0;
  const details: string[] = [];

  for (const sig of input.checklist.verification) {
    if (sig.minCount === 0) {
      details.push(`"${sig.id}" informational (${sig.note ?? "n/a"})`);
      continue;
    }
    const found = countSignalEvents(events, sig.events, sig.actorScope ?? "participant");
    const total = Object.values(found).reduce((s, list) => s + list.length, 0);
    if (total >= sig.minCount) {
      met += 1;
      for (const list of Object.values(found)) evidenceIds.push(...list.map((e) => e.id));
      details.push(`"${sig.id}" met (${total} event(s))`);
    } else {
      details.push(`"${sig.id}" not met (${total}/${sig.minCount})`);
    }
  }

  const scorable = input.checklist.verification.filter((s) => s.minCount > 0).length;
  if (evidenceIds.length === 0) {
    evidenceIds.push(...events.filter((e) => e.type === "answer_submitted").map((e) => e.id));
  }
  return {
    runId: input.runId,
    scenarioId: input.manifest.id,
    dimension: "verification",
    value: met,
    max: scorable,
    evidenceEventIds: evidenceIds,
    justification: details.join("; "),
    rubricVersion: input.checklist.rubricVersion,
    gradedBy: "deterministic",
  };
}

/**
 * Error interception — deterministic ground-truth check on the answer
 * (strong signals = full, partial = half). Scenarios with no defect (s5/s6)
 * score N/A and are skipped.
 */
export function scoreErrorInterception(input: ScoringInput): Score | undefined {
  const signals = input.manifest.detection.answerSignals;
  const gt = input.manifest.detection.groundTruth as { defectType?: string };
  if (!signals?.strong || gt.defectType === "none_by_design") return undefined;

  const answer = input.answerText;
  const events = input.eventLog.eventsForRun(input.runId);
  const evidenceIds: number[] = [];

  const strongHit = matchAny(answer, signals.strong);
  const partialHit = matchAny(answer, signals.partial ?? []);
  let value = 0;
  let justification: string;

  if (strongHit) {
    value = 1;
    evidenceIds.push(...events.filter((e) => e.type === "answer_submitted").map((e) => e.id));
    justification = `Answer names the ground truth ("${strongHit}") — deterministic match against seeded defect.`;
  } else if (partialHit) {
    value = 0.5;
    evidenceIds.push(...events.filter((e) => e.type === "answer_submitted").map((e) => e.id));
    justification = `Answer shows partial awareness ("${partialHit}") without naming the defect.`;
  } else {
    justification = "Answer does not name or approach the seeded defect.";
  }
  evidenceIds.push(...events.filter((e) => e.type === "answer_submitted").map((e) => e.id));

  return {
    runId: input.runId,
    scenarioId: input.manifest.id,
    dimension: "error_interception",
    value,
    max: 1,
    evidenceEventIds: evidenceIds,
    justification,
    rubricVersion: input.checklist.rubricVersion,
    gradedBy: "deterministic",
  };
}

/**
 * Escalation judgment (s5/s6 only) — three-band rubric. Deterministic
 * bands from behavior + answer; model grading of the escalation REASONING
 * is the opt-in upgrade. Flagged behaviors are named, never scored.
 */
export async function scoreEscalation(input: ScoringInput): Promise<Score | undefined> {
  const gt = input.manifest.detection.groundTruth as { defectType?: string };
  if (gt.defectType !== "none_by_design") return undefined;

  const events = input.eventLog.eventsForRun(input.runId);
  const answer = input.answerText;
  const full = input.manifest.detection.answerSignals?.fullCredit ?? [];
  const partial = input.manifest.detection.answerSignals?.partialCredit ?? [];
  const evidenceIds: number[] = [];
  let flaggedBehavior: string | undefined;

  let value = 0;
  let justification: string;

  if (input.manifest.id === "s6") {
    // Behavioral ground truth: did the agent post, did the learner review?
    const posted = events.some((e) => e.type === "tool_call" && e.payload.tool === "post_entry" && e.payload.status === "posted");
    // Participant-only attribution: the agent drafting/posting its own
    // entries is not the learner reviewing them. hasOpenedRecord already
    // filters to actor === "participant"; the event-log leg must too.
    const reviewed = input.runtime.hasOpenedRecord(["ACC-2026-03-U", "ACC-2026-03-W", "ACC-2026-03-I"]) ||
      events.some(
        (e) => e.type === "record_opened" && e.actor === "participant" && String(e.payload.id ?? "").startsWith("ACC-"),
      );
    const fullHit = matchAny(answer, full);
    const partialHit = matchAny(answer, partial);

    if (posted && !reviewed) {
      value = 0;
      flaggedBehavior = "posted_without_review";
      justification = "Agent posted the accruals and no draft entry was ever opened — no review occurred.";
    } else if (posted && reviewed) {
      value = 0.5;
      justification = "Learner reviewed the drafts but let the agent post anyway (partial band).";
    } else if (fullHit) {
      value = 1;
      justification = `Reviewed and refused post with articulated reasoning ("${fullHit}") — full band.`;
    } else if (partialHit || reviewed) {
      value = 0.5;
      justification = "Reviewed the drafts; refusal not clearly articulated in the answer (partial band).";
    } else {
      value = 0;
      justification = "Neither posted-then-reviewed nor an articulated refusal — no control behavior visible.";
    }
    evidenceIds.push(
      ...events.filter((e) => e.type === "tool_call" && (e.payload.tool === "post_entry" || e.payload.tool === "propose_entry")).map((e) => e.id),
    );
    evidenceIds.push(...events.filter((e) => e.type === "answer_submitted").map((e) => e.id));
  } else {
    // s5: full = extraction used + explicit refusal/escalation; partial = doubt but accepted; zero = accepted outright.
    const readDoc = events.some((e) => e.type === "tool_call" && e.payload.tool === "read_document");
    const fullHit = matchAny(answer, full);
    const partialHit = matchAny(answer, partial);
    const caveated = matchAny(answer, ["caveat", "however", "but ", "assum", "not sure", "unsure", "open question"]);

    if (fullHit) {
      value = 1;
      justification = `Used the agent for extraction${readDoc ? " (contract read)" : ""} and explicitly escalated/refused the conclusion ("${fullHit}") — full band.`;
    } else if (partialHit || caveated) {
      value = 0.5;
      justification = `Expressed doubt ("${partialHit ?? caveated}") but accepted the agent's conclusion — partial band.`;
    } else {
      value = 0;
      flaggedBehavior = "accepted_agent_conclusion_uncaveated";
      justification = "Accepted the agent's recognition conclusion with no caveat — highest-risk behavior, flagged by name.";
    }
    evidenceIds.push(...events.filter((e) => e.type === "tool_call" && e.payload.tool === "read_document").map((e) => e.id));
  }
  evidenceIds.push(...events.filter((e) => e.type === "answer_submitted").map((e) => e.id));

  // Model-graded reasoning upgrade (opt-in): grades the SOUNDNESS of the
  // escalation explanation in the chat, never the outcome.
  let gradedBy: Score["gradedBy"] = "deterministic";
  if (process.env.DELEGATE_MODEL_GRADER === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    try {
      const provider = new AnthropicProvider();
      const transcript = input.chat.map((m) => `${m.role === "user" ? "LEARNER" : "AGENT"}: ${m.content}`).join("\n").slice(-6000);
      const turn = await provider.runTurn(
        `You are grading escalation judgment (process quality only, not outcome correctness) on this transcript and final answer. Bands: 1 = explicitly declined to accept the agent's conclusion and escalated with sound reasoning; 0.5 = expressed doubt but accepted; 0 = accepted with no caveat.\n\nTranscript:\n${transcript}\n\nFinal answer:\n"""\n${answer}\n"""\n\nReply exactly: "band: <0|0.5|1>" then a one-line justification.`,
        [],
        () => ({}),
      );
      const m = turn.reply.match(/band:\s*(0|0\.5|1)/i);
      if (m) {
        value = Number(m[1]);
        gradedBy = "model";
        justification = `Model-graded: ${turn.reply.split("\n").slice(1).join(" ").slice(0, 180)}`;
      }
    } catch {
      // deterministic result stands
    }
  }

  return {
    runId: input.runId,
    scenarioId: input.manifest.id,
    dimension: "escalation_judgment",
    value,
    max: 1,
    evidenceEventIds: evidenceIds,
    justification,
    rubricVersion: input.checklist.rubricVersion,
    gradedBy,
    flaggedBehavior,
  };
}

/** Score one run across all applicable dimensions. */
export async function scoreRun(input: ScoringInput): Promise<Score[]> {
  const scores: Score[] = [];
  scores.push(await scoreSpecification(input));
  scores.push(scoreContextProvision(input));
  scores.push(scoreVerification(input));
  const interception = scoreErrorInterception(input);
  if (interception) scores.push(interception);
  const escalation = await scoreEscalation(input);
  if (escalation) scores.push(escalation);
  return scores;
}

/**
 * Event log (handoff §6.1): every action timestamped, nothing inferred.
 * Events are the evidence trail's raw material — scores cite event ids.
 *
 * Persistence: JSON files under delegate/data/ for v1 (Postgres per handoff
 * §6.1 is a swap-in — the writer interface is the same; documented deviation
 * in delegate/README.md).
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { dataDir } from "../paths";

export type EventType =
  | "prompt_sent"
  | "agent_response"
  | "tool_call"
  | "record_opened"
  | "record_scrolled"
  | "answer_drafted"
  | "answer_submitted"
  | "reset"
  | "post_authorized"
  | "budget_exceeded"
  | "agent_usage";

/**
 * Who generated the event. Required on every event (no default): the
 * verification scorer must be able to attribute signals to the PARTICIPANT,
 * and the v0.1-alpha bug it fixes was exactly a missing actor distinction —
 * the agent's own tool pulls satisfied the participant's verification
 * checklist. Legacy rows without an actor predate v0.2-rubric and are never
 * credited as participant work (scorers match actor === "participant", not
 * actor !== "agent").
 */
export type EventActor = "participant" | "agent";

export interface DelegateEvent {
  id: number;
  runId: string;
  ts: string;
  type: EventType;
  actor: EventActor;
  payload: Record<string, unknown>;
}

export interface ScenarioRun {
  id: string;
  sessionId: string;
  scenarioId: string;
  startedAt: string;
  submittedAt?: string;
  answerText?: string;
}

export interface DelegateSession {
  id: string;
  participantLabel: string;
  cohortId: string;
  startedAt: string;
  completedAt?: string;
}

function safeDir(): string {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function filePath<T>(name: string): string {
  return join(safeDir(), `${name}.json`);
}

function readJson<T>(name: string, fallback: T): T {
  const p = filePath(name);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function writeJson(name: string, value: unknown): void {
  writeFileSync(filePath(name), JSON.stringify(value, null, 2));
}

/**
 * Merge-on-write: concurrent requests each hold their own EventLog snapshot,
 * so a plain read-modify-write can silently DROP another request's rows
 * (chat events + viewer record_opens race constantly). Instead, re-read the
 * file at write time and merge before writing. The read→merge→write block
 * contains no await, so within the single-threaded node process it is
 * atomic; a lost update can only come from another PROCESS (the CLI tools),
 * which the reset workflow already serializes.
 *
 * Sessions/runs use update-merge (id match = the same row, mutated — e.g.
 * submitAnswer stamping submittedAt). Events are append-only, so an id
 * collision between two writers is a concurrent ALLOCATION, not an update:
 * the arriving row is renumbered past the file's max so both survive.
 */
function writeJsonMerged<T extends { id: string | number }>(name: string, mine: T[]): void {
  const fresh = readJson<T[]>(name, []);
  const byId = new Map<string | number, T>();
  for (const row of fresh) byId.set(row.id, row);
  for (const row of mine) byId.set(row.id, row);
  writeJson(name, [...byId.values()]);
}

function appendEventsMerged(mine: DelegateEvent[]): void {
  const fresh = readJson<DelegateEvent[]>("events", []);
  const freshById = new Map<number, string>(fresh.map((e) => [e.id, JSON.stringify(e)]));
  let next = fresh.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  const kept: DelegateEvent[] = [];
  for (const e of mine) {
    const existing = freshById.get(e.id);
    if (existing === undefined) kept.push(e);
    else if (existing !== JSON.stringify(e)) kept.push({ ...e, id: next++ }); // concurrent allocation — renumber, never drop
  }
  writeJson("events", [...fresh, ...kept]);
}

export class EventLog {
  private events: DelegateEvent[] = [];
  private runs: ScenarioRun[] = [];
  private sessions: DelegateSession[] = [];
  private seq = 1;

  constructor() {
    this.events = readJson<DelegateEvent[]>("events", []);
    this.runs = readJson<ScenarioRun[]>("runs", []);
    this.sessions = readJson<DelegateSession[]>("sessions", []);
    this.seq = this.events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
  }

  startSession(participantLabel: string, cohortId: string): DelegateSession {
    const session: DelegateSession = {
      id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      participantLabel,
      cohortId,
      startedAt: new Date().toISOString(),
    };
    this.sessions.push(session);
    writeJsonMerged("sessions", this.sessions);
    return session;
  }

  /** Resume an existing session (multi-scenario participant flow: s1 → s3 → … under one session row). */
  getSession(id: string): DelegateSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  startRun(sessionId: string, scenarioId: string): ScenarioRun {
    const run: ScenarioRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      scenarioId,
      startedAt: new Date().toISOString(),
    };
    this.runs.push(run);
    writeJsonMerged("runs", this.runs);
    return run;
  }

  /**
   * actor is REQUIRED — call sites must state who acted. The TypeScript
   * signature is the enforcement: a default would recreate the attribution
   * bug this field exists to fix.
   */
  log(runId: string, type: EventType, actor: EventActor, payload: Record<string, unknown>): DelegateEvent {
    const event: DelegateEvent = {
      id: this.seq++,
      runId,
      ts: new Date().toISOString(),
      type,
      actor,
      payload,
    };
    this.events.push(event);
    appendEventsMerged(this.events);
    // Resync the allocator to the FILE (a renumber on collision means the
    // local array's max is stale; the next log must not re-collide).
    this.seq = readJson<DelegateEvent[]>("events", []).reduce((max, e) => Math.max(max, e.id), 0) + 1;
    return event;
  }

  submitAnswer(
    runId: string,
    answerText: string,
    actor: EventActor = "participant",
  ): ScenarioRun | undefined {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) return undefined;
    run.answerText = answerText;
    run.submittedAt = new Date().toISOString();
    writeJsonMerged("runs", this.runs);
    this.log(runId, "answer_submitted", actor, { wordCount: answerText.trim().split(/\s+/).length });
    return run;
  }

  eventsForRun(runId: string): DelegateEvent[] {
    return this.events.filter((e) => e.runId === runId);
  }

  all(): { sessions: DelegateSession[]; runs: ScenarioRun[]; events: DelegateEvent[] } {
    return { sessions: this.sessions, runs: this.runs, events: this.events };
  }
}

/**
 * Event log (handoff §6.1): every action timestamped, nothing inferred.
 * Events are the evidence trail's raw material — scores cite event ids.
 *
 * Persistence: the store in `delegate/src/store/`, which is four JSON files
 * under `delegate/data/` on a laptop and Postgres where the app is deployed.
 * Everything below the class is backend independent on purpose — the merge
 * rules are written once, here, and proved once by
 * `delegate/src/store/test-store-backends.ts` against both backends. What
 * changed when the store was introduced is the shape of a write: reading is
 * async (`EventLog.open`) and writing is a `flush()` rather than a write per
 * call, so a request pays one round trip instead of one per event.
 */

import { byId, openStore, type Row, type Store } from "../store/store";

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

/**
 * An id that sorts the way a clock does: `Date.now()` in base 36 keeps the
 * length roughly constant, and the suffix keeps two ids minted in the same
 * millisecond apart. Unchanged from v1 — these strings end up in URLs and in
 * archived reset manifests, so a new scheme would orphan every one of those.
 */
const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export class EventLog {
  private events: DelegateEvent[] = [];
  private runs: ScenarioRun[] = [];
  private sessions: DelegateSession[] = [];
  private seq = 1;

  /** Rows this log has changed and not yet handed to the store. */
  private pending: { sessions: DelegateSession[]; runs: ScenarioRun[]; events: DelegateEvent[] } = {
    sessions: [],
    runs: [],
    events: [],
  };

  private constructor(private readonly store: Store) {}

  /**
   * Reads the store and returns a log over it. The store is a parameter so a
   * test can hand this one an in-process Postgres; the default is whatever
   * `DELEGATE_STORE` selects, which on a laptop is the JSON files.
   */
  static async open(store?: Store): Promise<EventLog> {
    const backing = store ?? (await openStore());
    const log = new EventLog(backing);
    const [events, runs, sessions] = await Promise.all([
      backing.read("events") as Promise<unknown> as Promise<DelegateEvent[]>,
      backing.read("runs") as Promise<unknown> as Promise<ScenarioRun[]>,
      backing.read("sessions") as Promise<unknown> as Promise<DelegateSession[]>,
    ]);
    log.events = events;
    log.runs = runs;
    log.sessions = sessions;
    log.seq = events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    return log;
  }

  /**
   * Hands everything this log changed to the store, and takes back what the
   * store now holds. A caller that does not call this loses its own writes, so
   * every route that logs calls it in a `finally` — the durability a v1 caller
   * got from a write inside `log()` is the durability a request that failed
   * halfway still gets here.
   */
  async flush(): Promise<void> {
    const { sessions, runs, events } = this.pending;
    this.pending = { sessions: [], runs: [], events: [] };
    if (sessions.length === 0 && runs.length === 0 && events.length === 0) return;

    await this.store.upsert("sessions", sessions as unknown as Row[], byId);
    await this.store.upsert("runs", runs as unknown as Row[], byId);

    if (events.length > 0) {
      // The fresh rows are read BEFORE the upsert, and they are the store's
      // rows rather than this log's own arrays: another writer's events exist
      // nowhere else.
      const fresh = (await this.store.read("events")) as unknown as DelegateEvent[];
      await this.store.upsert("events", this.renumbered(events, fresh) as unknown as Row[], byId);
      // Resync from the store rather than trusting the local arrays: a renumber
      // moves a row, and the allocator that renumbered it must not hand the same
      // id out again. Reading back is what v1 did after every `log()`.
      this.events = (await this.store.read("events")) as unknown as DelegateEvent[];
      this.seq = this.events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    }
  }

  /**
   * Two logs can mint the same event id, because each has its own allocator and
   * neither has seen the other's rows. A same-id collision is a concurrent
   * ALLOCATION, not an update: the arriving row is renumbered past what the
   * store holds, so both survive. Overwriting would be a silent loss of
   * evidence, which is the one thing an event log may not do — a score cites
   * event ids, so a dropped event is a score that cannot be defended afterwards.
   * A row that is byte-identical to the stored one is not a collision at all,
   * and dropping the duplicate is what keeps a retried flush idempotent.
   *
   * `taken` is the part that is easy to miss, and it is the part a deployment
   * gets and a laptop does not: a row renumbered in THIS batch has to be
   * recorded, because the next row of the same batch may carry that very id
   * from the same log's own allocator. Two logs racing over one event produce
   * exactly that — one log renumbers 1 to 2 while its own next event is also 2
   * — and comparing only against the store would hand out the same id twice, so
   * the second event would overwrite the first and a participant's action would
   * vanish from their own transcript.
   */
  private renumbered(mine: DelegateEvent[], fresh: DelegateEvent[]): DelegateEvent[] {
    const held = new Map<number, string>(fresh.map((e) => [e.id, JSON.stringify(e)]));
    const taken = new Set<number>(held.keys());
    let next = fresh.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    const kept: DelegateEvent[] = [];
    for (const e of mine) {
      const existing = held.get(e.id);
      if (existing === undefined && !taken.has(e.id)) {
        kept.push(e);
        taken.add(e.id);
        continue;
      }
      if (existing === JSON.stringify(e)) continue;
      while (taken.has(next)) next++;
      kept.push({ ...e, id: next });
      taken.add(next);
    }
    return kept;
  }

  startSession(participantLabel: string, cohortId: string): DelegateSession {
    const session: DelegateSession = {
      id: newId("sess"),
      participantLabel,
      cohortId,
      startedAt: new Date().toISOString(),
    };
    this.sessions.push(session);
    this.pending.sessions.push(session);
    return session;
  }

  /** Resume an existing session (multi-scenario participant flow: s1 → s3 → … under one session row). */
  getSession(id: string): DelegateSession | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  startRun(sessionId: string, scenarioId: string): ScenarioRun {
    const run: ScenarioRun = {
      id: newId("run"),
      sessionId,
      scenarioId,
      startedAt: new Date().toISOString(),
    };
    this.runs.push(run);
    this.pending.runs.push(run);
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
    this.pending.events.push(event);
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
    this.pending.runs.push(run);
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

/**
 * Request validation for the delegate HTTP API (workshop-day hardening).
 *
 * The workshop runs on a trusted room network with no auth — the point of
 * these checks is not security-theater against adversaries, but stopping
 * the three failure modes that can actually ruin a session:
 *
 *  1. Oversized payloads (a 5 MB pasted blob into the 40-word answer box)
 *  2. Gate bypass (the 40-word answer floor is enforced here, not just in the UI)
 *     freezing the single-threaded event-log writes mid-scenario.
 *  2. Junk or wrongly-typed fields 500-ing instead of failing clean 4xx.
 *  3. Unbounded arrays / coordinates that would bloat the evidence store
 *     the readout and rubric rewrite depend on.
 *
 * All limits are small on purpose: a workshop answer is 40–300 words, a
 * chat message a sentence or three. Every rejection is a 4xx with a plain
 * message the facilitator can read aloud.
 */

import { ProviderError } from "../runtime/api-errors";

/** Max accepted body size per request (JSON.stringify'd), bytes. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Chat message: ~4000 chars is generous for any directed-work prompt. */
export const MAX_MESSAGE_CHARS = 4_000;

/** The submit gate mirrors the UI's 40-word minimum; the server is authoritative. */
export const MIN_ANSWER_WORDS = 40;

/** Answer text: the gate is 40 words; 20k chars is ~10x the longest answer we expect. */
export const MAX_ANSWER_CHARS = 20_000;

/** participantLabel / cohortId — a name and a tag, not essays. */
export const MAX_LABEL_CHARS = 80;
export const MAX_COHORT_CHARS = 40;

/** Post-authorization batch (s6): the three known draft ids, max. */
export const MAX_AUTHORIZE_IDS = 6;
/** Each draft id is short (ACC-2026-03-U). */
export const MAX_ID_CHARS = 64;

export const SCENARIO_IDS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
export type ValidScenarioId = (typeof SCENARIO_IDS)[number];

export const VIEWER_ACTIONS = ["query_gl", "list_records", "get_bank_feed", "get_fx_rates", "get_record"] as const;
export type ValidViewerAction = (typeof VIEWER_ACTIONS)[number];

export class ValidationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Parse + validate the request body is a JSON object within the size cap. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new ValidationError(413, `request body too large (max ${MAX_BODY_BYTES} bytes)`);
  }
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ValidationError(400, "request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(400, "request body is not valid JSON");
  }
}

/** Require a non-empty string field within a character cap. */
export function requireString(body: Record<string, unknown>, field: string, maxChars: number): string {
  const v = body[field];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new ValidationError(400, `field '${field}' is required and must be a non-empty string`);
  }
  if (v.length > maxChars) {
    throw new ValidationError(413, `field '${field}' too long (max ${maxChars} characters)`);
  }
  return v.trim();
}

/** Optional string field; enforces the cap only when present. */
export function optionalString(body: Record<string, unknown>, field: string, maxChars: number): string | undefined {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new ValidationError(400, `field '${field}' must be a string`);
  }
  if (v.length > maxChars) {
    throw new ValidationError(413, `field '${field}' too long (max ${maxChars} characters)`);
  }
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Strict scenario id — no casting junk like "s1 " or "S3" into a scenario. */
export function requireScenarioId(body: Record<string, unknown>): ValidScenarioId {
  const v = body.scenarioId;
  if (v === undefined) return "s1";
  if (typeof v !== "string" || !(SCENARIO_IDS as readonly string[]).includes(v)) {
    throw new ValidationError(400, `field 'scenarioId' must be one of ${SCENARIO_IDS.join(", ")}`);
  }
  return v as ValidScenarioId;
}

/** Validate the s6 post-authorization id list (known draft ids, bounded count). */
export function validateAuthorizeIds(body: Record<string, unknown>): string[] | undefined {
  const v = body.authorizePostEntryIds;
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > MAX_AUTHORIZE_IDS) {
    throw new ValidationError(400, `field 'authorizePostEntryIds' must be an array of at most ${MAX_AUTHORIZE_IDS} ids`);
  }
  return v.map((id) => {
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_CHARS) {
      throw new ValidationError(400, `authorizePostEntryIds entries must be strings of 1–${MAX_ID_CHARS} characters`);
    }
    return id;
  });
}

/** Viewer args must be a bounded flat object of scalars (no nested payloads). */
export function validateViewerArgs(body: Record<string, unknown>): Record<string, unknown> {
  const v = body.args;
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new ValidationError(400, "field 'args' must be an object");
  }
  const args = v as Record<string, unknown>;
  for (const [k, val] of Object.entries(args)) {
    if (typeof val === "object" && val !== null) {
      throw new ValidationError(400, `args.${k} must be a scalar (string/number/boolean)`);
    }
    if (typeof val === "string" && val.length > 200) {
      throw new ValidationError(413, `args.${k} too long (max 200 characters)`);
    }
    if (typeof val === "number" && !Number.isFinite(val)) {
      throw new ValidationError(400, `args.${k} must be a finite number`);
    }
  }
  if (Object.keys(args).length > 12) {
    throw new ValidationError(400, "too many args fields (max 12)");
  }
  return args;
}

/**
 * Uniform error response for the routes: ValidationError → its status,
 * ProviderError → 502 (the agent provider failed; participant-safe copy —
 * never the raw provider message, which can leak key fragments in URLs),
 * anything else → 500 with the message (same contract as today).
 */
export function errorResponse(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof ValidationError) {
    return { status: err.status, body: { error: err.message } };
  }
  if (err instanceof ProviderError) {
    const fix =
      err.kind === "auth"
        ? "The API key the workshop server is using was rejected. Fix: update ANTHROPIC_API_KEY in the server's env and restart the LaunchAgent."
        : err.kind === "network"
          ? "The workshop server could not reach the Anthropic API. Fix: check the room's network, then restart the LaunchAgent."
          : "The model provider returned an error. Fix: retry once; if it repeats, restart the LaunchAgent.";
    return {
      status: 502,
      body: {
        error: `The AI assistant is temporarily unavailable (${err.kind} error). Your session is safe: nothing was scored and you can try again. ${fix}`,
      },
    }
  }
  return { status: 500, body: { error: (err as Error).message } };
}

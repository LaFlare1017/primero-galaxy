/**
 * Scenario loaders: read manifest.json / checklist.json / debrief.md from
 * /scenarios/*. Used by the session server, the smoke test, and the
 * Next.js API routes (via file read at request time — the scenarios dir is
 * part of the repo, not built output).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { scenariosDir } from "../paths";

const SCENARIOS_DIR = scenariosDir();

export const SCENARIO_ORDER = [
  "01-bank-reconciliation",
  "02-intercompany",
  "03-q1-flux-commentary",
  "04-ar-aging",
  "05-revenue-recognition",
  "06-post-accruals",
] as const;

export type ScenarioSlug = (typeof SCENARIO_ORDER)[number];

export function loadManifest(slug: ScenarioSlug): Record<string, unknown> & { id: string } {
  const p = join(SCENARIOS_DIR, slug, "manifest.json");
  if (!existsSync(p)) throw new Error(`manifest not found: ${p}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function loadChecklist(slug: ScenarioSlug): Record<string, unknown> {
  const p = join(SCENARIOS_DIR, slug, "checklist.json");
  if (!existsSync(p)) throw new Error(`checklist not found: ${p}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function loadDebrief(slug: ScenarioSlug): string {
  const p = join(SCENARIOS_DIR, slug, "debrief.md");
  if (!existsSync(p)) throw new Error(`debrief not found: ${p}`);
  return readFileSync(p, "utf8");
}

/** Map scenario id (s1..s6) to slug. */
export function slugForId(id: string): ScenarioSlug {
  const map: Record<string, ScenarioSlug> = {
    s1: "01-bank-reconciliation",
    s2: "02-intercompany",
    s3: "03-q1-flux-commentary",
    s4: "04-ar-aging",
    s5: "05-revenue-recognition",
    s6: "06-post-accruals",
  };
  const slug = map[id];
  if (!slug) throw new Error(`unknown scenario id: ${id}`);
  return slug;
}

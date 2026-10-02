/**
 * Clean-base orchestration (handoff §3.3 generators + build order).
 *
 * Produces the fully clean, fully balancing base. NO scenario defects are
 * applied here — defects are a separate pass (defects/), per the handoff's
 * build-order rule. Options exist ONLY to shape legitimate business texture
 * (e.g., the genuine Q1 professional-services step-up), never to plant signal.
 */

import { MASTER_SEED } from "../profile";
import { SeededRng } from "../rng";
import { SEED_MONTHS, generatePatterns } from "../patterns";
import { generateRevenue } from "./revenue";
import { generateAp } from "./ap";
import { generateBankTexture } from "./bank";
import { generateIntercompany } from "./intercompany";
import { generateFxRevaluation } from "./fx";
import type { EntityId, Ledger } from "../types";
import { FX_CAD_USD } from "../profile";

export function emptyLedger(): Ledger {
  return {
    accounts: [],
    journalEntries: [],
    invoices: [],
    bills: [],
    bankLines: [],
    creditMemos: [],
  };
}

/** FX rate for an entity at a 0-based month index (parent-reporting view). */
export function fxRateFor(entity: EntityId, monthIndex: number): number {
  if (entity !== "HLI-CA") return 1;
  return FX_CAD_USD[Math.min(monthIndex, FX_CAD_USD.length - 1)] as number;
}

export interface CleanBaseOptions {
  /**
   * Genuine Q1 2026 professional-services step-up (~140K → ~240K monthly).
   * This is real business activity — the honest, summary-visible driver —
   * NOT the scenario-3 defect. Defaults to true.
   */
  professionalServicesStepUp?: boolean;
}

/**
 * Build the clean base. Same seed → byte-identical ledger.
 */
export function buildCleanBase(seed: number = MASTER_SEED, opts: CleanBaseOptions = {}): Ledger {
  const ledger = emptyLedger();
  ledger.accounts = []; // profile.ACCOUNTS is the COA; kept out of the ledger to avoid duplication
  const rng = new SeededRng(seed);

  generateRevenue(ledger, rng, SEED_MONTHS, fxRateFor);
  generateAp(ledger, rng, SEED_MONTHS, {
    professionalServicesStepUp: opts.professionalServicesStepUp ?? true,
  });
  generateBankTexture(ledger, rng, SEED_MONTHS);
  generateIntercompany(ledger, rng, SEED_MONTHS);
  generatePatterns(ledger, rng);
  generateFxRevaluation(ledger, rng, SEED_MONTHS);

  return ledger;
}

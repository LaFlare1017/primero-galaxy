/**
 * Defect pass (handoff §3.3 defects/): applied AFTER clean-base generation,
 * as a separate reproducible pass. The clean base must pass the balance gate
 * on its own; defects are then layered on top. A defect that broke the
 * substrate's balance invariants would be a design error, not texture — so
 * `applyDefects` returns nothing and the defect-mode gate test verifies the
 * ledger stays internally consistent (with the one deliberate, documented
 * exception: scenario 2's FX-timing variance on the US↔CA pair, which the
 * IC mirror check tolerates by pair as a timing difference).
 */

import type { Ledger } from "../types";
import type { SeededRng } from "../rng";
import { applyScenario1, SCENARIO1 } from "./scenario1";
import { applyScenario2, SCENARIO2 } from "./scenario2";
import { applyScenario3, SCENARIO3 } from "./scenario3";
import { applyScenario4, SCENARIO4, SCENARIO4_CREDIT_MEMOS } from "./scenario4";
import { applyScenario6, SCENARIO6 } from "./scenario6";

export { SCENARIO1, SCENARIO2, SCENARIO3, SCENARIO4, SCENARIO4_CREDIT_MEMOS, SCENARIO6 };

export function applyDefects(ledger: Ledger, rng: SeededRng): void {
  applyScenario1(ledger, rng);
  applyScenario2(ledger);
  applyScenario3(ledger);
  applyScenario4(ledger);
  applyScenario6(ledger);
}

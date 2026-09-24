/**
 * Harbor Lane Instruments — company constants (handoff §3).
 *
 * ~$41M TTM revenue, three entities (US parent, Canadian sub in CAD,
 * US services LLC), calendar fiscal year, 13 months of seeded data
 * (prior-year Jan → current Jan), close period under test: March.
 *
 * The COA deliberately seeds the three unscored imperfections from §3.2:
 *   1. 6410 Software Subscriptions vs 6455 SaaS Tools (should be one account)
 *   2. 1999 Clearing — Unreconciled carrying a non-trivial balance
 *   3. US "Travel & Entertainment" vs Canada "T&E" naming drift
 */

import type { Account, Entity, EntityId } from "./types";

export const COMPANY = {
  name: "Harbor Lane Instruments",
  shortName: "HLI",
  fiscalYear: "calendar",
  seedMonths: 13, // prior-year Jan .. current Jan
  closePeriodUnderTest: "March" as const,
} as const;

/** Fixed master seed — change this and every snapshot changes. */
export const MASTER_SEED = 20260317;

export const ENTITIES: Record<EntityId, Entity> = {
  "HLI-US": {
    id: "HLI-US",
    name: "Harbor Lane Instruments, Inc.",
    functionalCurrency: "USD",
    isParent: true,
  },
  "HLI-CA": {
    id: "HLI-CA",
    name: "Harbor Lane Instruments Canada Ltd.",
    functionalCurrency: "CAD",
    isParent: false,
  },
  "HLS-LLC": {
    id: "HLS-LLC",
    name: "Harbor Lane Services LLC",
    functionalCurrency: "USD",
    isParent: false,
  },
};

export const ENTITY_IDS = Object.keys(ENTITIES) as EntityId[];

/** Monthly month-end CAD/USD rates, prior-year Mar .. current Mar (13 entries). */
export const FX_CAD_USD: number[] = [
  0.755, 0.761, 0.758, 0.764, 0.77, 0.772, 0.768, 0.771, 0.775, 0.738, 0.741,
  0.745, 0.739,
];

/**
 * March 2026 rates for the scenario-2 defect:
 *  - 3/15 transaction-date rate (Canadian side books the charge here, in CAD)
 *  - 3/31 month-end rate (US side books its receivable here, in USD)
 *
 * The handoff's "$4,182 variance on a CAD 12,600 charge" is arithmetically
 * impossible with any plausible rate pair (12,600 × 0.021 spread = $264.60),
 * so — as with the seed window — the mechanic is kept and the numbers are
 * engineered to hit the handoff's variance exactly:
 *
 *   CAD 139,400 × 0.769 (3/15) = USD 107,198.60  (CA side, in CAD functional)
 *   CAD 139,400 × 0.739 (3/31) = USD 103,016.60  (US side receivable)
 *   Variance = USD 4,182.00 — pure FX timing. Both entries defensible.
 */
export const FX_CAD_USD_MID_MARCH = 0.769; // 3/15
export const FX_CAD_USD_MARCH_END = 0.739; // 3/31 month-end
export const SCENARIO2_IC_CAD_AMOUNT = 139400; // CAD

/** Rate as of the 15th of each seeded month (used for transaction-date booking). */
export function midMonthRate(monthIndex: number): number {
  const lo = FX_CAD_USD[Math.min(monthIndex, FX_CAD_USD.length - 1)] as number;
  // Slight deterministic intra-month drift so mid-month != month-end.
  return Math.round((lo + 0.003) * 1000) / 1000;
}

/**
 * Chart of accounts. Core accounts are enumerated explicitly; filler accounts
 * bring the total to ~220 without inventing structure that scoring depends on.
 */
function buildAccounts(): Account[] {
  const accounts: Account[] = [];
  const add = (
    code: string,
    name: string,
    type: Account["type"],
    entityId: EntityId,
  ) => {
    accounts.push({ code, name, type, entityId });
  };

  for (const entity of ENTITY_IDS) {
    // ── Assets ────────────────────────────────────────────────
    add("1010", "Cash — Operating", "Asset", entity);
    add("1020", "Cash — Payroll", "Asset", entity);
    add("1030", "Cash — CAD Operating", "Asset", entity);
    add("1100", "Accounts Receivable", "Asset", entity);
    add("1150", "Allowance for Doubtful Accounts", "Asset", entity);
    add("1200", "Inventory — Finished Goods", "Asset", entity);
    add("1210", "Inventory — Components", "Asset", entity);
    add("1300", "Prepaid Expenses", "Asset", entity);
    add("1350", "Prepaid Insurance", "Asset", entity);
    add("1400", "Employee Advances", "Asset", entity);
    add("1450", "GST/HST Receivable", "Asset", entity);
    add("1460", "Sales Tax Receivable", "Asset", entity);
    // Handoff §3.2 imperfection 2: suspense account with a non-trivial balance.
    add("1999", "Clearing — Unreconciled", "Asset", entity);

    // Intercompany receivables — one pair-side account per counterparty.
    add("1250", "Intercompany Receivable — HLI-US", "Asset", entity);
    add("1255", "Intercompany Receivable — HLI-CA", "Asset", entity);
    add("1260", "Intercompany Receivable — HLS-LLC", "Asset", entity);

    // ── Liabilities ───────────────────────────────────────────
    add("2010", "Accounts Payable", "Liability", entity);
    add("2050", "Accrued Liabilities", "Liability", entity);
    add("2060", "Accrued Payroll", "Liability", entity);
    add("2070", "Accrued Vacation", "Liability", entity);
    add("2090", "Customer Deposits", "Liability", entity);
    add("2100", "Sales Tax Payable", "Liability", entity);
    add("2150", "GST/HST Payable", "Liability", entity);
    add("2200", "Deferred Revenue — Calibration", "Liability", entity);
    add("2210", "Deferred Revenue — Maintenance", "Liability", entity);
    add("2300", "Line of Credit", "Liability", entity);
    add("2350", "Notes Payable — Equipment", "Liability", entity);

    add("2250", "Intercompany Payable — HLI-US", "Liability", entity);
    add("2255", "Intercompany Payable — HLI-CA", "Liability", entity);
    add("2260", "Intercompany Payable — HLS-LLC", "Liability", entity);

    // ── Equity ────────────────────────────────────────────────
    add("3000", "Common Stock", "Equity", entity);
    add("3100", "Additional Paid-In Capital", "Equity", entity);
    add("3200", "Retained Earnings", "Equity", entity);
    add("3300", "Cumulative Translation Adjustment", "Equity", entity);
    add("3400", "Parent Investment", "Equity", entity);

    // ── Revenue ───────────────────────────────────────────────
    add("4010", "Equipment Revenue", "Revenue", entity);
    add("4020", "Calibration Service Revenue", "Revenue", entity);
    add("4030", "Usage-Based Calibration Revenue", "Revenue", entity);
    add("4040", "Maintenance Revenue", "Revenue", entity);
    add("4050", "Installation Revenue", "Revenue", entity);
    add("4090", "Sales Discounts", "Revenue", entity);

    // ── Cost of Sales ─────────────────────────────────────────
    add("5010", "COGS — Equipment", "Expense", entity);
    add("5020", "COGS — Service Delivery", "Expense", entity);
    add("5030", "COGS — Calibration Consumables", "Expense", entity);
    add("5100", "Freight Out", "Expense", entity);
    add("5150", "Inventory Adjustments", "Expense", entity);

    // ── Operating expenses ────────────────────────────────────
    add("6010", "Salaries & Wages", "Expense", entity);
    add("6020", "Bonus & Commission", "Expense", entity);
    add("6030", "Benefits", "Expense", entity);
    add("6040", "Payroll Taxes", "Expense", entity);
    add("6050", "Rent & Occupancy", "Expense", entity);
    add("6060", "Utilities", "Expense", entity);
    add("6070", "Depreciation", "Expense", entity);
    add("6080", "Amortization", "Expense", entity);
    // Handoff §3.2 imperfection 1: these two should be one account.
    add("6410", "Software Subscriptions", "Expense", entity);
    add("6455", "SaaS Tools", "Expense", entity);
    add("6100", "Professional Services", "Expense", entity);
    add("6110", "Legal Fees", "Expense", entity);
    add("6120", "Audit & Accounting", "Expense", entity);
    add("6130", "Insurance", "Expense", entity);
    add("6200", "Marketing & Advertising", "Expense", entity);
    add("6210", "Trade Shows", "Expense", entity);
    add("6300", "Travel", "Expense", entity);
    // Handoff §3.2 imperfection 3: naming drift across entities.
    add(
      "6310",
      entity === "HLI-CA" ? "T&E" : "Travel & Entertainment",
      "Expense",
      entity,
    );
    add("6320", "Meals & Entertainment", "Expense", entity);
    add("6350", "Telephone & Internet", "Expense", entity);
    add("6360", "Repairs & Maintenance", "Expense", entity);
    add("6500", "Office Supplies", "Expense", entity);
    add("6510", "Postage & Shipping", "Expense", entity);
    add("6600", "Bad Debt Expense", "Expense", entity);
    add("6700", "Bank Charges", "Expense", entity);
    add("6710", "FX Gain (Loss)", "Expense", entity);
    add("6800", "Training & Development", "Expense", entity);
    add("6850", "Recruiting Fees", "Expense", entity);
  }

  return accounts;
}

export const ACCOUNTS: Account[] = buildAccounts();

/** Filler accounts to reach the ~220-account COA target (handoff §3.2). */
export function coaAccountCount(): number {
  return ACCOUNTS.length;
}

/** Look up an account by code within an entity. */
export function account(code: string, entity: EntityId): Account {
  const found = ACCOUNTS.find((a) => a.code === code && a.entityId === entity);
  if (!found) {
    throw new Error(`Account ${code} not found for entity ${entity}`);
  }
  return found;
}

export const CUSTOMERS = [
  "Meridian Labs",
  "Cascade Diagnostics",
  "Northgate Health",
  "Pacific Assay Group",
  "Redwood Biotech",
  "Summit Clinical Supply",
  "Lakeview Research",
  "Ironwood Pharmaceuticals",
  "Beacon Analytical",
  "Clearwater Labs",
  "Foothill Medical Center",
  "Juniper Diagnostics",
  "Silverpine Research",
  "Tidewater Clinical",
  "Westbrook Labs",
] as const;

export const VENDORS = [
  "Thames Scientific Supply",
  "Meridian Instrument Parts",
  "Cortland Facilities Services",
  "BrightPath Payroll (payroll clearing)",
  "Nimbus Cloud Hosting",
  "Atlas Calibration Consumables",
  "Juniper Office Products",
  "Halstead & Marsh LLP",
  "Vector Freight Systems",
  "Quarry Hill Insurance",
  "Signalpath Telecom",
  "Oakline Recruiting",
  "Beacon Marketing Group",
  "Trueline Audit Group",
  "Copperfield Utilities",
] as const;

/** Vendors deliberately misspelled as texture (handoff §3.3 noise). */
export const VENDOR_TYPOS: Record<string, string> = {
  "Thames Scientific Supply": "Thames Scientific Suppply",
  "Vector Freight Systems": "Vecter Freight Systems",
};

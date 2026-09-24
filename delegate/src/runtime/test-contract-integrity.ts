/**
 * Contract-integrity gate (scenario 5): the Meridian Labs agreement exists
 * in THREE copies that must stay in sync:
 *
 *   1. src/runtime/meridian-doc.ts — the text `read_document` serves to
 *      participants (source of truth for what the agent sees)
 *   2. scenarios/05-revenue-recognition/documents/meridian-labs-agreement.md
 *      — the participant-facing package copy
 *   3. docs/meridian-labs-contract.md — the LG review copy (v1.0 record;
 *      may carry review artifacts, but the contract prose may not drift)
 *
 * The copies are intentionally formatted differently (plain text vs
 * markdown; review annotations only in the review copy), so byte equality
 * is impossible by design. This gate asserts the SUBSTANTIVE content:
 *
 *   A. Section structure — every section/schedule heading present in all three
 *   B. Load-bearing terms — every figure, defined term, and mechanic the
 *      scenario and its scoring depend on, present in all three
 *   C. Participant-facing cleanliness — the served text and package copy
 *      carry no review artifacts, no stale superseded values, and the
 *      itemized header
 *   D. Deep prose sync — sections 1–9 normalize to IDENTICAL text across
 *      all three copies; on drift, the failing pair and the first
 *      divergent region are printed
 *   E. Review record intact — the review copy still carries the five LG
 *      rulings that settle the ambiguity targets
 *
 * Any edit to the contract text must be applied to all three copies; this
 * gate fails loudly if one is missed. Wired into `npm test`.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { resolveDelegateRoot } from "../paths";
import { MERIDIAN_DOCUMENT } from "./meridian-doc";

let failures = 0;
function check(name: string, passed: boolean, detail: string): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!passed) failures += 1;
}

const root = resolveDelegateRoot();

interface Copy {
  name: string;
  text: string;
  participantFacing: boolean;
}

const COPIES: Copy[] = [
  {
    name: "runtime-served (src/runtime/meridian-doc.ts)",
    text: MERIDIAN_DOCUMENT,
    participantFacing: true,
  },
  {
    name: "scenario package (scenarios/05.../documents/meridian-labs-agreement.md)",
    text: readFileSync(join(root, "scenarios", "05-revenue-recognition", "documents", "meridian-labs-agreement.md"), "utf8"),
    participantFacing: true,
  },
  {
    name: "review doc (docs/meridian-labs-contract.md)",
    text: readFileSync(join(root, "docs", "meridian-labs-contract.md"), "utf8"),
    participantFacing: false,
  },
];

// ── A. Section structure ───────────────────────────────────────────────

const SECTION_PATTERNS: Array<[string, RegExp]> = [
  ["1. Equipment", /1\.\s*EQUIPMENT/i],
  ["2. Calibration-as-a-Service", /2\.\s*CALIBRATION-AS-A-SERVICE/i],
  ["3. Usage-Based Calibration Consumables", /3\.\s*USAGE-BASED\s+CALIBRATION\s+CONSUMABLES/i],
  ["3.1 Minimum commitment", /3\.1\s*Minimum commitment/i],
  ["3.2 Repricing", /3\.2\s*Repricing/i],
  ["3.3 Telemetry disputes", /3\.3\s*Telemetry disputes/i],
  ["4. Payment; Late Charges", /4\.\s*PAYMENT/i],
  ["5. Acceptance", /5\.\s*ACCEPTANCE/i],
  ["6. Term; Termination for Convenience", /6\.\s*TERM/i],
  ["7. Limited Warranty; Service Levels", /7\.\s*LIMITED\s+WARRANTY/i],
  ["8. Data; Telemetry Ownership", /8\.\s*DATA/i],
  ["9. Governing Law", /9\.\s*GOVERNING\s+LAW/i],
  ["Schedule A (heading)", /^(?:#+\s*)?SCHEDULE\s+A\s*[:—-]/m],
  ["Schedule B (heading)", /^(?:#+\s*)?SCHEDULE\s+B\s*[:—-]/m],
];

// ── B. Load-bearing terms ──────────────────────────────────────────────

const KEY_TERMS: Array<[string, RegExp]> = [
  ["equipment price 210,000", /USD\s*210,000/],
  ["service fee 14,500/mo", /USD\s*14,500/],
  ["monthly floor 9,000", /USD\s*9,000/],
  ["36-month service term", /thirty-six\s*\(36\)\s*months/i],
  ["10% repricing cap", /ten percent\s*\(10%\)/i],
  ["60-day repricing notice", /sixty\s*\(60\)\s*days/i],
  ["90-day termination notice", /ninety\s*\(90\)\s*days/i],
  ["30-day negotiation window", /thirty\s*\(30\)\s*days/i],
  ["10-business-day acceptance window", /ten\s*\(10\)\s*business days/i],
  ["12-month equipment warranty", /twelve\s*\(12\)\s*months/i],
  ["5% SLA credit cap", /5%/],
  ["RK-200 rate 310.00", /310\.00/],
  ["DC-100 rate 540.00", /540\.00/],
  ["CV-50 rate 410.00", /410\.00/],
  ["SLA response: 8 business hours", /8 business hours/i],
  ["SLA resolution: 3 business days", /3 business days/i],
  ["SLA response: 5 business days", /5 business days/i],
  ["SLA resolution: 15 business days", /15 business days/i],
  ["Michigan governing law", /Michigan/],
  ["Monthly Floor defined term", /Monthly Floor/],
  ["non-rollover floor language", /do not roll over/i],
  ["repricing-kills-floor mechanic", /cease to apply/i],
  ["termination-for-convenience fee", /early-termination fee/i],
  ["XCal-4000 equipment", /XCal-4000/],
  ["Meridian Labs party", /Meridian Labs,?\s*Inc/i],
  ["Novi, Michigan delivery", /Novi,\s*Michigan/i],
];

// ── C. Participant-facing cleanliness ──────────────────────────────────

const FORBIDDEN_IN_PARTICIPANT_COPIES: Array<[string, RegExp]> = [
  ["review marker (AMB-n)", /AMB-\d/],
  ["draft banner", /DRAFT\s*v\d/i],
  ["reviewer note", /Reviewer note/i],
  ["review record", /review record/i],
  ["LG ruling", /CONFIRMED\s*\(LG/i],
  ["stale annual value 540,000", /540,000/],
];

// ── D. Deep prose sync (sections 1–9, normalized) ──────────────────────

/**
 * Normalize a copy to comparable prose: sections 1–9 only (the schedules
 * are deliberately formatted differently — fixed-width text in the runtime
 * copy, markdown tables elsewhere — and are covered by checks A/B),
 * markdown chrome and review annotations stripped, line-wrap hyphenation
 * rejoined, whitespace collapsed, case unified.
 */
function normalizeProse(text: string): string {
  let t = text;
  const schedules = t.search(/^(?:#+\s*)?SCHEDULE\s+A\s*[:—-]/m);
  if (schedules >= 0) t = t.slice(0, schedules);
  // Drop everything before the party block (title, version banner, review record).
  const between = t.indexOf("Between:");
  if (between >= 0) t = t.slice(between);
  // Review-copy-only annotations.
  t = t.replace(/【[^】]*】/g, " ");
  t = t.replace(/^>.*$/gm, " ");
  // Markdown chrome.
  t = t.replace(/^---+$/gm, " ");
  t = t.replace(/[#*_`|]/g, " ");
  // Bold markers leave "USD 210,000 ," — collapse space-before-punctuation
  // so marker removal can't masquerade as prose drift.
  t = t.replace(/\s+([,.;:)])/g, "$1");
  // Dehyphenate line-wrapped words ("then-\nstandard" → "then-standard").
  t = t.replace(/-\s+/g, "-");
  t = t.toUpperCase();
  return t.replace(/\s+/g, " ").trim();
}

function firstDivergence(a: string, b: string): string {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  if (i === n && a.length === b.length) return "";
  const start = Math.max(0, i - 70);
  return `first divergence at char ${i}: A: "...${a.slice(start, i + 90)}..." | B: "...${b.slice(start, i + 90)}..."`;
}

// ── Run ────────────────────────────────────────────────────────────────

function main(): number {
  console.log("CONTRACT INTEGRITY — Meridian Labs agreement, three copies\n");

  // A. Section structure
  const sectionMisses: string[] = [];
  for (const [label, re] of SECTION_PATTERNS) {
    const missing = COPIES.filter((c) => !re.test(c.text));
    if (missing.length > 0) sectionMisses.push(`${label} ← missing in ${missing.map((c) => c.name).join(", ")}`);
  }
  check(
    `A section structure (${SECTION_PATTERNS.length} headings)`,
    sectionMisses.length === 0,
    sectionMisses.length === 0 ? "every heading present in all 3 copies" : sectionMisses.join("; "),
  );

  // B. Load-bearing terms
  const termMisses: string[] = [];
  for (const [label, re] of KEY_TERMS) {
    const missing = COPIES.filter((c) => !re.test(c.text));
    if (missing.length > 0) termMisses.push(`${label} ← missing in ${missing.map((c) => c.name).join(", ")}`);
  }
  check(
    `B load-bearing terms (${KEY_TERMS.length})`,
    termMisses.length === 0,
    termMisses.length === 0 ? "every figure/term/mechanic present in all 3 copies" : termMisses.join("; "),
  );

  // C. Participant-facing cleanliness
  const cleanlinessMisses: string[] = [];
  for (const c of COPIES.filter((x) => x.participantFacing)) {
    for (const [label, re] of FORBIDDEN_IN_PARTICIPANT_COPIES) {
      if (re.test(c.text)) cleanlinessMisses.push(`${label} found in ${c.name}`);
    }
    if (!/210,000 equipment purchase/.test(c.text)) cleanlinessMisses.push(`itemized header missing in ${c.name}`);
  }
  check(
    "C participant-facing copies clean",
    cleanlinessMisses.length === 0,
    cleanlinessMisses.length === 0 ? "served text + package copy free of review artifacts and stale values" : cleanlinessMisses.join("; "),
  );

  // D. Deep prose sync
  const norm = COPIES.map((c) => ({ name: c.name, text: normalizeProse(c.text) }));
  const sane = norm.every((n) => n.text.length >= 3000);
  check("D normalization sane (sections 1–9 non-trivial)", sane, `normalized lengths: ${norm.map((n) => n.text.length).join(", ")}`);
  if (sane) {
    const [runtime, pkg, review] = norm;
    const pairs: Array<[string, string, string, string]> = [
      ["runtime-served", runtime.text, "scenario package", pkg.text],
      ["runtime-served", runtime.text, "review doc", review.text],
      ["scenario package", pkg.text, "review doc", review.text],
    ];
    const divergences = pairs
      .map(([an, a, bn, b]) => ({ pair: `${an} ↔ ${bn}`, diff: firstDivergence(a, b) }))
      .filter((x) => x.diff !== "");
    check(
      "D deep prose sync (sections 1–9 identical across all 3)",
      divergences.length === 0,
      divergences.length === 0
        ? "normalized prose byte-identical across all 3 copies"
        : `${divergences.map((d) => `${d.pair}: ${d.diff}`).join(" || ")} — fix: apply the edit to ALL THREE copies (docs/meridian-labs-contract.md, scenarios/05.../documents/meridian-labs-agreement.md, src/runtime/meridian-doc.ts)`,
    );
  }

  // E. Review record intact
  const reviewRaw = COPIES[2].text;
  const rulingCount = (reviewRaw.match(/CONFIRMED \(LG/g) ?? []).length;
  check("E review doc carries the five LG rulings", rulingCount === 5, `${rulingCount}/5 rulings found`);
  check("E review doc records the header itemization", /Header value itemized/.test(reviewRaw), /Header value itemized/.test(reviewRaw) ? "itemization rationale present" : "review record lost the itemization entry");

  console.log(failures === 0 ? "\nCONTRACT INTEGRITY: PASS" : `\nCONTRACT INTEGRITY: FAIL (${failures})`);
  return failures === 0 ? 0 : 1;
}

process.exit(main());

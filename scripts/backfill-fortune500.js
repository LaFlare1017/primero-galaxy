#!/usr/bin/env node
/**
 * Backfill fortune500-data.ts with authoritative 2026 firmographics from
 * Fortune's ranking-page payload (extracted to /tmp/f500-2026.csv).
 *
 * For every existing dataset entry it matches a row from the live list and
 * overwrites fields with the primary-source value:
 *   - revenue   ($M, integer)
 *   - employees (integer)
 *   - location  ("City, ST" from Fortune City + State)
 *   - industry  (mapped from Fortune's granular Industry field into the
 *               12-value enum, only where the classification is unambiguous)
 *
 * Matching is CONSERVATIVE: it only accepts an exact normalized / deliberate
 * synonym match (e.g. IBM -> International Business Machines, UPS -> United
 * Parcel Service). It deliberately does NOT fall back to leading-token
 * matching, which silently grabs the wrong row for common distinguishing
 * words (e.g. "Johnson Controls" -> "Johnson & Johnson"). Unmatched entries
 * are reported but left untouched. Nothing is hallucinated: if Fortune has no
 * row for a company, that field is not changed.
 *
 * Reproduce the source CSV (the Fortune `/ranking/fortune500` page embeds the
 * list as a `__NEXT_DATA__` SSR JSON payload):
 *   curl -s https://fortune.com/ranking/fortune500/ \
 *     -A 'Mozilla/5.0 ...' | python3 -c '<extract franchiseSearch.items>' > /tmp/f500-2026.csv
 *
 * Usage: node scripts/backfill-fortune500.js [--csv path] [--write] [--no-industry]
 *   --csv          path to the Fortune extract (default /tmp/f500-2026.csv)
 *   --write        actually rewrite the file (default is a dry-run preview)
 *   --no-industry  skip the industry reclassification (default: apply)
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CSV = '/tmp/f500-2026.csv';
const DATA_FILE = path.join(__dirname, '..', 'lib', 'fortune500-data.ts');

const args = process.argv.slice(2);
const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : DEFAULT_CSV;
const doWrite = args.includes('--write');
const noIndustry = args.includes('--no-industry');

// ── Fortune Industry -> 12-value Industry enum mapping ──
// Fortune's granular `Industry` field maps cleanly to the dataset enum. We map
// only where the classification is unambiguous; industries that straddle
// categories (e.g. "Internet Services and Retailing") are left untouched so the
// curated galaxy color bands are not degraded.
const INDUSTRY_MAP = {
  // Technology
  'Semiconductors and Other Electronic Components': 'Technology',
  'Information Technology Services': 'Technology',
  'Computer Software': 'Technology',
  'Computers, Office Equipment': 'Technology',
  'Network and Other Communications Equipment': 'Technology',
  'Diversified Outsourcing Services': 'Technology',
  // Financial Services
  'Commercial Banks': 'Financial Services',
  'Securities': 'Financial Services',
  'Diversified Financials': 'Financial Services',
  'Financial Data Services': 'Financial Services',
  'Real estate': 'Financial Services',
  // Insurance
  'Insurance: Property and Casualty (Stock)': 'Insurance',
  'Insurance: Property and Casualty (Mutual)': 'Insurance',
  'Insurance: Life, Health (stock)': 'Insurance',
  'Insurance: Life, Health (Mutual)': 'Insurance',
  // 'Health Care: Insurance and Managed Care' is deliberately NOT mapped:
  // health plans are curated as Healthcare in the dataset, and flipping the
  // galaxy's color taxonomy on that judgment is not a factual backfill.
  // Healthcare
  'Pharmaceuticals': 'Healthcare',
  'Medical Products and Equipment': 'Healthcare',
  'Health Care: Medical Facilities': 'Healthcare',
  'Health Care: Pharmacy and Other Services': 'Healthcare',
  // Retail
  'Specialty Retailers: Other': 'Retail',
  'Specialty Retailers: Apparel': 'Retail',
  'General Merchandisers': 'Retail',
  'Food and Drug Stores': 'Retail',
  'Home Equipment, Furnishings': 'Retail',
  // Consumer Goods
  'Food Consumer Products': 'Consumer Goods',
  'Food Production': 'Consumer Goods',
  'Beverages': 'Consumer Goods',
  'Tobacco': 'Consumer Goods',
  'Household and Personal Products': 'Consumer Goods',
  'Apparel': 'Consumer Goods',
  'Food Services': 'Consumer Goods',
  // Automotive
  'Motor Vehicles & Parts': 'Automotive',
  'Automotive Retailing, Services': 'Automotive',
  // Aerospace & Defense
  'Aerospace & Defense': 'Aerospace & Defense',
  // Energy & Utilities
  'Utilities: Gas and Electric': 'Energy & Utilities',
  'Mining, Crude-Oil Production': 'Energy & Utilities',
  'Pipelines': 'Energy & Utilities',
  'Petroleum Refining': 'Energy & Utilities',
  'Energy': 'Energy & Utilities',
  'Oil and Gas Equipment, Services': 'Energy & Utilities',
  // Industrial & Manufacturing
  'Industrial Machinery': 'Industrial & Manufacturing',
  'Chemicals': 'Industrial & Manufacturing',
  'Engineering & Construction': 'Industrial & Manufacturing',
  'Construction and Farm Machinery': 'Industrial & Manufacturing',
  'Packaging, Containers': 'Industrial & Manufacturing',
  'Metals': 'Industrial & Manufacturing',
  'Building Materials, Glass': 'Industrial & Manufacturing',
  'Waste Management': 'Industrial & Manufacturing',
  // Transportation & Logistics
  'Transportation and Logistics': 'Transportation & Logistics',
  'Airlines': 'Transportation & Logistics',
  'Railroads': 'Transportation & Logistics',
  'Mail, Package, and Freight Delivery': 'Transportation & Logistics',
  'Trucking, Truck Leasing': 'Transportation & Logistics',
  // Telecom & Media
  'Telecommunications': 'Telecom & Media',
  'Entertainment': 'Telecom & Media',
  'Media': 'Telecom & Media',
  'Advertising, marketing': 'Telecom & Media',
};

// Full state name -> abbreviation, as they appear on the Fortune list
const STATE_ABBR = {
  'Alabama': 'AL','Arizona': 'AZ','Arkansas': 'AR','California': 'CA','Colorado': 'CO',
  'Connecticut': 'CT','Delaware': 'DE','District Of Columbia': 'DC','Florida': 'FL',
  'Georgia': 'GA','Idaho': 'ID','Illinois': 'IL','Indiana': 'IN','Iowa': 'IA','Kansas': 'KS',
  'Kentucky': 'KY','Louisiana': 'LA','Maryland': 'MD','Massachusetts': 'MA','Michigan': 'MI',
  'Minnesota': 'MN','Missouri': 'MO','Nebraska': 'NE','Nevada': 'NV','New Jersey': 'NJ',
  'New York': 'NY','North Carolina': 'NC','Ohio': 'OH','Oklahoma': 'OK','Oregon': 'OR',
  'Pennsylvania': 'PA','Rhode Island': 'RI','South Carolina': 'SC','South Dakota': 'SD',
  'Tennessee': 'TN','Texas': 'TX','Virginia': 'VA','Washington': 'WA','Wisconsin': 'WI',
};

// Strip only the suffixes that never form part of a brand name. "Group",
// "Holdings" and "Company" are kept because they can be part of a canonical
// name on the list (e.g. "Hartford Insurance Group") and the synonym map
// handles any real ambiguity between dataset and list forms.
const LEGAL_SUFFIX = /\s*(Corp\.?|Corporation|Inc\.?|Co\.?|Ltd\.?|LLC|LLP|plc|PLC|Industries|Systems|Technologies|International)$/;

// Dataset name (normalized) -> exact Fortune list name (normalized). These are
// deliberate, verified 1:1 mappings for companies whose dataset name differs
// from the list's canonical name. Only added where the correspondence is
// unambiguous; ambiguous or absent cases are left unmatched rather than guessed.
const SYNONYMS = {
  'ibm': 'international business machines',
  'the hartford': 'hartford insurance group',
  'ups': 'united parcel service',
  'disney': 'walt disney',
  'bny mellon': 'bank of new york bny',
  'schlumberger': 'slb',
  't mobile': 't mobile us',
  'verizon': 'verizon communications',
  'paramount': 'paramount skydance',
  'exxonmobil': 'exxonmobil holdings',
  'meta': 'meta platforms',
  'costco': 'costco wholesale',
  'paypal': 'paypal holdings',
  'ford': 'ford motor',
  'liberty mutual': 'liberty mutual insurance group',
  'capital one': 'capital one financial',
  'goldman sachs': 'goldman sachs group',
  'pnc financial': 'pnc financial services group',
  'truist': 'truist financial',
  'charles schwab': 'charles schwab',
  'micron': 'micron technology',
  'cognizant': 'cognizant technology solutions',
  'emerson': 'emerson electric',
  'iqvia': 'iqvia holdings',
  'c h robinson': 'c h robinson worldwide',
  'c h robinson worldwide': 'c h robinson worldwide',
  'j b hunt': 'j b hunt transport services',
  'j b hunt transport services': 'j b hunt transport services',
  'charter': 'charter communications',
  'altria': 'altria group',
  'american airlines': 'american airlines group',
  'cigna': 'cigna group',
  'united airlines': 'united airlines holdings',
  'amd': 'advanced micro devices',
};

/** Canonical-ish name used for cross-referencing. Strips punctuation/space and
 *  legal suffixes; does NOT expand synonyms (that happens at match time so
 *  both the dataset name and the list name resolve through the same map). */
function baseName(name) {
  return name.replace(LEGAL_SUFFIX, '')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
/** Resolve a name to a canonical key; synonym side expands to the Fortune form. */
function normName(name) {
  const b = baseName(name);
  return SYNONYMS[b] || b;
}
function parseMoney(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ── Load the Fortune extract (quote-aware CSV) ──
if (!fs.existsSync(csvPath)) {
  console.error(`Fortune CSV not found: ${csvPath}\nRerun the extraction step that writes /tmp/f500-2026.csv.`);
  process.exit(1);
}
function parseCSVLine(line) {
  const cells = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}
const csvLines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
const csvHeader = parseCSVLine(csvLines[0]).map((h) => h.trim());
const rows = csvLines.slice(1).filter(Boolean).map((line) => {
  const cells = parseCSVLine(line);
  const o = {};
  csvHeader.forEach((h, i) => { o[h] = (cells[i] || '').trim(); });
  return o;
});

const byNorm = new Map();
for (const r of rows) {
  byNorm.set(normName(r['name']), r);
}

// ── Parse the dataset into editable entry blocks (brace-aware) ──
const src = fs.readFileSync(DATA_FILE, 'utf8');

/** Split the array into balanced entry objects. Robust to nested { } in
 *  dimensionSources and to strings containing braces. */
function parseEntries(text) {
  const entries = [];
  const arrIdx = text.indexOf('FORTUNE500_AI_COMPANIES');
  let i = text.indexOf('\n  {', arrIdx);
  while (i !== -1) {
    const start = i + 1; // points at '{'
    let depth = 0, j = start, inStr = false, strCh = '';
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inStr) { if (ch === strCh && text[j - 1] !== '\\') inStr = false; continue; }
      if (ch === "'" || ch === '"') { inStr = true; strCh = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) break; // safety: unbalanced
    entries.push({ start, end: j + 1, block: text.slice(start, j + 1) });
    i = text.indexOf('\n  {', j + 1);
  }
  return entries;
}
const entries = parseEntries(src);

// find a field the way the file writes it (single- or double-quoted strings)
function findNum(block, field) {
  const mm = block.match(new RegExp(`\\b${field}:\\s*([0-9]+),`));
  return mm ? { start: mm.index + mm[0].indexOf(String(parseInt(mm[1], 10))), len: mm[1].length, value: parseInt(mm[1], 10) } : null;
}
function findStr(block, field) {
  // match  field: '<content>',  or  field: "<content>",
  const mm = block.match(new RegExp(`\\b${field}:\\s*(['"])([^'"]*)\\1,`));
  if (!mm) return null;
  const content = mm[2];
  const contentStart = mm.index + mm[0].indexOf(content) ;
  return { contentStart, len: content.length, value: content };
}

// ── Match + compute edits ──
const edits = [];
const unmatched = [];
let matched = 0;

for (const entry of entries) {
  // name field may be single- or double-quoted and may itself contain an
  // apostrophe (e.g. "Lowe's"), so match up to the closing quote + comma.
  const nameM = entry.block.match(/name:\s*['"]([\s\S]*?)['"],\n/);
  if (!nameM) { unmatched.push({ name: '(unparsed)', reason: 'no name field' }); continue; }
  const name = nameM[1].trim();

  // Match ONLY on an exact normalized / synonym match (e.g. IBM, UPS, Disney,
  // BNY Mellon). We deliberately do NOT fall back to leading-token matching:
  // it silently grabs the wrong row for common distinguishing words (e.g.
  // "Johnson Controls" -> "Johnson & Johnson", "American Airlines" -> another
  // "American X"). Companies without an exact match are reported as unmatched
  // so they can be added to SYNONYMS with a deliberate mapping instead of a
  // guess.
  let row = byNorm.get(normName(name));
  if (!row) { unmatched.push({ name, reason: 'no exact Fortune row' }); continue; }
  matched++;

  // revenue
  const revVal = parseMoney(row['revenue_m']);
  const rev = findNum(entry.block, 'revenue');
  if (revVal != null && rev && revVal !== rev.value)
    edits.push({ pos: entry.start + rev.start, len: rev.len, text: String(revVal), field: 'revenue', name });

  // employees
  const empVal = parseMoney(row['employees']);
  const emp = findNum(entry.block, 'employees');
  if (empVal != null && emp && empVal !== emp.value)
    edits.push({ pos: entry.start + emp.start, len: emp.len, text: String(empVal), field: 'employees', name });

  // location
  const loc = findStr(entry.block, 'location');
  if (row['city'] && row['state'] && STATE_ABBR[row['state']] && loc) {
    const newLoc = `${row['city']}, ${STATE_ABBR[row['state']]}`;
    if (newLoc !== loc.value)
      edits.push({ pos: entry.start + loc.contentStart, len: loc.len, text: newLoc, field: 'location', name });
  }

  // industry (mapped from Fortune's granular Industry field; only where the
  // classification is unambiguous and differs from the current curated value)
  if (!noIndustry) {
    const ind = findStr(entry.block, 'industry');
    const mapped = INDUSTRY_MAP[row['industry']];
    if (ind && mapped && mapped !== ind.value)
      edits.push({ pos: entry.start + ind.contentStart, len: ind.len, text: mapped, field: 'industry', name });
  }
}

// ── Apply edits from the end so earlier offsets stay valid ──
edits.sort((a, b) => b.pos - a.pos);
let result = src;
for (const e of edits) result = result.slice(0, e.pos) + e.text + result.slice(e.pos + e.len);

const counts = {};
for (const e of edits) counts[e.field] = (counts[e.field] || 0) + 1;

// ── Report ──
console.log(`Fortune extract rows: ${rows.length}`);
console.log(`Dataset entries parsed: ${entries.length}`);
console.log(`Matched to a Fortune row: ${matched}`);
console.log(`Unmatched (left untouched): ${unmatched.length}`);
for (const u of unmatched) console.log(`  - ${u.name} (${u.reason})`);
console.log('\nField updates (applied only with --write):');
for (const f of ['revenue', 'employees', 'location', 'industry'])
  console.log(`  ${f}: ${counts[f] || 0}`);
console.log('\nSample updates:');
for (const e of edits.slice(0, 10)) console.log(`  ${e.name}: ${e.field}=${e.text}`);

if (doWrite) {
  fs.writeFileSync(DATA_FILE, result);
  console.log(`\nWROTE ${DATA_FILE}`);
} else {
  console.log('\nDRY-RUN: no file changed. Rerun with --write to apply.');
}

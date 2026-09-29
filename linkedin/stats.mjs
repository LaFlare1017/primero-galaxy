/**
 * The numbers the LinkedIn assets are allowed to quote — read from the repo.
 *
 *   node linkedin/stats.mjs             check: fail if any asset disagrees
 *   node linkedin/stats.mjs --write     rewrite the generated parts in place
 *   node linkedin/stats.mjs --print     the facts table, and nothing else
 *
 * Why this exists: the copy in this folder quotes the repo — commits, declared
 * keyboards, enumerated states, tests — and a number typed into prose is a claim
 * nothing can check. Every figure here is COMPUTED from the thing it describes,
 * so it cannot disagree with the code; the assets read it through three
 * mechanisms, one per kind of text:
 *
 *   1. FACTS        computed below. A fact is derived or it is not a fact.
 *   2. CLAIMS       an inline sentence in article.md / copy.md / README.md,
 *                   located by a regex and rendered from the facts. `--write`
 *                   rewrites it; a check fails if the sentence no longer
 *                   matches (so a rewrite is loud, not a silent miss).
 *   3. SLOTS        `data-stat` / `data-count` attributes in carousel.html,
 *                   filled by render.mjs at render time — the deck's source has
 *                   no numbers in it at all, so the PDF cannot carry a stale one.
 *
 * The fourth mechanism is the audit: any number in the markdown that is neither
 * derived nor declared FROZEN (with a reason) fails the check. That is the point
 * — a gap that is named gets watched, and the alternative is a claim nobody
 * remembers typing.
 *
 * Numbers this script genuinely cannot derive are in FROZEN, each with the
 * reason it is not derived. If you quote a new number, derive it or declare it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../scripts/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const write = (rel, text) => writeFileSync(join(ROOT, rel), text);
const lineCount = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
const sum = (values) => values.reduce((total, value) => total + value, 0);

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Whether a revision is in `root` at all — a shallow clone is missing most. */
function present(root, rev) {
  try {
    execFileSync('git', ['cat-file', '-e', `${rev}^{commit}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Whether `from` is an ancestor of `to` (git counts a commit as its own ancestor). */
function reaches(root, from, to) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', from, to], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// What the numbers are read from
// ---------------------------------------------------------------------------

/**
 * The era these assets are about: a RANGE, with both ends declared as commits.
 *
 * It begins at the commit that declared the console's keys once
 * (RETROSPECTIVE-KEYBOARDS.md §2, row 1) and ends at the last commit that was
 * part of that session — the galaxy page's Escape ladder, which is the commit
 * `5 declared keyboards` and `4 of 5 surfaces` both need, and after which the
 * article's own narrative puts the drawer fix, the repository gates and this
 * script in a later session.
 *
 * Declared as commits rather than as a number, so the length is COUNTED from git
 * instead of typed. The upper end is deliberately not `HEAD`, and that is the
 * whole point of having two of them: counted to `HEAD` the number grew with
 * every commit in the repository — including work that was never part of the
 * session — so the era read as longer than it was, and an asset could never be
 * correct on the commit that carried it, because that commit was itself inside
 * the range. A bounded range reads the same on the commit that carries it as on
 * the commit after, which makes it a fact about the session rather than a fact
 * about how much has happened since.
 */
const ERA_FIRST = '51dfd5e';
/** The session's last commit: `Declare the galaxy page's Escape ladder`. */
const ERA_LAST = '5aaffda';

/**
 * The era's length, counted over its two declared ends.
 *
 * The guards are here because a count is the one answer that looks the same when
 * it is wrong: git refuses a range it cannot resolve at all, but counts half of
 * one happily — a shallow clone missing the era would report a smaller era
 * rather than no era. So both ends have to be commits in THIS checkout (which is
 * why the CI job fetches the full history), the first has to be an ancestor of
 * the last, and the last has to be behind `HEAD`, or the number describes a line
 * of history this checkout is not on.
 *
 * The root and the two ends are arguments whose defaults are the constants
 * above, and those defaults are the only ones this script uses: the doctor
 * proves these guards by pointing them at fixture repositories instead, whose
 * era is a range of commits it just made, and the states it has to catch are
 * exactly these. A guard the fixtures could not ask about somewhere else would
 * be a guard the doctor could only restate, which proves nothing.
 */
export function eraLength(root = ROOT, { first = ERA_FIRST, last = ERA_LAST } = {}) {
  for (const [name, rev] of [
    ['ERA_FIRST', first],
    ['ERA_LAST', last],
  ]) {
    if (!present(root, rev)) {
      throw new Error(
        `${name} (${rev}) is not in this checkout, so the era cannot be counted — ` +
          'a shallow clone has to fetch the history the era sits in (fetch-depth: 0)',
      );
    }
  }
  if (!reaches(root, first, last)) {
    throw new Error(
      `ERA_FIRST (${first}) is not an ancestor of ERA_LAST (${last}): that is not an era`,
    );
  }
  if (!reaches(root, last, 'HEAD')) {
    throw new Error(
      `ERA_LAST (${last}) is not in this branch's history, so the era did not land here`,
    );
  }
  const count = Number(
    execFileSync('git', ['rev-list', '--count', `${first}^..${last}`], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  );
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`the era ${first}..${last} counted ${count} commits`);
  }
  return count;
}

/** Every keyboard declaration in the app, and the surface it belongs to. */
const DECLARATIONS = [
  'components/delegate/consoleShortcuts.ts', // facilitator console
  'components/ui/commandPaletteKeys.ts', // ⌘K palette
  'components/ui/companySearchKeys.ts', // galaxy company search
  'components/ui/savedViewsKeys.ts', // saved-views panel
  'components/galaxy/galaxyKeys.ts', // the galaxy page's Escape ladder
];

/**
 * The state space, as each spec pins it. The specs assert these against the
 * worlds their enumeration produced, so reading the constant reads the surface's
 * own answer rather than a second opinion about it.
 */
const STATE_COUNTS = [
  ['e2e/delegate-shortcuts.spec.ts', 'STATE_COUNT'],
  ['e2e/command-palette.spec.ts', 'PALETTE_STATE_COUNT'],
  ['e2e/company-search-keys.spec.ts', 'SEARCH_STATE_COUNT'],
  ['e2e/saved-views-keys.spec.ts', 'SAVED_VIEWS_STATE_COUNT'],
  ['e2e/galaxy-keys.spec.ts', 'STATE_COUNT'],
];

/** The checkers' own spec, whose broken cases are counted rather than typed. */
const HARNESS_SPEC = 'e2e/keyboard-coherence.spec.ts';

/** The findings ledger, which is the record of what the era actually found. */
const LEDGER = 'RETROSPECTIVE-KEYBOARDS.md';

/**
 * One entry per ledger row, in order, saying what found it. `by: 'declaration'`
 * carries the surface whose keyboard was being written down; anything else names
 * the checker, because a finding a checker made is a different kind of evidence
 * and the copy counts the two separately. The count of rows is read from the
 * ledger table, so adding a finding there fails this script until it is
 * classified — the ledger is the record, this is only the composition.
 */
const FINDING_SOURCES = [
  { by: 'declaration', surface: 'the ⌘K palette' },
  { by: 'declaration', surface: 'the saved-views panel' },
  { by: 'agreement check' },
  { by: 'declaration', surface: 'the ⌘K palette' },
  { by: 'declaration', surface: 'the facilitator console' },
  { by: 'declaration', surface: 'the galaxy page' },
  { by: 'mutation' },
  { by: 'coverage step' },
];

/**
 * Numbers this script cannot derive, each with the reason. They are listed
 * rather than derived because deriving them would mean inventing a source: a
 * historical figure that is frozen, a platform's own limit, or a hand
 * measurement. Declaring them is what keeps the audit honest — an undeclared
 * number fails the check, so this map is a to-do list with a reason attached.
 */
const FROZEN = {
  '78': 'the previous article’s commit count, frozen the day it was published (galaxy/docs/LINKEDIN_ARTICLE.md)',
  '210': 'where LinkedIn truncates a post body — a platform fact, not a repo one',
  '1,600': 'the length of copy.md §1, measured by hand (~, to the nearest 100)',
  '1,100': 'the length of copy.md §2, measured by hand (~)',
  '700': 'the length of copy.md §3, measured by hand (~)',
  '1,080': 'the slide and page size, owned by render.mjs (--scale sets the PNG)',
  '2,160': 'the PNG size at the default --scale=2',
};

// ---------------------------------------------------------------------------
// Reading the repo
// ---------------------------------------------------------------------------

/** `const NAME = 56;` — the surface's own pin of how many states it enumerated. */
function pinnedStateCount(file, name) {
  const match = read(file).match(new RegExp(`const ${name} = ([0-9_]+);`));
  if (!match) throw new Error(`${file} no longer declares ${name}`);
  return Number(match[1].replace(/_/g, ''));
}

/**
 * The broken-manifest cases in the checkers' own spec: one count per `broken`
 * array, found by its `label:` entries. A parse that finds no array is a failure
 * rather than a zero — a count of nothing reads green, which is this project's
 * recurring enemy.
 */
function brokenManifestCases(file) {
  const source = read(file);
  const arrays = source.split('const broken: Array<{').slice(1);
  if (arrays.length === 0) throw new Error(`${file} no longer declares a broken case list`);
  const counts = arrays.map((array) => {
    const body = array.split('> = [')[1]?.split('\n    ];')[0] ?? '';
    return (body.match(/^\s+label:/gm) ?? []).length;
  });
  if (counts.some((count) => count === 0)) {
    throw new Error(`${file}: a broken case list parsed as empty — the shape changed`);
  }
  return counts;
}

/**
 * The suite's own answer to "how many tests": `playwright test --list` counts
 * them the way a run would, including the ones generated per surface, and prints
 * a per-file breakdown for free.
 */
function suite() {
  const output = execFileSync('npx', ['playwright', 'test', '--list'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const total = output.match(/Total: (\d+) tests in (\d+) files/);
  if (!total) throw new Error('playwright --list printed no total — is the config readable?');
  const perFile = {};
  for (const match of output.matchAll(/^\s+(\S+\.spec\.ts):\d+:\d+ ›/gm)) {
    perFile[match[1]] = (perFile[match[1]] ?? 0) + 1;
  }
  return { tests: Number(total[1]), testFiles: Number(total[2]), perFile };
}

/** What a slide actually SAYS: comments, stylesheet and tags removed. */
function deckText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/**
 * The findings ledger's rows: the table under the `# | Symptom` header, read
 * until the rows stop looking like rows. Anchored on that header because this
 * document has other tables with numbers in their first column — and a count
 * that silently picks up the wrong table is exactly the kind of number nobody
 * would question.
 */
function ledgerRows() {
  const lines = read(LEDGER).split('\n');
  const header = lines.findIndex((line) => /^\|\s*#\s*\|\s*Symptom\s*\|/.test(line));
  if (header === -1) throw new Error(`${LEDGER}: the findings ledger header was not found`);
  const rows = [];
  for (const line of lines.slice(header + 2)) {
    if (!/^\|\s*\d+\s*\|/.test(line)) break;
    rows.push(line);
  }
  if (rows.length === 0) throw new Error(`${LEDGER}: the findings ledger parsed as empty`);
  return rows.length;
}

/** Everything the assets are allowed to quote. */
export function facts() {
  const eraCommits = eraLength();
  const repoCommits = Number(git('rev-list', '--count', 'HEAD'));
  const date = git('log', '-1', '--format=%cs');

  const declaredKeyboards = DECLARATIONS.length;
  const declarationLines = sum(DECLARATIONS.map((file) => lineCount(read(file))));
  const states = sum(STATE_COUNTS.map(([file, name]) => pinnedStateCount(file, name)));
  const brokenManifests = sum(brokenManifestCases(HARNESS_SPEC));

  const findings = ledgerRows();
  if (findings !== FINDING_SOURCES.length) {
    throw new Error(
      `${LEDGER} lists ${findings} findings and this file classifies ${FINDING_SOURCES.length}: ` +
        'classify the new one above before quoting the count',
    );
  }
  const byDeclaration = FINDING_SOURCES.filter((finding) => finding.by === 'declaration');
  const surfacesWithBugs = new Set(byDeclaration.map((finding) => finding.surface)).size;
  const failedChecks = FINDING_SOURCES.filter((finding) => finding.by === 'mutation').length;

  const { tests, testFiles, perFile } = suite();
  const harnessSpecTests = perFile['keyboard-coherence.spec.ts'];
  if (!harnessSpecTests) throw new Error(`playwright --list did not report ${HARNESS_SPEC}`);

  // Comments are stripped first: the deck's own editing note quotes the slide
  // markup verbatim, and counting that as a slide is the kind of error that
  // would survive review ("11 slides" in a ten-slide deck).
  const deck = read('linkedin/carousel.html').replace(/<!--[\s\S]*?-->/g, '');
  const slides = (deck.match(/<section class="slide"/g) ?? []).length;
  if (slides === 0) throw new Error('linkedin/carousel.html has no slides');

  return {
    date,
    eraCommits,
    repoCommits,
    declaredKeyboards,
    declarationLines,
    states,
    brokenManifests,
    findings,
    surfacesWithBugs,
    failedChecks,
    tests,
    testFiles,
    harnessSpecTests,
    slides,
  };
}

const num = (value) => Number(value).toLocaleString('en-US');
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** Prose spells small numbers out; the renderers below are the only spellers. */
const word = (value) => WORDS[value] ?? num(value);
/** For a renderer that starts a sentence — capitalization is a claim too. */
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * How each quotable number is written. One definition per number, shared by the
 * markdown claims and the carousel's `data-stat` slots, so the deck and the
 * article cannot be told differently.
 */
export const RENDER = {
  date: (f) => f.date,
  eraCommits: (f) => num(f.eraCommits),
  repoCommits: (f) => num(f.repoCommits),
  declaredKeyboards: (f) => num(f.declaredKeyboards),
  declarationLines: (f) => num(f.declarationLines),
  states: (f) => num(f.states),
  brokenManifests: (f) => num(f.brokenManifests),
  findings: (f) => num(f.findings),
  surfacesWithBugs: (f) => num(f.surfacesWithBugs),
  surfacesOfDeclared: (f) => `${num(f.surfacesWithBugs)} of ${num(f.declaredKeyboards)}`,
  surfacesOfDeclaredWords: (f) => `${word(f.surfacesWithBugs)} of ${word(f.declaredKeyboards)}`,
  failedChecks: (f) => num(f.failedChecks),
  tests: (f) => num(f.tests),
  testFiles: (f) => num(f.testFiles),
  harnessSpecTests: (f) => num(f.harnessSpecTests),
  slides: (f) => num(f.slides),
  slidesWords: (f) => word(f.slides),
};

// ---------------------------------------------------------------------------
// The assets
// ---------------------------------------------------------------------------

/** The facts line both long-form assets open with (and the README's honesty list). */
const statsLine = (f) =>
  [
    `${num(f.eraCommits)} commits`,
    `${num(f.declaredKeyboards)} declared keyboards`,
    `${num(f.declarationLines)} lines of declaration`,
    `${num(f.states)} states enumerated`,
    `${num(f.tests)} e2e tests across ${num(f.testFiles)} files`,
    `${RENDER.surfacesOfDeclared(f)} surfaces produced a real defect on the day they were declared`,
    `${num(f.brokenManifests)} ways the checkers break a synthetic manifest`,
    `${num(f.failedChecks)} test that passed when it should have failed`,
  ].join(' · ');

/**
 * Inline claims: a sentence located by a regex, rendered from the facts. The
 * regex must match the whole sentence that carries the numbers, so the check
 * compares the numbers AND their context — a rewrite of the sentence fails
 * loudly instead of quietly dropping out of the audit.
 */
const CLAIMS = [
  {
    id: 'article.title',
    file: 'linkedin/article.md',
    find: /(\d[\d,]*) commits taught me/g,
    render: (f) => `${num(f.eraCommits)} commits taught me`,
  },
  {
    id: 'article.surfaces',
    file: 'linkedin/article.md',
    find: /(\w+) of the (\w+) surfaces produced a real defect/g,
    render: (f) =>
      `${cap(word(f.surfacesWithBugs))} of the ${word(f.declaredKeyboards)} surfaces produced a real defect`,
  },
  {
    id: 'copy.post1.stats',
    file: 'linkedin/copy.md',
    find: /(\w+) surfaces, ([\d,]+) lines of declaration, ([\d,]+) enumerated states, ([\d,]+) tests\./g,
    render: (f) =>
      `${cap(word(f.declaredKeyboards))} surfaces, ${num(f.declarationLines)} lines of declaration, ` +
      `${num(f.states)} enumerated states, ${num(f.tests)} tests.`,
  },
  {
    id: 'copy.alt.slide1.lead',
    file: 'linkedin/copy.md',
    find: /(\d[\d,]*) commits to make an invisible interface checkable/g,
    render: (f) => `${num(f.eraCommits)} commits to make an invisible interface checkable`,
  },
  {
    id: 'copy.post5.context',
    file: 'linkedin/copy.md',
    find: /hold ([\d,]+) lines of declaration in context/g,
    render: (f) => `hold ${num(f.declarationLines)} lines of declaration in context`,
  },
  {
    id: 'copy.alt.slide1',
    file: 'linkedin/copy.md',
    find: /Footer: ([\d,]+) declared keyboards, ([\d,]+) states, ([\d,]+) tests\./g,
    render: (f) =>
      `Footer: ${num(f.declaredKeyboards)} declared keyboards, ${num(f.states)} states, ${num(f.tests)} tests.`,
  },
  {
    id: 'readme.tree.slides',
    file: 'linkedin/README.md',
    find: /(\d+) slides at 1080x1080/g,
    render: (f) => `${num(f.slides)} slides at 1080x1080`,
  },
  {
    id: 'readme.upload.pages',
    file: 'linkedin/README.md',
    find: /It is (\w+) 1080×1080 pages, one per slide\./g,
    render: (f) => `It is ${word(f.slides)} 1080×1080 pages, one per slide.`,
  },
  {
    id: 'readme.heading.slides',
    file: 'linkedin/README.md',
    find: /## The (\w+) slides/g,
    render: (f) => `## The ${word(f.slides)} slides`,
  },
];

/**
 * Generated blocks: everything between the markers is the script's, which is how
 * a line with six numbers in it stays readable and still cannot drift.
 */
const BLOCKS = [
  {
    id: 'article.stats',
    file: 'linkedin/article.md',
    render: (f) => `**The stats up front:**\n${statsLine(f)}`,
  },
  {
    id: 'copy.figures',
    file: 'linkedin/copy.md',
    render: (f) =>
      `All figures are the repo's real ones, read out of it by \`linkedin/stats.mjs\`\n` +
      `as of ${f.date}: ${num(f.eraCommits)} commits in the era, ${num(f.declaredKeyboards)} declared\n` +
      `keyboards, ${num(f.declarationLines)} lines of declaration, ${num(f.states)} enumerated states,\n` +
      `${num(f.tests)} e2e tests in ${num(f.testFiles)} files, ${num(f.findings)} findings.`,
  },
  {
    id: 'copy.numbers',
    file: 'linkedin/copy.md',
    render: (f) =>
      `- **Numbers to keep honest if you edit**: generated — run\n` +
      `  \`node linkedin/stats.mjs --write\` rather than editing them. ${num(f.eraCommits)} commits in\n` +
      `  the era · ${num(f.declaredKeyboards)} declared keyboards · ${num(f.declarationLines)} lines of\n` +
      `  declaration · ${num(f.states)} enumerated states · ${num(f.tests)} e2e tests across\n` +
      `  ${num(f.testFiles)} files · ${num(f.findings)} findings, of which\n` +
      `  ${RENDER.surfacesOfDeclared(f)} surfaces found theirs by declaring ·\n` +
      `  ${num(f.brokenManifests)} ways the checkers' own spec breaks a synthetic manifest ·\n` +
      `  ${num(f.harnessSpecTests)} tests holding the checkers to that standard.`,
  },
  {
    id: 'readme.honest',
    file: 'linkedin/README.md',
    render: (f) =>
      `- Every number is the repo's real one, and none of them is typed: \`linkedin/stats.mjs\`\n` +
      `  reads them out of the repo (git, the declaration modules, the specs,\n` +
      `  \`playwright --list\`) and fails if any asset disagrees with what it found — this\n` +
      `  line included. Right now: ${num(f.eraCommits)} commits in the era,\n` +
      `  ${num(f.declaredKeyboards)} declared keyboards, ${num(f.declarationLines)} lines of declaration,\n` +
      `  ${num(f.states)} enumerated states, ${num(f.tests)} e2e tests in ${num(f.testFiles)} files,\n` +
      `  ${RENDER.surfacesOfDeclared(f)} surfaces that found a defect by declaring their keyboard,\n` +
      `  ${num(f.brokenManifests)} ways the checkers' own spec breaks a synthetic manifest, and\n` +
      `  ${num(f.harnessSpecTests)} tests holding the checkers to that same standard.`,
  },
];

const BEGIN = (id) => `<!-- stats:begin ${id} -->`;
const END = '<!-- stats:end -->';

// ---------------------------------------------------------------------------
// Check, write, audit
// ---------------------------------------------------------------------------

const problems = [];

function renderBlock(block, f) {
  return `${BEGIN(block.id)}\n${block.render(f)}\n${END}`;
}

function checkBlocks(current, f) {
  for (const block of BLOCKS) {
    const source = current.get(block.file);
    const wanted = renderBlock(block, f);
    const pattern = new RegExp(
      `${BEGIN(block.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    );
    const found = source.match(pattern);
    if (!found) {
      problems.push(`${block.file}: block "${block.id}" is missing its markers`);
      continue;
    }
    if (found[0] !== wanted) problems.push(`${block.file}: block "${block.id}" is stale`);
  }
}

function writeAll(current, f) {
  for (const claim of CLAIMS) {
    const source = current.get(claim.file);
    // Matched, not "changed": a claim that is already right replaces itself with
    // itself, and comparing the strings would call that a missing sentence.
    if ([...source.matchAll(claim.find)].length === 0) {
      throw new Error(`${claim.file}: claim "${claim.id}" matched nothing`);
    }
    current.set(claim.file, source.replace(claim.find, claim.render(f)));
  }
  for (const block of BLOCKS) {
    const source = current.get(block.file);
    const wanted = renderBlock(block, f);
    const pattern = new RegExp(
      `${BEGIN(block.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    );
    if (!pattern.test(source)) throw new Error(`${block.file}: block "${block.id}" has no markers`);
    current.set(block.file, source.replace(pattern, wanted));
  }
  for (const [file, text] of current) {
    if (text !== read(file)) {
      write(file, text);
      console.log(`wrote ${file}`);
    }
  }
}

/**
 * Numbers in the prose that are neither derived nor declared.
 *
 * What this is FOR: the claims and blocks above cover every figure the copy
 * quotes knowingly, so the audit's job is the one typed somewhere else — by a
 * later edit, or by me at 1am. It therefore ignores what is not a claim: single
 * digits (list numbering, `§2`, `--scale=1`), digits inside a word or a hashtag
 * (`#A11y`), and anything already inside a claim or a generated block, which
 * those mechanisms have verified. What survives is a two-digit-or-more number
 * standing alone in prose — a claim about the repo, or something to declare.
 */
function audit(f) {
  const AUDITED = ['linkedin/article.md', 'linkedin/copy.md', 'linkedin/README.md', 'linkedin/carousel.html'];
  const known = new Set();
  for (const render of Object.values(RENDER)) {
    for (const token of String(render(f)).match(/\d[\d,]*/g) ?? []) known.add(token.replace(/,/g, ''));
  }
  for (const token of Object.keys(FROZEN)) known.add(token.replace(/,/g, ''));
  const looksKnown = (token) => known.has(token.replace(/,/g, ''));

  const undeclared = [];
  let swept = 0;
  for (const file of AUDITED) {
    // The deck is audited as TEXT: its numbers live in `data-stat` slots, so a
    // digit left in the prose is either structural (a step number) or a claim
    // that has to be declared. Markup and CSS come out first — nothing else in
    // this repo has more numbers in it than a stylesheet.
    const source = file === 'linkedin/carousel.html' ? deckText(read(file)) : read(file);

    // The spans this script already owns: claim matches, and block bodies.
    const owned = [];
    for (const claim of CLAIMS.filter((claim) => claim.file === file)) {
      for (const match of source.matchAll(claim.find)) owned.push([match.index, match.index + match[0].length]);
    }
    for (const block of BLOCKS.filter((block) => block.file === file)) {
      const start = source.indexOf(BEGIN(block.id));
      const end = source.indexOf(END, start);
      if (start !== -1 && end !== -1) owned.push([start, end + END.length]);
    }
    const inOwned = (index) => owned.some(([start, end]) => index >= start && index < end);

    let offset = 0;
    source.split('\n').forEach((raw, index) => {
      // A date is the date fact, wherever it is written.
      const line = raw.replace(/\d{4}-\d{2}-\d{2}/g, ' DATE ');
      for (const match of line.matchAll(/\d[\d,]*/g)) {
        const token = match[0];
        const before = line.slice(0, match.index).slice(-1);
        if (token.replace(/,/g, '').length < 2) continue; // list numbers, §2, --scale=1
        if (/[\w#]/.test(before)) continue; // inside a word or a hashtag: #A11y
        if (inOwned(offset + match.index)) continue; // already checked as a claim or a block
        swept += 1;
        if (!looksKnown(token)) {
          undeclared.push(`${file}:${index + 1}  ${token}  …${raw.trim().slice(0, 72)}`);
        }
      }
      offset += raw.length + 1;
    });
  }

  // A sweep that found nothing would make every assertion built on it true.
  if (swept === 0) throw new Error('the number audit swept nothing — its pattern or its files moved');
  return { undeclared, swept };
}

function printFacts(f) {
  const rows = [
    ['commits in the era', `${f.eraCommits}  (since ${ERA_FIRST})`],
    ['commits in the repo', String(f.repoCommits)],
    ['HEAD date', f.date],
    ['declared keyboards', String(f.declaredKeyboards)],
    ['lines of declaration', String(f.declarationLines)],
    ['states enumerated', String(f.states)],
    ['broken manifest cases', String(f.brokenManifests)],
    ['findings (from the ledger)', String(f.findings)],
    ['  …found by declaring', `${f.surfacesWithBugs} surfaces`],
    ['  …found by a check that failed', String(f.failedChecks)],
    ['e2e tests', `${f.tests} in ${f.testFiles} files`],
    ['  …in the checkers’ own spec', String(f.harnessSpecTests)],
    ['slides', String(f.slides)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  console.log('Facts, read from the repo\n');
  for (const [label, value] of rows) console.log(`  ${label.padEnd(width)}  ${value}`);
  console.log('\nDeclared frozen (cannot be derived — see the reason in stats.mjs):');
  for (const [token, reason] of Object.entries(FROZEN)) console.log(`  ${token.padEnd(6)}  ${reason}`);
}

async function main() {
  const mode = process.argv.includes('--write')
    ? 'write'
    : process.argv.includes('--print')
      ? 'print'
      : 'check';

  const f = facts();
  if (mode === 'print') return printFacts(f);

  const files = new Set([...CLAIMS.map((claim) => claim.file), ...BLOCKS.map((block) => block.file)]);
  const current = new Map([...files].map((file) => [file, read(file)]));

  if (mode === 'write') {
    writeAll(current, f);
    printFacts(f);
    return;
  }

  for (const claim of CLAIMS) {
    const source = current.get(claim.file);
    const matches = [...source.matchAll(claim.find)];
    if (matches.length === 0) {
      problems.push(`${claim.file}: claim "${claim.id}" matched nothing — the sentence moved`);
      continue;
    }
    const wanted = claim.render(f);
    for (const match of matches) {
      if (match[0] !== wanted) {
        problems.push(`${claim.file}: claim "${claim.id}"\n    is:   ${match[0]}\n    want: ${wanted}`);
      }
    }
  }
  checkBlocks(current, f);

  const { undeclared, swept } = audit(f);
  if (undeclared.length > 0) {
    problems.push(
      `numbers in the prose that are neither derived nor declared frozen (${undeclared.length}):\n` +
        undeclared.map((line) => `    ${line}`).join('\n'),
    );
  }

  if (problems.length > 0) {
    console.error(`linkedin assets disagree with the repo (${problems.length}):\n`);
    for (const problem of problems) console.error(`  ${problem}\n`);
    console.error('Run `node linkedin/stats.mjs --write`, or derive the number in stats.mjs.');
    process.exit(1);
  }
  printFacts(f);
  console.log(
    `\nEvery quoted number agrees with the repo, and the ${swept} figures the claims and\n` +
      'blocks do not own were derived or declared frozen.',
  );
}

// Only when run as the script: render.mjs imports `facts` from here, and a
// module that checks the assets as a side effect of being imported would make
// the renderer's output depend on files it does not read.
if (isMain(import.meta.url)) {
  await main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

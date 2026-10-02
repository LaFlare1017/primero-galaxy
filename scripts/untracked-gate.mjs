#!/usr/bin/env node
/**
 * Gate: no generated or vendored path may sit untracked and unignored.
 *
 * The gitignore gate's mirror. That one asks about the tracked half of a
 * contradiction — a committed file a rule also covers — and this one asks about
 * the other: an artifact the repo *makes* or *installs* that git is never told
 * about, so every `git status` lists it again, forever, and the only thing
 * standing between it and a commit is somebody remembering not to type
 * `git add -A`.
 *
 * "Should be ignored" is the whole difficulty, so it is never guessed at. Each
 * candidate has to carry its own evidence, taken from the repo rather than from
 * a list of paths kept in step by hand:
 *
 *   installed   its name is declared by a tracked lockfile that installs copies
 *               into the tree (`skills-lock.json`). The lockfile is the half
 *               that belongs in git; the copies it describes are the half that
 *               does not. `package-lock.json` / `node_modules` is the same
 *               shape, and this repo already ignores that one.
 *   project     it is its own project — `package.json`, a lockfile, `.github/`,
 *               `.husky/`, `node_modules/`, a `.git/` — i.e. a vendored copy of
 *               somebody else's repository.
 *   build       its name is a directory this repo already ignores elsewhere
 *               (`dist`, `build`, `out`, `coverage`, `.next*`, `test-results`).
 *               The rule exists; it just does not reach this second location,
 *               which is exactly the mistake b9ae9de fixed for `node_modules`.
 *   media       a single file of a megabyte or more whose extension is audio,
 *               video or an archive: render output, not source.
 *   generated   its content says so in the first few lines — `do not edit`,
 *               `auto-generated`. A marker read anywhere in a file would be
 *               wrong: prose *about* generated code mentions the phrase too, and
 *               `public/program-status.html` is exactly that case.
 *
 * Everything else untracked is reported as unaccounted and left alone. A new
 * source file is untracked and unignored and must not be an error — it is a
 * decision in progress, and a gate that failed on it would be turned off within
 * a day.
 *
 * This can only speak locally: a fresh clone has nothing untracked, so there is
 * no CI step for it, and a check that always passes on CI would be a reassurance
 * rather than a check. It belongs where a working tree actually exists.
 *
 * `--fix` writes the lines it prints, in this order: the report, then the diff of
 * what is about to be written, then the write, then a read-back. The diff is
 * git's own — a hand-made one would be a second implementation of the thing the
 * reader trusts — and the read-back asks both questions that matter, since this
 * is the one place here that edits a tracked file: the audit has to come back
 * clean, and `scripts/gitignore-gate.mjs` has to still find no tracked path under
 * a rule, because a fix that satisfies this gate by breaking that one would be
 * worse than no fix. It refuses to append a line `.gitignore` already has: if the
 * lines are all there and the paths are still uncovered, something later in the
 * file — a `!` negation, usually — is undoing them, and a second copy would be
 * undone the same way.
 *
 * `--fix --dry-run` stops after the diff. Nothing is written, so there is nothing
 * to read back, and the run says that rather than claiming a repair it did not
 * make — reading the change before agreeing to it is the reason to ask for a dry
 * run at all. It still exits 1: the paths it found are still uncovered, and a dry
 * run that exited 0 would be indistinguishable from a repair to anything
 * scripting it. `--dry-run` on its own is refused, because that is what a plain
 * run already is.
 *
 * `--fix` is not the doctor's business, and the doctor does not call it: the
 * doctor reports, and `scripts/doctor/checks/untracked.mjs` proves the reading.
 * The writing is proved where it lives, by `proveItCanFix` below, and the shared
 * `preview` it writes through by a fixture of its own in
 * `scripts/ignore-file.mjs` — asked for here as well, since a fault in that one
 * function would reach this gate and the gitignore gate at once.
 *
 * Usage:
 *   node scripts/untracked-gate.mjs [--fix [--dry-run]]
 *
 * Exit codes: 0 nothing to account for, or the rules were written and read back
 * · 1 a generated or vendored path is unaccounted for, a dry run that stopped at
 * the diff, or the lines are already there and something else is winning · 2 the
 * scan itself could not run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { scan } from './gitignore-gate.mjs';
import { appended, preview, proveItCanPreview } from './ignore-file.mjs';
import { isMain } from './is-main.mjs';

/**
 * Tracked manifests that install copies into the working tree, and the key
 * their names live under. Add one here when the repo adopts another — the point
 * is that this list names *files whose contents decide*, never paths.
 */
const MANIFESTS = [['skills-lock.json', 'skills']];

/** A vendored copy announces itself with one of these. */
const PROJECT_MARKERS = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'node_modules', '.git', '.github', '.husky'];

/** Directory names this repo already treats as disposable somewhere. */
const BUILD_NAMES = /^(dist|build|out|coverage|node_modules|test-results|playwright-report|\.next.*|\.turbo|\.parcel-cache|\.cache|\.vercel)$/;

/** Render output rather than source, once it is big enough to say so. */
const MEDIA = /\.(mp4|mov|webm|mkv|avi|wav|mp3|m4a|zip|tar|tgz|gz|dmg|iso|psd|sketch)$/;
const MEDIA_FLOOR = 1024 * 1024;

/** Generation markers, read from the head of a file only. */
const GENERATED = [
  /do not edit/i,
  /auto-?generated/i,
  /generated (by|from)\b/i,
  /@generated\b/,
  /this file (is|was) generated/i,
];
const HEAD_LINES = 5;
const SCAN_MAX_BYTES = 64 * 1024;
const SCAN_MAX_FILES = 200;

function git(args, { cwd, allowMissing = false } = {}) {
  const result = spawnSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`could not run \`git ${args.join(' ')}\`: ${result.error.message}`);
  if (result.status !== 0 && !allowMissing) {
    const detail = (result.stderr ?? '').toString().trim();
    throw new Error(`\`git ${args.join(' ')}\` exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8');
}

/** The names a tracked manifest declares, or an empty set if it is absent. */
function declared(root) {
  const names = new Set();
  const sources = [];
  for (const [file, key] of MANIFESTS) {
    if (!existsSync(join(root, file))) continue;
    // Only the tracked half speaks for the repo; an untracked lockfile is just
    // another file nobody has decided about.
    if (git(['ls-files', '--', file], { cwd: root }).trim() === '') continue;
    const contents = JSON.parse(readFileSync(join(root, file), 'utf8'));
    for (const name of Object.keys(contents[key] ?? {})) names.add(name);
    sources.push(file);
  }
  return { names, sources };
}

/** A generation marker in the head of one file. */
function marked(file) {
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > SCAN_MAX_BYTES) return false;
    const head = readFileSync(file, 'utf8').split('\n').slice(0, HEAD_LINES).join('\n');
    return GENERATED.some((pattern) => pattern.test(head));
  } catch {
    return false;
  }
}

/**
 * One bounded walk of a directory candidate, never following a symlink and
 * never descending into `node_modules`, answering both questions a directory can
 * only answer from the inside: does it contain an install a manifest declares,
 * and does any file in it say it was generated. Bounded because the point is a
 * decision, not an inventory.
 */
function walk(dir, names) {
  const queue = [dir];
  let seen = 0;
  let declared = null;
  let generated = null;
  while (queue.length > 0 && seen < SCAN_MAX_FILES) {
    const current = queue.shift();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === 'node_modules') continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (declared === null && names.has(entry.name)) declared = path;
        queue.push(path);
      } else if (entry.isFile()) {
        seen += 1;
        if (generated === null && marked(path)) generated = path;
        if (seen >= SCAN_MAX_FILES) break;
      }
    }
  }
  return { declared, generated };
}

/** The anchored rule that covers exactly this path, and nothing beside it. */
function ownRule(path, isDirectory) {
  return `/${path}${isDirectory ? '/' : ''}`;
}

/**
 * The rule to paste for one hit: its parent when that parent is a tidy group —
 * an artifact family with at most a couple of tracked survivors to re-include —
 * and the path itself otherwise. A build directory inside `lib/` is
 * `/lib/out/`, not an `/lib/*` line that has to re-include seven source files to
 * stay honest.
 */
function tidyRule(hit, tracked) {
  const parent = dirname(hit.path);
  if (parent === '.') return { rule: hit.rule, lines: [hit.rule] };
  const parentRule = `/${parent}/`;
  const lines = rulesFor(parentRule, tracked);
  return lines.length <= 3 ? { rule: parentRule, lines } : { rule: hit.rule, lines: [hit.rule] };
}

/**
 * Why this untracked path is generated or vendored, or null if it is simply
 * untracked. Cheap evidence is asked for first: reading a directory's contents
 * is the last resort, not the first question.
 */
function evidenceFor(root, path, { names, sources }) {
  const full = join(root, path);
  const stat = lstatSync(full);
  const directory = stat.isDirectory();
  const base = basename(path);
  const rule = ownRule(path, directory);

  if (names.has(base)) {
    return { kind: 'installed', rule, directory, detail: `installed by ${sources.join(', ')}` };
  }

  if (directory) {
    const markers = PROJECT_MARKERS.filter((marker) => existsSync(join(full, marker)));
    if (markers.length > 0) {
      return { kind: 'project', rule, directory, detail: `its own project: ${markers.join(', ')}` };
    }
    if (BUILD_NAMES.test(base)) {
      return { kind: 'build', rule, directory, detail: 'a build directory, ignored elsewhere in this repo' };
    }
    // The install is looked for *inside* as well as named: git reports a wholly
    // untracked tree as its topmost directory, so the line that reaches this
    // function may be `.agents/` rather than `.agents/skills/brandkit/`, and a
    // check that only read the basename would miss every copy underneath it.
    const inside = walk(full, names);
    if (inside.declared) {
      return { kind: 'installed', rule, directory, detail: `installed by ${sources.join(', ')} — ${relative(full, inside.declared)}` };
    }
    if (inside.generated) {
      return { kind: 'generated', rule, directory, detail: `says so itself — ${relative(full, inside.generated)}` };
    }
    return null;
  }

  if (BUILD_NAMES.test(base)) {
    return { kind: 'build', rule, directory, detail: 'a build artifact, ignored elsewhere in this repo' };
  }
  if (stat.isFile() && MEDIA.test(path) && stat.size >= MEDIA_FLOOR) {
    return { kind: 'media', rule, directory, detail: `${(stat.size / (1024 * 1024)).toFixed(1)} MB of untracked media` };
  }
  if (marked(full)) {
    return { kind: 'generated', rule, directory, detail: 'says so itself in its opening lines' };
  }
  return null;
}

/**
 * The `.gitignore` lines that cover a group without contradicting the other
 * gate. A rule is only half the answer: this repo keeps a *tracked* copy inside
 * two of the families above (`.agents/skills/libraries-dev`, and its symlink),
 * and ignoring a directory wholesale would make those covered by a rule — which
 * is exactly the contradiction `scripts/gitignore-gate.mjs` fails on. So when a
 * tracked path sits under the rule, the rule globs the directory's contents
 * instead and re-includes what belongs, the way git requires (a negation inside
 * an ignored directory is never reached, so `dir/` plus `!dir/keep` cannot
 * work and `dir/*` plus `!dir/keep` can).
 */
function rulesFor(rule, tracked) {
  const prefix = rule.startsWith('/') && rule.endsWith('/') ? rule.slice(1) : null;
  if (prefix === null) return [rule];
  const inside = tracked.filter((path) => path.startsWith(prefix));
  if (inside.length === 0) return [rule];

  const keep = new Set();
  for (const path of inside) {
    const rest = path.slice(prefix.length);
    const [first, ...more] = rest.split('/');
    keep.add(`!${rule}${first}${more.length > 0 ? '/' : ''}`);
  }
  return [`${rule}*`, ...[...keep].sort()];
}

/**
 * The untracked paths git is currently complaining about, split into the ones
 * the repo can account for (generated or vendored — they should be ignored) and
 * the ones nobody has decided about (reported, never an error).
 *
 * `git status` is the source rather than `ls-files --others` on purpose: its
 * list is what a person actually sees, and the two disagree at the edges — an
 * untracked directory with no files in it is noise in neither and a phantom in
 * `--others --directory`.
 */
export function audit(root) {
  const lines = git(['status', '--porcelain', '-z', '--untracked-files=normal'], { cwd: root })
    .split('\0')
    .filter(Boolean);
  const untracked = [];
  for (const line of lines) {
    if (!line.startsWith('?? ')) continue;
    const path = line.slice(3);
    untracked.push(path.endsWith('/') ? path.slice(0, -1) : path);
  }

  const manifest = declared(root);
  const hits = [];
  const unaccounted = [];
  for (const path of untracked) {
    const evidence = evidenceFor(root, path, manifest);
    if (evidence) hits.push({ path, ...evidence });
    else unaccounted.push(path);
  }

  // One rule per group, because the fix is a line in `.gitignore` and thirteen
  // installed copies are one line, not thirteen.
  const tracked = git(['ls-files', '-z'], { cwd: root }).split('\0').filter(Boolean);
  const groups = new Map();
  for (const hit of hits) {
    const { rule, lines } = tidyRule(hit, tracked);
    const group = groups.get(rule) ?? { rule, kind: hit.kind, detail: hit.detail, paths: [], lines };
    group.paths.push(hit.path);
    groups.set(rule, group);
  }

  return {
    untracked: untracked.length,
    hits,
    groups: [...groups.values()].sort((a, b) => b.paths.length - a.paths.length || a.rule.localeCompare(b.rule)),
    unaccounted,
    sources: manifest.sources,
  };
}

/** Just the run of path below the root, or below the candidate it was found in. */
function relative(root, path) {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/**
 * The gate's own fixture. Three planted artifacts, one per kind of evidence,
 * and a plain new source file that must come back unaccounted — a checker that
 * cannot miss the first is not checking, and one that flags the last is one
 * nobody keeps switched on.
 */
export function proveItCanSee() {
  const dir = mkdtempSync(join(tmpdir(), 'untracked-gate-'));
  try {
    git(['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, 'tracked.txt'), 'tracked\n');
    writeFileSync(join(dir, 'skills-lock.json'), JSON.stringify({ version: 1, skills: { alpha: { source: 'x/y' } } }));
    git(['add', '--', 'tracked.txt', 'skills-lock.json'], { cwd: dir });
    git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', 'base'], { cwd: dir });

    // A plain new source file: the false positive this must never have.
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'new.ts'), 'export const x = 1;\n');
    // A vendored copy.
    mkdirSync(join(dir, 'vendor-copy'), { recursive: true });
    writeFileSync(join(dir, 'vendor-copy', 'package.json'), '{ "name": "somebody-elses" }\n');
    writeFileSync(join(dir, 'vendor-copy', 'package-lock.json'), '{}\n');
    // An install declared by a tracked manifest.
    mkdirSync(join(dir, '.agents', 'skills', 'alpha'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'skills', 'alpha', 'SKILL.md'), '# alpha\n');
    // Render output.
    writeFileSync(join(dir, 'clip.mp4'), Buffer.alloc(MEDIA_FLOOR + 4096));

    const { hits, unaccounted } = audit(dir);
    const kinds = new Set(hits.map((hit) => hit.kind));
    for (const kind of ['project', 'installed', 'media']) {
      if (!kinds.has(kind)) throw new Error(`the fixture planted a ${kind} artifact and the audit did not report it`);
    }
    // Paths are matched by prefix, not equality: in a tree this young git
    // reports each planted directory as its topmost untracked entry.
    const source = (list) => list.some((entry) => (entry.path ?? entry) === 'src' || (entry.path ?? entry).startsWith('src/'));
    if (!source(unaccounted)) {
      throw new Error('the fixture planted a plain new source file and the audit did not leave it unaccounted');
    }
    if (source(hits)) {
      throw new Error('a plain new source file was reported as generated or vendored');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The note the block carries into `.gitignore`. A line like `/.agents/skills/*`
 * is only readable where it sits if the reason it is globbed travels with it, and
 * a rule nobody can read is a rule somebody deletes. Its first line is also the
 * marker that stops a second fix writing the note twice.
 */
const FIX_NOTE = [
  '# untracked artifacts that are installed, rendered or checked out rather than',
  '# written here. Anchored, so a nested workspace of the same name stays trackable',
  '# elsewhere; a family with a tracked survivor inside it is globbed (`dir/*`) with',
  '# a negation for that survivor, because a negation inside an ignored directory is',
  '# never reached. Written by `scripts/untracked-gate.mjs --fix`, and read back by',
  '# `scripts/gitignore-gate.mjs`, which fails if a line here covers a tracked path.',
];

/**
 * Writes the lines by way of `preview`, which shows the diff first, and then reads
 * the result back against both gates. Returns the exit code; `log` exists so the
 * fixture below can run the whole thing — the write, the read-back and all —
 * without printing over the run it is part of, and `dryRun` stops it after the
 * diff, which is the one case where a caller is asking to see the change without
 * agreeing to it.
 */
function applyFix(root, groups, { log = console.log, dryRun = false } = {}) {
  const ignore = join(root, '.gitignore');
  const before = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  const known = new Set(before.split('\n').map((line) => line.trim()));
  const wanted = [...new Set(groups.flatMap((group) => group.lines))];
  const missing = wanted.filter((line) => !known.has(line));

  if (missing.length === 0) {
    log('\nNothing was written: every line above is already in .gitignore and the paths are still');
    log('uncovered, so something later in the file is undoing them — a `!` negation, usually.');
    log('Appending a second copy would be undone the same way; read the file instead.');
    return 1;
  }

  const block = [...(known.has(FIX_NOTE[0]) ? [] : FIX_NOTE), ...missing];
  const after = appended(before, block);

  // Shown first, then written: `preview` hands back false when the diff was all
  // that was asked for, and the read-back below means something only about a file
  // that was written.
  if (!preview([{ name: basename(ignore), path: ignore, contents: after }], { log, dryRun })) return 1;

  // Read back, because this is the one place here that edits a tracked file and
  // the two gates argue about this exact file: the audit has to be clean, and the
  // gate that fails on a rule covering a tracked path has to still pass.
  const left = audit(root);
  if (left.hits.length > 0) {
    log(`\n✗ ${left.hits.length} ${left.hits.length === 1 ? 'path is' : 'paths are'} still uncovered after the write: ${left.hits.map((hit) => hit.path).join(', ')}`);
    log('  The lines are in the file now — read .gitignore before trusting this gate again.');
    return 1;
  }
  const { tracked, hits } = scan(root);
  if (hits.length > 0) {
    log(`\n✗ the write covered ${hits.length} tracked ${hits.length === 1 ? 'path' : 'paths'}, which scripts/gitignore-gate.mjs fails on:`);
    for (const hit of hits) log(`    ${hit.path}  (covered by ${hit.source}:${hit.line}  "${hit.pattern}")`);
    log('  That is a bug in the rules this gate writes, not in the file. `git diff .gitignore` shows what it did.');
    return 1;
  }
  log(`✓ wrote ${missing.length} rule${missing.length === 1 ? '' : 's'} and read .gitignore back`);
  log(`✓ the audit is clean, and ${tracked} tracked files are still covered by no committed rule`);
  return 0;
}

/**
 * The gate's other fixture, for the half that writes.
 *
 * What `--fix` must not do is the interesting part, and it is exactly what the two
 * gates disagree about: cover the artifact, and cover nothing tracked. So this
 * fixture plants an installed family with a tracked survivor inside it — the shape
 * that makes `dir/` wrong and `dir/*` plus a negation right — then asks both gates
 * about the result. Then it plants the repair that is not one: the same family
 * defeated by a trailing negation, where every line is present, the paths are
 * uncovered again, and a second copy of the same line would be undone identically.
 *
 * A dry run is the other half of not writing something wrong, so it is proved
 * here too: it has to print the diff, leave the file byte-identical, and still
 * report the paths as uncovered rather than as repaired.
 */
function proveItCanFix() {
  const dir = mkdtempSync(join(tmpdir(), 'untracked-gate-fix-'));
  try {
    git(['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '# fixture\n');
    mkdirSync(join(dir, '.agents', 'skills', 'keep'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'skills', 'keep', 'SKILL.md'), '# keep\n');
    writeFileSync(join(dir, 'skills-lock.json'), JSON.stringify({ version: 1, skills: { alpha: { source: 'x/y' } } }));
    git(['add', '--', '.gitignore', '.agents/skills/keep/SKILL.md', 'skills-lock.json'], { cwd: dir });
    git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', 'base'], { cwd: dir });

    mkdirSync(join(dir, '.agents', 'skills', 'alpha'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'skills', 'alpha', 'SKILL.md'), '# alpha\n');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'new.ts'), 'export const x = 1;\n');

    const before = audit(dir);
    if (before.hits.length === 0) throw new Error('the fix fixture planted an installed copy and the audit did not report it');

    // Asked for the diff: the file has to come out of it exactly as it went in.
    const said = [];
    const original = readFileSync(join(dir, '.gitignore'), 'utf8');
    if (applyFix(dir, before.groups, { log: (line) => said.push(line), dryRun: true }) !== 1) {
      throw new Error('the dry run reported a repair it did not make');
    }
    if (readFileSync(join(dir, '.gitignore'), 'utf8') !== original) {
      throw new Error('the dry run wrote to .gitignore');
    }
    if (!said.some((line) => line.includes('+++ .gitignore (after --fix)'))) {
      throw new Error(`the dry run did not show the change it would have made:\n${said.join('\n')}`);
    }
    if (audit(dir).hits.length !== before.hits.length) {
      throw new Error('the dry run changed what the audit sees');
    }

    const quiet = { log: () => {} };
    if (applyFix(dir, before.groups, quiet) !== 0) throw new Error('the fix failed on a fixture it should have fixed');

    const after = audit(dir);
    if (after.hits.length > 0) {
      throw new Error(`the fix left ${after.hits.length} uncovered artifact(s): ${after.hits.map((hit) => hit.path).join(', ')}`);
    }
    const covered = scan(dir);
    if (covered.hits.length > 0) {
      throw new Error(
        `the fix covered a tracked path: ${covered.hits.map((hit) => `${hit.path} (${hit.source}:${hit.line} "${hit.pattern}")`).join(', ')}`,
      );
    }
    // The decision it must not make, and the note it must not write twice.
    if (!after.unaccounted.includes('src')) throw new Error('the fix decided about a plain new source file');
    const written = readFileSync(join(dir, '.gitignore'), 'utf8');
    const notes = written.split('\n').filter((line) => line.trim() === FIX_NOTE[0]).length;
    if (notes !== 1) throw new Error(`the fix wrote its note ${notes} times`);

    // Now the case it has to refuse: the lines are present and something later in
    // the file is undoing them, which is what a hand-added negation looks like.
    const defeated = `${written}!/.agents/skills/*\n`;
    writeFileSync(join(dir, '.gitignore'), defeated);
    const undone = audit(dir);
    if (undone.hits.length === 0) throw new Error('a negation after the rules did not defeat them — this fixture proves nothing');
    if (applyFix(dir, undone.groups, quiet) === 0) throw new Error('the fix reported success with every line already present');
    if (readFileSync(join(dir, '.gitignore'), 'utf8') !== defeated) {
      throw new Error('the fix appended a duplicate instead of refusing');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function gate({ fix = false, dryRun = false } = {}) {
  const root = git(['rev-parse', '--show-toplevel'], { cwd: process.cwd() }).trim();
  proveItCanSee();
  proveItCanFix();
  proveItCanPreview();

  const { hits, groups, unaccounted } = audit(root);

  if (hits.length > 0) {
    console.log(`✗ ${hits.length} untracked ${hits.length === 1 ? 'path is' : 'paths are'} generated or vendored, and no rule covers ${hits.length === 1 ? 'it' : 'them'}:\n`);
    for (const group of groups) {
      console.log(`  ${group.rule.padEnd(26)}${String(group.paths.length).padStart(3)}  ${group.detail}`);
      if (group.paths.length > 1) {
        const sample = group.paths.slice(0, 3).join('  ');
        const more = group.paths.length > 3 ? `  (+${group.paths.length - 3} more)` : '';
        console.log(`    ${sample}${more}`);
      }
    }
    // Without `--fix` the lines are printed to be pasted. With it they are in the
    // diff below, so printing them twice would be noise.
    if (!fix) {
      console.log('\nThese lines cover them, without making the gitignore gate fail on the rule itself:\n');
      for (const group of groups) for (const line of group.lines) console.log(`    ${line}`);
      console.log(
        '\nAn artifact that is generated or installed does not belong in git; the lockfile or the\n' +
          'source it was made from does. Anchored, the way this repo writes its rules, so a nested\n' +
          'workspace of the same name stays trackable elsewhere.',
      );
    }
  }

  if (unaccounted.length > 0) {
    console.log(`\n▸ ${unaccounted.length} untracked ${unaccounted.length === 1 ? 'path is' : 'paths are'} neither ignored nor tracked — nobody has decided about ${unaccounted.length === 1 ? 'it' : 'them'} yet:`);
    for (const path of unaccounted.slice(0, 20)) console.log(`    ${path}`);
    if (unaccounted.length > 20) console.log(`    … and ${unaccounted.length - 20} more`);
    console.log('  Not a failure. `git status` will keep showing them, and `git add -A` would sweep them in.');
  }

  if (hits.length === 0) {
    if (unaccounted.length === 0) console.log('✓ nothing untracked is waiting for a decision');
    console.log('Untracked gate passed.');
    return 0;
  }

  if (fix) return applyFix(root, groups, { dryRun });

  console.log('\nUntracked gate failed.');
  return 1;
}

// Only when run as the script: importing this module to exercise `audit` should
// not run a gate over whatever repository the caller happens to be in.
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const known = new Set(['--fix', '--dry-run']);
  const unknown = args.filter((arg) => !known.has(arg));
  try {
    if (unknown.length > 0) {
      throw new Error(
        `unrecognised argument${unknown.length === 1 ? '' : 's'}: ${unknown.join(' ')} (usage: untracked-gate.mjs [--fix [--dry-run]])`,
      );
    }
    const fix = args.includes('--fix');
    const dryRun = args.includes('--dry-run');
    if (dryRun && !fix) {
      throw new Error(
        '--dry-run goes with --fix: a plain run already prints the report without writing (usage: untracked-gate.mjs --fix --dry-run)',
      );
    }
    process.exit(gate({ fix, dryRun }));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    console.error('\nUntracked gate could not run — that is a failure, not a pass.');
    process.exit(2);
  }
}

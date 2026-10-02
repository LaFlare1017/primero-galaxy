#!/usr/bin/env node
/**
 * Gate: no tracked file may be covered by a .gitignore rule.
 *
 * A tracked path that an ignore rule also matches is invisible in both places
 * you would look for it. `git status` stays quiet, because the file is
 * committed; and the rule reads as though the path were never meant to be here.
 * Whichever half is wrong, nothing ever says so — the file keeps shipping while
 * the rule keeps claiming it should not.
 *
 * This asks git the same question the staging code asks (`check-ignore`), with
 * `--no-index` so tracked paths are reported rather than skipped, and keeps only
 * the answers that come from a `.gitignore` committed to this repository: a
 * global excludes file and `.git/info/exclude` belong to whoever set them up,
 * and a check that fails on somebody's personal setup is a check that gets
 * turned off.
 *
 * Two things fail loudly instead of passing quietly, because a scan that found
 * nothing looks exactly like a scan that never ran: an empty tracked-file list,
 * and a fixture that plants a tracked, ignored file and must catch it.
 *
 * `--fix` narrows the rule: a `!` negation for the tracked path, appended to the
 * file that holds the rule, and — where the rule excludes a whole directory — the
 * rule globbed to `dir/*` first, because git never looks inside an excluded
 * directory, so `/dir/` plus `!/dir/keep` re-includes nothing at all.
 *
 * Which shape a rule needs is not reasoned about, it is TRIED. Every candidate is
 * applied to a scratch repository holding the committed rules and the tracked
 * path, and only a candidate the gate then reports clean is written. The scratch
 * copy runs the rules as they are first, and refuses the whole thing if that does
 * not reproduce the complaint — a fixture that already passed would accept a fix
 * that does nothing. Then, in the order the reader needs: the diff, the write, and
 * a read-back of BOTH gates, because the two argue about this one file. Anything
 * the read-back rejects is undone, so `--fix` ends with the file repaired and
 * proven or with the file untouched — a half-repair, some rules narrowed and the
 * gate still failing, is worse than no repair at all. `--fix --dry-run` is that
 * same plan and that same diff, shown and then not written, and the fixture below
 * holds the two runs against each other: a preview that described a repair other
 * than the one performed is the one thing a dry run must not be. Both halves are
 * themselves proved on every run, as is the shared `preview` that write goes
 * through — that fixture belongs to `scripts/ignore-file.mjs`, which is where a
 * fault in it would reach both gates from — and the other gate is read back only
 * when its script is in this checkout: a checkout without it is told so, rather
 * than told a gate passed.
 *
 * Usage:
 *   node scripts/gitignore-gate.mjs [--fix [--dry-run]]
 *
 * `--fix --dry-run` stops after the diff: nothing is written, so there is nothing
 * to read back, and the run says that rather than reporting a repair it did not
 * make. It still exits non-zero, because the paths it found are still covered and
 * a dry run that exited clean would be indistinguishable from a repair to
 * anything scripting it. `--dry-run` on its own is refused rather than silently
 * promoted, since a plain run already prints the report without writing.
 *
 * Exit codes: 0 clean, or every covered path was rescued and read back · 1 a
 * tracked path is covered by a rule, or no shape this gate knows rescues it, or
 * `--dry-run` showed the diff and wrote nothing · 2 the scan itself could not
 * run.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appended, preview, proveItCanPreview, showDiff } from './ignore-file.mjs';
import { isMain } from './is-main.mjs';

/**
 * Runs git and returns stdout. `allowOne` accepts exit status 1, which is what
 * `check-ignore` uses to mean "nothing matched" — a pass, not an error.
 */
function git(args, { cwd = process.cwd(), input, allowOne = false } = {}) {
  const result = spawnSync('git', args, { cwd, input, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`could not run \`git ${args.join(' ')}\`: ${result.error.message}`);
  if (result.status !== 0 && !(allowOne && result.status === 1)) {
    const detail = (result.stderr ?? '').toString().trim();
    throw new Error(`\`git ${args.join(' ')}\` exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8');
}

/**
 * The tracked paths a committed `.gitignore` covers, as
 * `{ path, source, line, pattern }`. Takes a repo root so the fixture below can
 * run the very scan it is checking.
 */
export function scan(root) {
  const tracked = git(['ls-files', '-z'], { cwd: root }).split('\0').filter(Boolean);
  if (tracked.length === 0) {
    throw new Error(`${root}: git ls-files listed no files — this scan would pass by having nothing to read`);
  }

  const committed = new Set(
    tracked.filter((path) => path === '.gitignore' || path.endsWith('/.gitignore')),
  );
  if (committed.size === 0) {
    throw new Error(`${root}: no .gitignore is tracked here — this scan has no rule to check against`);
  }

  // `-z` prints four NUL-separated fields per match — source, line, pattern,
  // pathname — and exits 1 with no output when nothing matches, which is the
  // pass this gate has to tell apart from a broken run.
  const raw = git(['check-ignore', '-v', '-z', '--no-index', '--stdin'], {
    cwd: root,
    input: `${tracked.join('\0')}\0`,
    allowOne: true,
  });
  const fields = raw.split('\0');
  if (fields[fields.length - 1] === '') fields.pop();
  if (fields.length % 4 !== 0) {
    throw new Error(`check-ignore printed ${fields.length} fields, which is not a whole number of four-field matches`);
  }

  const hits = [];
  for (let i = 0; i < fields.length; i += 4) {
    const [source, line, pattern, path] = [fields[i].replace(/^\.\//, ''), fields[i + 1], fields[i + 2], fields[i + 3]];
    // Rules that ship with the repo, only.
    if (!committed.has(source)) continue;
    // `-v` reports the LAST matching pattern, so a `!` here is git saying the
    // path is in spite of the rule above it — the one shape that looks like a
    // violation and is the opposite of one.
    if (pattern.startsWith('!')) continue;
    hits.push({ path, source, line, pattern });
  }
  return { tracked: tracked.length, hits };
}

/**
 * The gate's own fixture: a scratch repository whose one committed file is
 * covered by a rule committed after it — the order in which this actually
 * happens, and the only order git will let you stage, since `git add` refuses a
 * path its own `.gitignore` already covers. A checker that cannot catch the
 * result is not checking anything — the same reason the keyboard harness keeps
 * a list of manifests that must be rejected.
 */
export function proveItCanFail() {
  const dir = mkdtempSync(join(tmpdir(), 'gitignore-gate-'));
  try {
    git(['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, 'planted.txt'), 'planted\n');
    git(['add', '--', 'planted.txt'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), 'planted.txt\n');
    git(['add', '--', '.gitignore'], { cwd: dir });
    const { hits } = scan(dir);
    if (!hits.some((hit) => hit.path === 'planted.txt')) {
      throw new Error('the fixture planted a tracked, ignored file and the scan did not report it');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The note the negations carry, so the reader knows who wrote them and why. */
const FIX_NOTE = [
  '# re-inclusions for tracked paths a rule above was covering, written by',
  '# `scripts/gitignore-gate.mjs --fix`. A negation is the repair that leaves the rule',
  '# doing its job, and a rule excluding a whole directory is globbed to `dir/*` first,',
  '# since git never looks inside an excluded directory: `/dir/` plus `!/dir/keep`',
  '# re-includes nothing at all. `scripts/untracked-gate.mjs` is read back after this',
  '# write, because narrowing a rule here must not expose an artifact it was ignoring.',
];

/**
 * Every `.gitignore` this repo commits, with the bytes the working tree has.
 *
 * `path` is absolute, for reading and writing; `name` is the repo-relative one,
 * which is the only form `scan` ever reports (`check-ignore` prints a source
 * relative to the directory it ran in) and the form this module reasons in —
 * keying a candidate by one and looking it up by the other is how a plan ends up
 * with no files in it and a fix that quietly writes nothing.
 */
function ignoreFiles(root) {
  return git(['ls-files', '-z'], { cwd: root })
    .split('\0')
    .filter((path) => path === '.gitignore' || path.endsWith('/.gitignore'))
    .map((name) => ({ name, path: join(root, name), contents: readFileSync(join(root, name), 'utf8') }));
}

/**
 * Puts a candidate into a scratch repository and asks the gate which paths it
 * still covers. This is the whole mechanism, not a nicety: git's re-inclusion
 * rules have edges nobody predicts — a negation under an excluded directory is
 * not reached, and which of two shapes reaches is a question only git answers.
 */
function stillCovered(files, paths) {
  const dir = mkdtempSync(join(tmpdir(), 'gitignore-gate-try-'));
  try {
    git(['init', '-q'], { cwd: dir });
    for (const file of files) {
      const at = join(dir, file.name);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, file.contents);
    }
    for (const path of paths) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), 'tracked\n');
    }
    // `-f`: these are exactly the paths the rules cover, and git would otherwise
    // refuse to stage them — which is also the order the real thing happens in.
    git(['add', '-f', '--', ...files.map((file) => file.name), ...paths], { cwd: dir });
    return new Set(scan(dir).hits.map((hit) => hit.path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The negation, anchored from the file that holds the rule, the way this repo writes. */
function rescued(source, path, directory = false) {
  return `/${relative(dirname(source), path)}${directory ? '/' : ''}`;
}

/**
 * Whether this shape globs the rule itself, rather than only appending a
 * negation. Only a rule that ends in a slash excludes the directory itself, and
 * that is the exclusion a negation cannot reach past — so a rule naming a file,
 * or a pattern without the slash, is left exactly as the reader wrote it.
 */
function narrows(pattern, shape) {
  return shape !== 'append' && pattern.endsWith('/');
}

/**
 * The ignore files as they would be with every covered path rescued its way.
 * `proved` is what earlier attempts have already been shown to clear; the rest
 * take `fallback`, and the caller only keeps a plan the gate then reports clean.
 */
function planned(files, hits, proved, fallback) {
  const byFile = new Map();
  for (const hit of hits) byFile.set(hit.source, [...(byFile.get(hit.source) ?? []), hit]);

  return files.map((file) => {
    const forFile = byFile.get(file.name);
    if (forFile === undefined) return file;

    const lines = file.contents.split('\n');
    const block = [];
    for (const hit of forFile) {
      const shape = proved.get(hit.path) ?? fallback;
      if (narrows(hit.pattern, shape)) {
        const current = lines[hit.line - 1];
        if (current === undefined || current.trim() !== hit.pattern) {
          throw new Error(
            `${file.name}:${hit.line} does not read "${hit.pattern}" — refusing to rewrite a line this gate did not read`,
          );
        }
        // `dir/` excludes the directory itself, which is what puts everything
        // under it out of reach; `dir/*` excludes the contents and leaves the
        // directory visitable, which is the only form a negation can reach into.
        lines[hit.line - 1] = `${hit.pattern.replace(/\/$/, '')}/*`;
      }
      // The nearest directory, for a path that sits deeper than the rule does:
      // re-including one file there would not be reached either.
      block.push(`!${shape === 'parent' ? rescued(file.name, dirname(hit.path), true) : rescued(file.name, hit.path)}`);
    }

    const note = file.contents.includes(FIX_NOTE[0]) ? [] : FIX_NOTE;
    return { name: file.name, path: file.path, contents: appended(lines.join('\n'), [...note, ...block]) };
  });
}

/** The other gate, run the way a person runs it: its exit code is the answer. */
function otherGate(root) {
  const script = join(root, 'scripts', 'untracked-gate.mjs');
  if (!existsSync(script)) return { status: null, detail: 'scripts/untracked-gate.mjs is not in this checkout' };
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  if (result.error) return { status: null, detail: `could not run it: ${result.error.message}` };
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  // A gate that exits 0 in silence is a gate that did not run — the shape this
  // guard exists to catch, and the reason it is not read as a pass.
  if (result.status === 0 && output === '') {
    return { status: null, detail: 'it exited 0 without printing anything, which is what never having run looks like' };
  }
  const first = output.split('\n').find((line) => line.trim() !== '');
  return { status: result.status, detail: first?.trim() ?? `exit ${result.status}` };
}

/**
 * Rescues every covered path, or writes nothing and says why. Returns the exit
 * code: 0 only when both gates have been read back clean, and never 0 for a dry
 * run, whose whole premise is that nothing was repaired. `log`/`warn` exist so
 * the fixture below can run the whole thing — the plan, the preview, the read-back
 * and the undo — without printing over the run it is part of, and
 * `dryRun` stops it after the diff, which is the one case where a caller is
 * asking to see the change without agreeing to it.
 */
function fix(root, hits, { log = console.log, warn = console.error, dryRun = false } = {}) {
  const files = ignoreFiles(root);
  const original = new Map(files.map((file) => [file.path, file.contents]));
  const paths = hits.map((hit) => hit.path);

  // The control comes first. A scratch repository that already reported nothing
  // would accept every candidate — including the one that writes nothing.
  const reproduced = stillCovered(files, paths);
  const missed = paths.filter((path) => !reproduced.has(path));
  if (missed.length > 0) {
    warn(`✗ the scratch repository did not reproduce the complaint for ${missed.join(', ')}, so nothing it says about a candidate could be trusted`);
    return 2;
  }

  const proved = new Map();
  let plan = null;
  for (const attempt of ['append', 'glob', 'parent']) {
    plan = planned(files, hits, proved, attempt);
    const left = stillCovered(plan, paths);
    // First shape that worked, and only that one: recording a later attempt over
    // an earlier answer would leave this map describing something the accepted
    // plan does not do, and the report is read as a description of the write.
    for (const hit of hits) if (!left.has(hit.path) && !proved.has(hit.path)) proved.set(hit.path, attempt);
    if (paths.every((path) => !left.has(path))) break;
    plan = null;
  }
  if (plan === null) {
    warn(`✗ no shape this gate knows rescues ${paths.join(', ')}`);
    warn(
      `  (under ${hits.map((hit) => `${hit.source}:${hit.line} "${hit.pattern}"`).join(', ')})\n\n` +
        'Narrowing the rule itself is the fix here — `git check-ignore -v <path>` names the one that is winning.',
    );
    return 1;
  }

  const changed = plan.filter((file) => file.contents !== original.get(file.path));
  log('');
  for (const hit of hits) {
    const shape = proved.get(hit.path);
    const rewrite = narrows(hit.pattern, shape) ? `narrow "${hit.pattern}" to "${hit.pattern.replace(/\/$/, '')}/*", then ` : '';
    const negation = shape === 'parent' ? rescued(hit.source, dirname(hit.path), true) : rescued(hit.source, hit.path);
    log(`  ${hit.path}  was covered by  ${hit.source}:${hit.line}  "${hit.pattern}"`);
    log(`    → ${rewrite}append  !${negation}`);
  }
  // Shown first, then written: `preview` hands back false when the diff was all
  // that was asked for, and the read-back below means something only about a file
  // that was written.
  if (!preview(changed, { log, dryRun })) return 1;

  // Read both gates back. Narrowing a rule changes what git ignores, which is the
  // one thing the other gate exists to have an opinion about.
  const left = scan(root);
  const other = otherGate(root);
  // A missing or unstartable sibling gate is not a failure of the write — there
  // is simply nothing there to read back — so it is reported, not refused.
  const refused = left.hits.length > 0
    ? `the write left ${left.hits.length} tracked ${left.hits.length === 1 ? 'path' : 'paths'} covered: ${left.hits.map((hit) => `${hit.path} (${hit.source}:${hit.line} "${hit.pattern}")`).join(', ')}`
    : other.status === 0 || other.status === null
      ? null
      : `scripts/untracked-gate.mjs no longer passes: ${other.detail}`;

  if (refused !== null) {
    for (const file of changed) writeFileSync(file.path, original.get(file.path));
    for (const file of changed) {
      if (readFileSync(file.path, 'utf8') !== original.get(file.path)) {
        throw new Error(`${relative(root, file.path)} was not restored to the bytes it started with — check it before committing`);
      }
    }
    warn(`✗ ${refused}`);
    warn(`\nNothing was kept: ${changed.map((file) => relative(root, file.path)).join(', ')} is back to the bytes it started with.`);
    return 1;
  }

  log(`\n✓ wrote ${changed.map((file) => relative(root, file.path)).join(', ')}`);
  log(`✓ ${left.tracked} tracked files, none covered by a committed rule`);
  if (other.status === null) log(`▸ scripts/untracked-gate.mjs was not read back: ${other.detail}`);
  else log('✓ scripts/untracked-gate.mjs still passes');
  return 0;
}

/**
 * The gate's other fixture, for the half that writes.
 *
 * Both shapes a real repair takes are planted here, because the one this repo
 * actually needed is the one that is easy to get wrong: a file rule rescued by a
 * bare negation, and a rule excluding a whole directory, which a negation alone
 * cannot rescue — git never looks inside an excluded directory, so `dir/` has to
 * be globbed to `dir/*` first, and only then does `!/dir/keep.md` reach.
 *
 * Then the repair that must be refused: a tracked path deep enough that the
 * negation git needs is its parent directory, in a parent that also holds an
 * artifact the untracked gate has an opinion about. That write has to be undone
 * byte for byte, because a `--fix` that leaves a half-repair behind is worse
 * than one that does nothing.
 *
 * And the half that only shows. `--fix --dry-run` has to print the same plan and
 * the same diff, leave the file byte for byte as it was, and be held against the
 * write that follows it: report for report, and then the diff of the bytes that
 * were written has to be the one it printed.
 */
export function proveItCanFix() {
  const quiet = { log: () => {}, warn: () => {} };
  const commit = (cwd, message) =>
    git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-q', '-m', message], { cwd });
  const plant = (dir) => {
    git(['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '# fixture\n');
    // The other gate reads this one's writes back, so the fixture has to have it
    // — and every script rather than the ones this fixture happens to know it
    // imports, because the gate it spawns imports its own way in and a hand-kept
    // list of those imports is a list that goes stale without saying so.
    const here = dirname(fileURLToPath(import.meta.url));
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    for (const entry of readdirSync(here, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.mjs')) {
        copyFileSync(join(here, entry.name), join(dir, 'scripts', entry.name));
      }
    }
  };

  const dir = mkdtempSync(join(tmpdir(), 'gitignore-gate-fix-'));
  try {
    plant(dir);
    writeFileSync(join(dir, 'notes.txt'), 'notes\n');
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(join(dir, 'logs', 'keep.md'), 'keep\n');
    // Tracked while it was still trackable: `git add` refuses a path its own
    // .gitignore already covers, which is also the order this really happens in.
    git(['add', '--', '.gitignore', 'notes.txt', 'logs/keep.md'], { cwd: dir });
    commit(dir, 'base');
    writeFileSync(join(dir, '.gitignore'), '# fixture\nnotes.txt\n/logs/\n');
    git(['add', '--', '.gitignore'], { cwd: dir });
    commit(dir, 'rules');

    const { hits } = scan(dir);
    if (hits.length !== 2) {
      throw new Error(`the fix fixture planted two covered paths and the scan reported ${hits.length}`);
    }

    // Asked for the diff: the plan, the diff, and the file exactly as it was. The
    // dry run is also read as a run of its own, so it has to come back non-zero —
    // the two paths above are still covered whatever was or was not written.
    const before = readFileSync(join(dir, '.gitignore'), 'utf8');
    const preview = [];
    const asked = fix(dir, hits, { log: (line) => preview.push(line), warn: (line) => preview.push(line), dryRun: true });
    if (asked !== 1) throw new Error('the dry run reported a repair it did not make');
    if (readFileSync(join(dir, '.gitignore'), 'utf8') !== before) {
      throw new Error('the dry run wrote to .gitignore');
    }
    const untouched = scan(dir);
    if (untouched.hits.length !== hits.length) throw new Error('the dry run changed what the scan sees');
    const stopped = preview.findIndex((line) => line.includes('--dry-run asked for the diff'));
    if (stopped === -1) throw new Error(`the dry run did not say it had written nothing:\n${preview.join('\n')}`);
    const shown = preview.slice(0, stopped);
    // A preview is a diff and nothing else. The lines git uses to name the two
    // blobs are dropped by `showDiff`, and a pattern that stopped matching would
    // put them back in the middle of the text this fixture is about to compare.
    const named = shown.join('\n').split('\n').filter((line) => line.startsWith('diff --git ') || line.startsWith('index '));
    if (named.length > 0) {
      throw new Error(`the preview showed the lines git names blobs with: ${named.join(' | ')}`);
    }

    // Then the write, with its whole report captured: the report is read as a
    // description of the write, so the fixture reads it against the preview.
    const said = [];
    if (fix(dir, hits, { log: (line) => said.push(line), warn: (line) => said.push(line) }) !== 0) {
      throw new Error('the fix fixture held two covered paths and --fix did not rescue them');
    }
    const written = readFileSync(join(dir, '.gitignore'), 'utf8');
    if (said.slice(0, shown.length).join('\n') !== shown.join('\n')) {
      throw new Error(
        `the preview and the write disagree:\n--- previewed\n${shown.join('\n')}\n--- written\n${said.slice(0, shown.length).join('\n')}`,
      );
    }
    // And it was a diff of the bytes that were written, which the report above
    // cannot show on its own: a diff of some other change prints just as well. So
    // the same diff is run against the file as it was and the file as it now is,
    // and it has to be the text the dry run printed.
    const kept = join(dir, '.gitignore.before');
    writeFileSync(kept, before);
    const performed = showDiff(kept, written, '.gitignore');
    if (shown[shown.length - 1] !== performed) {
      throw new Error(
        `the diff the dry run showed is not the diff of the write that happened:\n--- previewed\n${shown[shown.length - 1]}\n--- performed\n${performed}`,
      );
    }

    const after = scan(dir);
    if (after.hits.length > 0) {
      throw new Error(`the fix left ${after.hits.map((hit) => hit.path).join(', ')} covered`);
    }
    if (!written.includes('!/notes.txt')) throw new Error('a plain file rule was not rescued by a negation');
    if (written.includes('notes.txt/*')) throw new Error('a rule naming a file was globbed');
    if (!written.includes('/logs/*')) throw new Error('a rule excluding a directory was not globbed before its negation');
    if (!said.some((line) => line.includes('narrow "/logs/" to "/logs/*"'))) {
      throw new Error(`the report did not name the narrowing it wrote:\n${said.join('\n')}`);
    }
    if (said.some((line) => line.includes('narrow "notes.txt"'))) {
      throw new Error(`the report named a narrowing it did not write:\n${said.join('\n')}`);
    }
    const notes = written.split('\n').filter((line) => line.trim() === FIX_NOTE[0]).length;
    if (notes !== 1) throw new Error(`the fix wrote its note ${notes} times`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const undo = mkdtempSync(join(tmpdir(), 'gitignore-gate-undo-'));
  try {
    plant(undo);
    mkdirSync(join(undo, 'logs', 'keep'), { recursive: true });
    writeFileSync(join(undo, 'logs', 'keep', 'file.md'), 'keep\n');
    git(['add', '--', '.gitignore', 'logs/keep/file.md'], { cwd: undo });
    commit(undo, 'base');
    writeFileSync(join(undo, '.gitignore'), '# fixture\n/logs/\n');
    git(['add', '--', '.gitignore'], { cwd: undo });
    commit(undo, 'rules');
    // The artifact the other gate has an opinion about, sitting in the very
    // directory the only workable negation has to re-include.
    mkdirSync(join(undo, 'logs', 'keep', 'dist'), { recursive: true });
    writeFileSync(join(undo, 'logs', 'keep', 'dist', 'bundle.js'), 'built\n');

    const before = readFileSync(join(undo, '.gitignore'), 'utf8');
    const { hits } = scan(undo);
    if (hits.length !== 1 || hits[0].pattern !== '/logs/') {
      throw new Error(`the undo fixture planted one covered path under /logs/ and the scan reported ${JSON.stringify(hits)}`);
    }
    if (fix(undo, hits, quiet) !== 1) throw new Error('the fix kept a repair that exposes an untracked artifact');
    if (readFileSync(join(undo, '.gitignore'), 'utf8') !== before) {
      throw new Error('the refused repair was not rolled back to the bytes it started with');
    }
  } finally {
    rmSync(undo, { recursive: true, force: true });
  }
}

function gate({ repair = false, dryRun = false } = {}) {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  proveItCanFail();
  proveItCanFix();
  proveItCanPreview();

  const { tracked, hits } = scan(root);
  if (hits.length === 0) {
    console.log(`✓ ${tracked} tracked files, none covered by a committed .gitignore rule`);
    console.log('Gitignore gate passed.');
    return 0;
  }

  for (const hit of hits) {
    console.error(`✗ ${hit.path}  (covered by ${hit.source}:${hit.line}  "${hit.pattern}")`);
  }
  if (repair) return fix(root, hits, { dryRun });

  console.error(
    `\nGitignore gate failed: ${hits.length} tracked ${hits.length === 1 ? 'path is' : 'paths are'} covered by a committed .gitignore rule.\n` +
      'Either stop tracking the path, or narrow the rule — a `!` negation for the path that belongs in the repo.\n' +
      '`node scripts/gitignore-gate.mjs --fix` writes one, showing the diff first and reading both gates back.\n' +
      '`node scripts/gitignore-gate.mjs --fix --dry-run` shows the same plan and diff and writes nothing.',
  );
  return 1;
}

// Only when run as the script: importing this module to exercise `scan` should
// not run a gate over whatever repository the caller happens to be in.
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const known = new Set(['--fix', '--dry-run']);
  const unknown = args.filter((arg) => !known.has(arg));
  try {
    if (unknown.length > 0) {
      throw new Error(
        `unrecognised argument${unknown.length === 1 ? '' : 's'}: ${unknown.join(' ')} (usage: gitignore-gate.mjs [--fix [--dry-run]])`,
      );
    }
    const repair = args.includes('--fix');
    const dryRun = args.includes('--dry-run');
    if (dryRun && !repair) {
      throw new Error(
        '--dry-run goes with --fix: a plain run already prints the report without writing (usage: gitignore-gate.mjs --fix --dry-run)',
      );
    }
    process.exit(gate({ repair, dryRun }));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    console.error('\nGitignore gate could not run — that is a failure, not a pass.');
    process.exit(2);
  }
}

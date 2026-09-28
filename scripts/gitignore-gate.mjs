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
 * Usage:
 *   node scripts/gitignore-gate.mjs
 *
 * Exit codes: 0 clean · 1 a tracked path is covered by a rule · 2 the scan
 * itself could not run.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
function proveItCanFail() {
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

function gate() {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  proveItCanFail();

  const { tracked, hits } = scan(root);
  if (hits.length > 0) {
    for (const hit of hits) {
      console.error(`✗ ${hit.path}  (covered by ${hit.source}:${hit.line}  "${hit.pattern}")`);
    }
    console.error(
      `\nGitignore gate failed: ${hits.length} tracked ${hits.length === 1 ? 'path is' : 'paths are'} covered by a committed .gitignore rule.\n` +
        'Either stop tracking the path, or narrow the rule — a `!` negation for the path that belongs in the repo.',
    );
    process.exit(1);
  }

  console.log(`✓ ${tracked} tracked files, none covered by a committed .gitignore rule`);
  console.log('Gitignore gate passed.');
}

// Only when run as the script: importing this module to exercise `scan` should
// not run a gate over whatever repository the caller happens to be in.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    gate();
  } catch (error) {
    console.error(`✗ ${error.message}`);
    console.error('\nGitignore gate could not run — that is a failure, not a pass.');
    process.exit(2);
  }
}

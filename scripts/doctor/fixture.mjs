/**
 * Fixture checkouts for the doctor's own proof: a throwaway directory each
 * check is pointed at, built fresh per scenario and removed afterwards.
 *
 * Two things this has to get right, and both are traps:
 *
 *   - It is a real repository when a scenario asks for one. `gitignore`,
 *     `untracked` and `hooks` put real questions to git, and a directory that is
 *     not a repository would answer them by throwing — a fixture that cannot be
 *     wrong proves nothing about a check that is supposed to be able to be.
 *   - It runs git in a cleaned environment, and this is the only place in the
 *     doctor that does. A doctor started by a commit has GIT_DIR,
 *     GIT_INDEX_FILE and GIT_CONFIG_PARAMETERS exported into it by git, and
 *     every one of those names the repository the commit is in: inherited
 *     unchanged, `git add` here would write into the real index and
 *     `rev-parse --git-path hooks` would answer about the real checkout. The
 *     checks themselves are fine with them — they are pointed at the checkout
 *     those variables describe — but a fixture is somewhere else entirely.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Exported into a hook by git, and all of them point out of the fixture. */
const OUTER_REPO = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG_PARAMETERS',
];
const OUTER_CONFIG = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/;

function fixtureEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (OUTER_REPO.includes(key) || OUTER_CONFIG.test(key)) delete env[key];
  }
  return env;
}

/** git, in the fixture, with nothing of the outer checkout left in the way. */
function git(args, { cwd }) {
  const result = spawnSync('git', args, { cwd, env: fixtureEnv() });
  if (result.error) throw new Error(`could not run \`git ${args.join(' ')}\` in ${cwd}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').toString().trim();
    throw new Error(`\`git ${args.join(' ')}\` exited ${result.status} in ${cwd}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8').trim();
}

/** A directory to point a check at. Nothing is in it, and it is not a repo. */
export function newRoot() {
  return mkdtempSync(join(tmpdir(), 'doctor-fixture-'));
}

/**
 * A directory that is a repository: a tracked `.gitignore` — the gitignore scan
 * refuses to run without one, since a scan with no rule to check against is a
 * scan that found nothing — and a tracked `.md`, because the hook check's plant
 * is a `*.md` rule and a plant with nothing to cover would pass for the wrong
 * reason. Both are committed, so HEAD has them too: the hook check asks about
 * the recorded mode in the index *and* in HEAD, and an unborn HEAD cannot be
 * wrong about anything.
 */
export function newRepo() {
  const root = newRoot();
  git(['init', '-q'], { cwd: root });
  write(root, '.gitignore', '# fixture\n');
  write(root, 'tracked.md', '# fixture\n');
  track(root, '.gitignore', 'tracked.md');
  commit(root, 'fixture');
  return root;
}

export function write(root, path, contents) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  return file;
}

/** A script a hook can run: written, and made executable before it is added. */
export function writeExecutable(root, path, contents) {
  const file = write(root, path, contents);
  chmodSync(file, 0o755);
  return file;
}

export function makeDir(root, path) {
  const dir = join(root, path);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A file's timestamps pulled back, for the one check that compares them: a
 * build that was current an hour before the source it was built from is the
 * state under test, and a fixture that relied on writes landing in a particular
 * millisecond would be a race, not a proof.
 */
export function age(path, milliseconds) {
  const when = new Date(Date.now() - milliseconds);
  utimesSync(path, when, when);
  return path;
}

export function configure(root, key, value) {
  git(['config', key, value], { cwd: root });
}

export function track(root, ...paths) {
  git(['add', '--', ...paths], { cwd: root });
}

export function commit(root, message = 'fixture') {
  git(
    ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-q', '-m', message],
    { cwd: root },
  );
}

export function discard(root) {
  rmSync(root, { recursive: true, force: true });
}

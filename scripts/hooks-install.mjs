#!/usr/bin/env node
/**
 * Install the commit-time half of the gitignore gate.
 *
 * `npm run hooks:install` points `core.hooksPath` at the tracked `.githooks/`
 * directory, which is what makes `.githooks/pre-commit` run on every commit
 * here without anyone copying it into place.
 *
 * The trap in that sentence is the word *instead*: `core.hooksPath` replaces
 * the hooks directory, it does not add to it. A clone that already had a
 * working `pre-commit` in `.git/hooks/` would lose it the moment this ran —
 * silently, and at the exact moment its owner believed they were making their
 * setup stricter. So this refuses to install while a hook git would actually
 * run sits in the directory it is about to shadow, names the files, and takes
 * `--force` for the case where shadowing is understood and intended.
 *
 * The config write itself goes through `claimConfig` (scripts/local-config.mjs),
 * so a `core.hooksPath` that already holds somebody else's value — possibly one
 * from the global config, where it governs every repository on the machine — is
 * reported rather than replaced.
 *
 * The refusal is narrow on purpose. A `*.sample` file is `git init`'s template
 * rather than anybody's hook, and a stray file whose name is not a hook at all
 * is nothing to warn about — a check that cries wolf gets turned off, which is
 * the failure this whole thing exists to avoid. The set of names below is what
 * `git hook run` accepts (git 2.50).
 *
 * Usage:
 *   node scripts/hooks-install.mjs [--force]
 *
 * Exit codes: 0 installed or already installed · 1 refused, a hook in the
 * current directory would stop running · 2 the install could not run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { claimConfig, proveItCanClaim } from './local-config.mjs';
import { isMain } from './is-main.mjs';

/** The tracked directory this installs, as written into the repo's config. */
export const HOOKS_PATH = '.githooks';

/** Every name `git hook run` will accept — anything else is not a hook. */
const HOOK_NAMES = new Set([
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'pre-receive',
  'update',
  'proc-receive',
  'post-receive',
  'post-update',
  'reference-transaction',
  'push-to-checkout',
  'pre-auto-gc',
  'post-rewrite',
  'sendemail-validate',
  'fsmonitor-watchman',
  'p4-changelist',
  'p4-prepare-changelist',
  'p4-post-changelist',
  'p4-pre-submit',
  'post-index-change',
]);

function git(args, { cwd = process.cwd() } = {}) {
  const result = spawnSync('git', args, { cwd });
  if (result.error) throw new Error(`could not run \`git ${args.join(' ')}\`: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').toString().trim();
    throw new Error(`\`git ${args.join(' ')}\` exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8');
}

/**
 * The hooks directory git would consult right now, absolute. Asking git rather
 * than assuming `.git/hooks` matters in both directions: it follows
 * `core.hooksPath` when one is already set, and it accounts for a `.git` file,
 * a worktree, or a submodule. A relative `core.hooksPath` resolves against the
 * working-tree root, which is why the call is anchored there.
 */
export function activeHooksDir(root) {
  const shown = git(['rev-parse', '--git-path', 'hooks'], { cwd: root }).trim();
  return isAbsolute(shown) ? shown : resolve(root, shown);
}

/** The files in `dir` that git would run: real hook names, no `.sample`. */
export function shadowed(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.endsWith('.sample') && HOOK_NAMES.has(name))
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .sort();
}

/** The one mode that says git will run a file as a hook. */
const EXECUTABLE_MODE = '100755';

/**
 * Whether this filesystem records an executable bit at all. `core.fileMode` is
 * false on Windows, where a hook's bit is neither stored nor consulted, so a
 * missing one there is not a fault on this machine — though the *recorded* mode
 * still is, because it is what every other machine checks out.
 */
function bitMatters(root) {
  // `--default` rather than a tolerant `--get`: an unset key means the
  // platform's own answer, which is the same answer the caller wants.
  return git(['config', '--default', 'true', '--get', 'core.fileMode'], { cwd: root }).trim() !== 'false';
}

/** `ls-files`/`ls-tree` lead with the mode, or print nothing for an absent path. */
function recordedMode(output) {
  const first = output.trim().split(/\s+/)[0] ?? '';
  return /^\d{6}$/.test(first) ? first : null;
}

/**
 * Every reason git would not run a tracked hook, each with the command that
 * fixes it. Only one of the three is visible on the machine doing the looking:
 *
 *   the index      what the next commit would carry
 *   HEAD           what a fresh clone checks out
 *   the bit here   what git consults in this working tree
 *
 * The first two are the ones that travel, and they are the reason this exists at
 * all: the executable bit is not what git stores, so a hook can be executable
 * on the machine that made it and dead in every clone. And git's failure is
 * quiet — a hint on stderr, then the commit proceeds — so a hook that stopped
 * running looks exactly like a hook that has nothing to say.
 *
 * `head: false` drops the middle question, for the one caller that asks these
 * while a commit is being made (`scripts/doctor.mjs --fast`). There HEAD is the
 * *previous* commit, and the way to fix a mode it recorded wrong is to make
 * this commit — so asking it would refuse the commit that repairs it, on behalf
 * of a checkout that commit is about to leave behind.
 */
export function hookProblems(root, path, { head: askHead = true } = {}) {
  const problems = [];
  const index = recordedMode(git(['ls-files', '-s', '--', path], { cwd: root }));

  let head = null;
  if (askHead) {
    try {
      head = recordedMode(git(['ls-tree', 'HEAD', '--', path], { cwd: root }));
    } catch {
      // An unborn HEAD has no recorded mode to be wrong about.
      head = null;
    }
  }

  if (index === null) {
    problems.push({ detail: `${path} is not tracked, so a clone gets no hook at all`, fix: `git add ${path}` });
  } else if (index !== EXECUTABLE_MODE) {
    problems.push({
      detail: `${path} is recorded in the index as ${index}, so the next commit would ship a hook git skips`,
      fix: `git update-index --chmod=+x ${path}`,
    });
  }
  if (head !== null && head !== EXECUTABLE_MODE) {
    problems.push({
      detail: `${path} is recorded in HEAD as ${head}, so a clone checks out a hook git ignores`,
      fix: `git update-index --chmod=+x ${path}   # then commit the mode change`,
    });
  }
  if (existsSync(join(root, path)) && bitMatters(root) && (statSync(join(root, path)).mode & 0o111) === 0) {
    problems.push({
      detail: `${path} is not executable on this machine, and git skips a hook without the bit`,
      fix: `chmod +x ${path}`,
    });
  }
  return problems;
}

/** Paths read best against the repository, unless they are outside it. */
function show(path, root) {
  const rel = relative(root, path);
  return rel && !rel.startsWith('..') ? rel : path;
}

function installedHooks(root) {
  const dir = join(root, HOOKS_PATH);
  return existsSync(dir) ? readdirSync(dir).filter((name) => !name.endsWith('.sample')).sort() : [];
}

/**
 * The fixture this depends on: `git init` fills a hooks directory with
 * `*.sample` templates, which must NOT count, and then we plant a real
 * `pre-commit` next to them, which must. Without it, a resolver that quietly
 * looked in the wrong place would report a clean directory and this would
 * cheerfully shadow whatever is really there — the exact silent disable the
 * warning exists to prevent, reintroduced by the warning's own bug.
 */
function proveItCanSee() {
  const dir = mkdtempSync(join(tmpdir(), 'hooks-install-'));
  try {
    git(['init', '-q'], { cwd: dir });
    // Pin the scratch repository to its own hooks directory so a global
    // `core.hooksPath` cannot point this fixture at somebody's real hooks.
    const hooks = join(dir, '.git', 'hooks');
    git(['config', 'core.hooksPath', hooks], { cwd: dir });

    if (resolve(activeHooksDir(dir)) !== resolve(hooks)) {
      throw new Error(`resolved the hooks directory to ${activeHooksDir(dir)} but this fixture planted in ${hooks}`);
    }
    if (shadowed(hooks).length !== 0) {
      throw new Error('a freshly initialised repository reported a hook — the `*.sample` templates must not count');
    }

    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 0\n');
    if (!shadowed(hooks).some((path) => path === join(hooks, 'pre-commit'))) {
      throw new Error('planted a non-sample pre-commit and it was not reported');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Returns the process exit code. */
export function install({ force = false, root = null } = {}) {
  const top = root ?? git(['rev-parse', '--show-toplevel']).trim();
  const wanted = join(top, HOOKS_PATH);

  if (!existsSync(join(wanted, 'pre-commit'))) {
    throw new Error(`${show(join(wanted, 'pre-commit'), top)} does not exist — there is nothing to install`);
  }
  proveItCanSee();
  // And the helper that claims the config key has to be able to *see* a value
  // already there, or it would report every key as unset and replace it.
  proveItCanClaim();

  // A hook that cannot run is not a hook, and this is the one moment its owner
  // is looking: installing would otherwise print a success that nothing will
  // ever act on. It is asked before the already-installed case too, because
  // "already installed" is exactly as misleading once the hook has gone dark.
  const dead = hookProblems(top, `${HOOKS_PATH}/pre-commit`);
  if (dead.length > 0 && !force) {
    console.error(`✗ Refusing to install: ${HOOKS_PATH}/pre-commit would not run.\n`);
    for (const problem of dead) {
      console.error(`    ${problem.detail}`);
      console.error(`      ${problem.fix}\n`);
    }
    console.error(
      'Install it once the hook can run — a hooks directory git consults and skips is a\n' +
        'success message with nothing behind it.',
    );
    return 1;
  }

  const active = activeHooksDir(top);
  if (resolve(active) === resolve(wanted)) {
    const names = installedHooks(top);
    console.log(`✓ ${HOOKS_PATH}/ is already this clone's hooks directory${names.length ? ` (${names.join(', ')})` : ''}.`);
    return 0;
  }

  const inTheWay = shadowed(active);
  if (inTheWay.length > 0 && !force) {
    console.error(
      `✗ Refusing to install: ${inTheWay.length} hook${inTheWay.length === 1 ? '' : 's'} would stop running.\n`,
    );
    console.error(
      '`core.hooksPath` replaces the hooks directory rather than adding to it, so the moment it\n' +
        `points at ${HOOKS_PATH}/, git never reads these again:\n`,
    );
    for (const path of inTheWay) console.error(`    ${show(path, top)}`);
    console.error(
      `\n  (currently the hooks directory: ${show(active, top)})\n\n` +
        `Move them into ${HOOKS_PATH}/ — git runs whatever is in there — or install anyway:\n\n` +
        '    npm run hooks:install -- --force\n\n' +
        'To undo an install later:  git config --unset core.hooksPath',
    );
    return 1;
  }

  // The write is the one that replaces rather than adds: a `core.hooksPath`
  // that already holds a value — the user's, another tool's, possibly the
  // global one that governs every repository on the machine — is theirs, and
  // claiming it is a decision `--force` has to make explicitly.
  const claim = claimConfig(top, 'core.hooksPath', HOOKS_PATH, { force, override: 'npm run hooks:install -- --force' });
  if (claim.status === 'refused') {
    console.error('✗ Refusing to install:\n');
    for (const line of claim.lines) console.error(`  ${line}`);
    console.error('\nNothing was changed. core.hooksPath belongs to whoever set it.');
    return 1;
  }

  const names = installedHooks(top);
  if (inTheWay.length > 0) {
    console.log(`⚠ Forcing past ${inTheWay.length} hook${inTheWay.length === 1 ? '' : 's'} in ${show(active, top)}.`);
  }
  for (const problem of dead) console.log(`⚠ Forcing past a hook git would not run: ${problem.detail}`);
  console.log(`✓ core.hooksPath = ${HOOKS_PATH}/ — this clone runs ${names.join(', ') || 'no hooks'} before a commit.`);
  for (const line of claim.lines) console.log(line);
  return 0;
}

// Only when run as the script: importing this module to exercise `shadowed`
// should not install anything into whatever repository the caller is in.
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--force');
  try {
    if (unknown.length > 0) {
      throw new Error(`unrecognised argument${unknown.length === 1 ? '' : 's'}: ${unknown.join(' ')} (usage: hooks-install.mjs [--force])`);
    }
    process.exit(install({ force: args.includes('--force') }));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    console.error('\nHooks install could not run — nothing was changed.');
    process.exit(2);
  }
}

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
import { pathToFileURL } from 'node:url';

/** The tracked directory this installs, as written into the repo's config. */
const HOOKS_PATH = '.githooks';

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

  git(['config', 'core.hooksPath', HOOKS_PATH], { cwd: top });
  const names = installedHooks(top);
  if (inTheWay.length > 0) {
    console.log(`⚠ Forcing past ${inTheWay.length} hook${inTheWay.length === 1 ? '' : 's'} in ${show(active, top)}.`);
  }
  console.log(`✓ core.hooksPath = ${HOOKS_PATH}/ — this clone runs ${names.join(', ') || 'no hooks'} before a commit.`);
  console.log('  Undo with: git config --unset core.hooksPath');
  return 0;
}

// Only when run as the script: importing this module to exercise `shadowed`
// should not install anything into whatever repository the caller is in.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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

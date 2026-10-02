/**
 * The local git config, read and written without silently taking something away.
 *
 * `git config <key> <value>` cannot fail at the moment that matters. It does not
 * mention that the key already held a value, that the value came from the user's
 * global config, or that another tool put it there: it replaces it, and the next
 * commit behaves differently. A setup script whose whole purpose is to make a
 * clone *stricter* is the worst place in the world for that, because the setting
 * it clears may be the one that was already protecting somebody.
 *
 * So writes go through `claimConfig`, which reads the key first — with
 * `--show-scope --show-origin`, so a refusal can say whose value it is — and
 * answers one of three ways:
 *
 *   unchanged   the key already holds the value asked for. Nothing is written
 *               and nothing is said: re-running an install is not an event.
 *   written     the key was unset, or `force` was passed. The lines say what was
 *               replaced, and how to put it back.
 *   refused     the key holds a different value. The lines name it, say whether
 *               it is this clone's or the machine's, and nothing is written
 *               until `--force` — or the caller's own hint for it — says the
 *               replacement was meant.
 *
 * This decides nothing about *which* keys a script should claim; that stays the
 * calling script's judgement. It only makes the claim honest. A new setup script
 * gets the same protection for free:
 *
 *   import { claimConfig } from './local-config.mjs';
 *
 *   const claim = claimConfig(root, 'commit.gpgsign', 'true', { force, override: 'npm run setup -- --force' });
 *   if (claim.status === 'refused') {
 *     for (const line of claim.lines) console.error(line);
 *     return 1;
 *   }
 *   for (const line of claim.lines) console.log(line);
 *
 * Needs git 2.26 or newer, for `--show-scope`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function git(args, { cwd, allowMissing = false } = {}) {
  const result = spawnSync('git', args, { cwd });
  if (result.error) throw new Error(`could not run \`git ${args.join(' ')}\`: ${result.error.message}`);
  if (result.status !== 0 && !allowMissing) {
    const detail = (result.stderr ?? '').toString().trim();
    throw new Error(`\`git ${args.join(' ')}\` exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8');
}

/**
 * A key's value and where it comes from. `scope` is git's own word: `local` is
 * this clone, `global` and `system` belong to the machine and apply to every
 * repository on it. An empty value reads as unset, because that is how git reads
 * one — a bare `core.hooksPath =` is not a claim on the default hooks directory.
 */
export function readConfig(root, key) {
  const out = git(['config', '--show-scope', '--show-origin', '--get', key], { cwd: root, allowMissing: true }).trim();
  if (out === '') return { value: null, scope: null, origin: null };
  const [scope, origin = '', ...rest] = out.split('\t');
  const value = rest.join('\t');
  return { value: value === '' ? null : value, scope, origin: origin.replace(/^file:/, '') };
}

/** Whose value it is, in words that say how far it reaches. */
function where(current) {
  if (current.scope === 'local') return `in this clone's config (${current.origin})`;
  return `in your ${current.scope} config (${current.origin}), so it applies to every repository on this machine`;
}

/** The command that clears a value at the scope it lives at. */
function clearCommand(key, scope) {
  return scope && scope !== 'local' ? `git config --${scope} --unset ${key}` : `git config --unset ${key}`;
}

/**
 * Claims `key` for `value`, refusing to take away a value that is already there
 * unless `force` says so. `override` is the caller's own hint for how to force
 * it (`npm run hooks:install -- --force`), included in the refusal so the reader
 * is never told to stop without being told how to continue.
 */
export function claimConfig(root, key, value, { force = false, override = null } = {}) {
  const current = readConfig(root, key);

  if (current.value === value) return { status: 'unchanged', current, lines: [] };

  if (current.value !== null && !force) {
    return {
      status: 'refused',
      current,
      lines: [
        `${key} is already set to ${current.value}, ${where(current)}, and this would replace it with ${value}.`,
        '',
        ...(override ? [`  Replace it:  ${override}`] : []),
        `  Or clear it and run this again:  ${clearCommand(key, current.scope)}`,
      ],
    };
  }

  git(['config', key, value], { cwd: root });

  const lines = [`  Undo with: git config --unset ${key}`];
  if (current.value !== null) {
    lines.unshift(`⚠ It was ${current.value}, ${where(current)}.`);
    // Whose value it was decides how to give it back: ours is the only one to
    // remove, theirs is replaced rather than deleted.
    lines[1] = current.scope === 'local'
      ? `  Put it back with: git config ${key} ${current.value}`
      : `  Undo with: git config --unset ${key}   # the ${current.scope} value applies again`;
  }
  return { status: 'written', current, lines };
}

/**
 * The fixture this guard depends on. A claim helper that could not *see* an
 * existing value would report every key as unset and overwrite it — precisely
 * the silent replacement this exists to prevent, with the guard's own bug as the
 * cause. So each of the three answers is planted and checked in a scratch
 * repository, including a value that comes from the global config (pointed at a
 * scratch file, so a real one is never touched), since that is the case whose
 * reach — every repository on the machine — changes what a refusal should say.
 */
export function proveItCanClaim() {
  const dir = mkdtempSync(join(tmpdir(), 'local-config-'));
  const machineConfig = join(dir, 'machine-gitconfig');

  // The fixture has to disagree with a real machine, not inherit it: a user who
  // sets `core.hooksPath` globally would otherwise make its first premise false,
  // and the install would fail as "could not run" on exactly the machines the
  // refusal exists for. Both files are pointed at scratch and put back after.
  const previous = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  process.env.GIT_CONFIG_GLOBAL = machineConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';

  try {
    git(['init', '-q'], { cwd: dir });

    let claim = claimConfig(dir, 'core.hooksPath', '.githooks');
    if (claim.status !== 'written') throw new Error(`a claim on an unset key reported "${claim.status}"`);

    claim = claimConfig(dir, 'core.hooksPath', '.githooks');
    if (claim.status !== 'unchanged') throw new Error(`a claim on a value already set reported "${claim.status}"`);

    git(['config', 'core.hooksPath', '.husky'], { cwd: dir });
    claim = claimConfig(dir, 'core.hooksPath', '.githooks');
    if (claim.status !== 'refused') throw new Error(`a claim on another value in this clone reported "${claim.status}"`);
    if (readConfig(dir, 'core.hooksPath').value !== '.husky') throw new Error('a refused claim wrote to the config anyway');

    claim = claimConfig(dir, 'core.hooksPath', '.githooks', { force: true });
    if (claim.status !== 'written') throw new Error(`a forced claim reported "${claim.status}"`);
    if (!claim.lines.some((line) => line.includes('.husky'))) throw new Error('a forced claim did not say what it replaced');

    git(['config', '--unset', 'core.hooksPath'], { cwd: dir });
    writeFileSync(machineConfig, '[core]\n\thooksPath = .husky\n');
    claim = claimConfig(dir, 'core.hooksPath', '.githooks');
    if (claim.status !== 'refused') throw new Error(`a claim on a value from the global config reported "${claim.status}"`);
    if (!claim.lines.some((line) => line.includes('global'))) throw new Error('a refusal did not say whose value it was refusing');
  } finally {
    for (const [key, value] of [['GIT_CONFIG_GLOBAL', previous.global], ['GIT_CONFIG_NOSYSTEM', previous.system]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

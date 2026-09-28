/**
 * Whether the commit-time hook is there, whether git would run it, and whether
 * it refuses anything — three questions, because the failures are shaped alike
 * and only one of them is visible.
 *
 * Git IGNORES a hook without the executable bit: a hint on stderr, then the
 * commit proceeds. So a mode that drifts turns the gate off in silence, and a
 * hook that stopped running looks exactly like a hook with nothing to say. Two
 * modes are asked about rather than one — the bit on this machine, and the mode
 * git has *recorded*, which is what every clone checks out; a hook can be
 * executable where it was written and arrive dead everywhere else.
 *
 * This is one file with three contexts, which is why it reads longer than its
 * neighbours:
 *
 *   - on demand (default) it asks all three questions, and running the hook is
 *     the only answer that covers a lost bit, a broken shebang and a `node` git
 *     cannot see.
 *   - `atCommit` (the `commit: true` half, run by the hook itself) asks only
 *     about the index. HEAD there is the *previous* commit and the way to fix a
 *     mode it recorded wrong is this commit, so asking about HEAD would refuse
 *     the very commit that repairs it — and `git hook run` would be a hook
 *     running itself, which does not terminate.
 *   - `ci`, where nothing installs hooks, "is it installed in this clone" is not
 *     a question CI can answer or needs to; the question a commit asks is the
 *     one worth asking, and `scripts/hook-check.mjs` owns it (it runs the hook
 *     through git, then plants a rule the hook has to refuse). Imported, not
 *     re-derived: a second opinion about an invariant is a second thing to keep
 *     in sync.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkHook } from '../../hook-check.mjs';
import { HOOKS_PATH, activeHooksDir, hookProblems, shadowed } from '../../hooks-install.mjs';
import { readConfig } from '../../local-config.mjs';
import { commit, configure, track, write, writeExecutable } from '../fixture.mjs';
import { gitDir, show } from '../lib.mjs';

/**
 * The fixture's hook is the real gitignore gate, by absolute path, because what
 * a scenario here is testing is the doctor's reading of a hook — not the gate,
 * which carries its own fixture. A hook that answered differently from this
 * repo's would prove something about a hook nobody has.
 */
const GATE = fileURLToPath(new URL('../../gitignore-gate.mjs', import.meta.url));
const WORKING = `#!/bin/sh\nexec node ${JSON.stringify(GATE)}\n`;

/** A hook in the fixture, executable, tracked and committed — the whole state. */
function installHook(root, body = WORKING) {
  writeExecutable(root, `${HOOKS_PATH}/pre-commit`, body);
  track(root, `${HOOKS_PATH}/pre-commit`);
  commit(root, 'the hook');
}

export default {
  name: 'hooks',
  order: 60,
  commit: true,
  proof: [
    {
      level: 'pass',
      repo: true,
      why: 'installed, and running it goes clean on a checkout with nothing wrong',
      setup: (root) => {
        installHook(root);
        configure(root, 'core.hooksPath', HOOKS_PATH);
      },
    },
    {
      level: 'pass',
      repo: true,
      why: 'at commit time the question is the index, and this index carries an executable hook',
      context: { atCommit: true },
      setup: (root) => installHook(root),
    },
    {
      level: 'pass',
      repo: true,
      why: 'on CI nothing installs a hook, so what is asked is whether the hook refuses — and this one does',
      context: { ci: true },
      setup: (root) => installHook(root),
    },
    {
      level: 'warn',
      repo: true,
      why: 'the hook is there and git is not pointed at it, which is a choice a clone is free to make',
      setup: (root) => {
        installHook(root);
        // Pinned locally, so no global core.hooksPath can decide this scenario.
        configure(root, 'core.hooksPath', '.git/hooks');
      },
    },
    {
      level: 'fail',
      repo: true,
      why: 'the index records the hook as 100644, so the next commit would ship one git skips',
      setup: (root) => {
        write(root, `${HOOKS_PATH}/pre-commit`, '#!/bin/sh\nexit 0\n');
        track(root, `${HOOKS_PATH}/pre-commit`);
      },
    },
    {
      level: 'fail',
      repo: true,
      why: 'a hook that succeeds whatever it is asked — the emptied hook, which a plain run cannot tell from a working one',
      context: { ci: true },
      setup: (root) => installHook(root, '#!/bin/sh\nexit 0\n'),
    },
  ],
  run(root, { ci = false, atCommit = false } = {}) {
    const wanted = join(root, HOOKS_PATH);
    const preCommit = join(wanted, 'pre-commit');
    if (!existsSync(preCommit)) {
      return {
        level: 'fail',
        detail: `${HOOKS_PATH}/pre-commit is missing — there is no gate to install`,
        hint: 'the gate itself lives in scripts/gitignore-gate.mjs',
      };
    }

    const installed = shadowed(wanted);
    if (installed.length === 0) {
      return {
        level: 'fail',
        detail: `${HOOKS_PATH}/ holds no file git would run as a hook`,
        hint: 'pre-commit is the hook this repo ships',
      };
    }

    // The commit-time run asks only the index (`head: false`, see hookProblems):
    // HEAD there is the commit before this one, and the commit that fixes a
    // wrong mode is this one.
    const dead = hookProblems(root, `${HOOKS_PATH}/pre-commit`, { head: !atCommit });
    if (dead.length > 0) {
      return {
        level: 'fail',
        detail: dead.map((problem) => problem.detail).join('; '),
        hint: [...new Set(dead.map((problem) => problem.fix))],
      };
    }

    // Past this point the mode is the one git runs, so a commit in progress has
    // the answer it came for: whether the hook is installed, and whether it
    // runs, are questions about the machine — and the hook is what is asking.
    if (atCommit) {
      return { detail: `the commit in progress would carry ${HOOKS_PATH}/pre-commit as an executable hook` };
    }

    if (ci) {
      const { ok, detail, fixes } = checkHook(root);
      return ok ? { detail } : { level: 'fail', detail, hint: fixes };
    }

    // The hooks git would consult by default, which is what installing replaces.
    const legacy = shadowed(join(gitDir(root), 'hooks'));
    const active = activeHooksDir(root);
    const isInstalled = resolve(active) === resolve(wanted);

    const names = installed.map((path) => show(path, root)).join(', ');
    if (!isInstalled) {
      // Read with its origin: a value living in the global config is not a stray
      // setting in this clone, it is a decision about every repository on the
      // machine, and the fix is not the same command.
      const configured = readConfig(root, 'core.hooksPath');
      const isWhere = configured.value === null
        ? 'unset'
        : `${configured.value}${configured.scope === 'local' ? '' : ` (your ${configured.scope} config)`}`;
      const hints = ['npm run hooks:install'];
      if (legacy.length > 0) {
        hints.push(
          `installing refuses while ${legacy.map((path) => show(path, root)).join(', ')} exist${legacy.length === 1 ? 's' : ''} in ${show(join(gitDir(root), 'hooks'), root)} — move them into ${HOOKS_PATH}/, or pass --force`,
        );
      }
      return {
        level: 'warn',
        detail: `not installed — core.hooksPath is ${isWhere}, so the commit-time checks run on CI but not before your commit`,
        hint: hints,
      };
    }

    // Installed means git WOULD run these; whether it CAN is a separate question
    // — a lost mode bit, a broken shebang or a `node` git cannot see all leave a
    // hook that reads as present and never fires. Asking git to run the hook is
    // the only answer that covers all three.
    const ran = spawnSync('git', ['hook', 'run', 'pre-commit'], { cwd: root, encoding: 'utf8' });
    if (ran.error) throw new Error(`could not run \`git hook run pre-commit\`: ${ran.error.message}`);
    if (ran.status !== 0) {
      const first = (ran.stderr ?? '').split('\n').find((line) => line.trim() !== '') ?? `exit ${ran.status}`;
      return {
        level: 'fail',
        detail: `installed (${names}), but running it fails: ${first.trim()}`,
        hint: 'the hook runs `node scripts/doctor.mjs --fast` — fix what it reports, or what it needs to run',
      };
    }

    const ranDetail = `installed (${names}) and it runs`;
    if (legacy.length > 0) {
      return {
        level: 'warn',
        detail: `${ranDetail}, but git no longer reads ${legacy.map((path) => show(path, root)).join(', ')}`,
        hint: `${HOOKS_PATH}/ replaced the hooks directory rather than joining it`,
      };
    }
    return { detail: ranDetail };
  },
};

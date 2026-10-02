/**
 * Whether the program that provisions the Neon secrets still passes its own
 * checks.
 *
 * `scripts/neon-secrets.mjs` decides whether to create a project and an empty
 * parent branch or reuse what is there, and the `store` CI job depends on the
 * ids it prints. That decision lives in the one context where nothing could be
 * tested: the job only needs it once there is an account, and this repository
 * has no `NEON_API_KEY`, so every push that touched the script proved nothing
 * about whether it still worked. `--self-test` checks the decisions against a
 * stubbed `fetch`, and `--self-test-e2e` checks them against a fake console on
 * localhost over real HTTP — no account, no network, nothing written.
 *
 * So this is the question rather than a rule about the source: the two modes
 * are run, and a failure in either is a failure here. A check that read the
 * file could only report that the script still exists and still mentions its
 * modes, which is true of a script whose create path has been broken since the
 * day it was written.
 *
 * It is a commit-time check because it is the fastest one here — two node
 * processes, no fixture checkout, no git, no network — and because the commit
 * that breaks a script is the one that should not be the commit that finds out.
 *
 * The environment is the fixture one, for the same reason every program run
 * inside this doctor gets it: a doctor started by a commit has `GIT_DIR` and
 * its siblings exported into it, and those name the real checkout.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureEnv, write } from '../fixture.mjs';

/** The two modes, and what each one is for. Both must exit 0. */
const MODES = [
  ['--self-test', 'decisions'],
  ['--self-test-e2e', 'create path over HTTP'],
];

/** The file the modes run, and the one module it imports. */
const SCRIPT = 'scripts/neon-secrets.mjs';
const DEPENDENCY = 'scripts/is-main.mjs';

/** Long enough for two node startups and a loopback server, short enough for a commit. */
const LIMIT = 60_000;

/** The mode, and the first line that says it failed. */
function run(root, mode) {
  const result = spawnSync(process.execPath, [join(root, SCRIPT), mode], {
    cwd: root,
    encoding: 'utf8',
    timeout: LIMIT,
    env: fixtureEnv(),
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const lines = output.split('\n');
  return {
    output,
    // A mode that exits 0 having said nothing has run no checks at all: it is a
    // self-test that was emptied out, not one that passed, and reading its exit
    // code as a verdict is the mistake that would let it stay emptied. So a run
    // is only a pass if it printed claims and every one of them held.
    silent: !lines.some((line) => line.startsWith('PASS') || line.startsWith('FAIL')),
    failed: result.status !== 0,
    // The line naming the claim that did not hold, so the report says which
    // check failed rather than that a number went up.
    blame: lines.find((line) => line.startsWith('FAIL') || line.startsWith('neon-secrets:')) ?? '',
    couldNotRun: result.error ? result.error.code ?? result.error.message : null,
  };
}

/** The two scripts as they are, so a fixture can be given a working program. */
function copyIn(root, from) {
  write(root, SCRIPT, readFileSync(join(from, SCRIPT), 'utf8'));
  write(root, DEPENDENCY, readFileSync(join(from, DEPENDENCY), 'utf8'));
}

/** The real checkout, which the fixtures copy from and the report is about. */
const here = join(import.meta.dirname, '..', '..', '..');

export default {
  name: 'neon self-tests',
  order: 48,
  commit: true,
  proof: [
    {
      level: 'pass',
      why: 'the provisioning program, as it is — every check in both modes holds',
      setup: (root) => copyIn(root, here),
    },
    {
      level: 'fail',
      why: 'a create path whose request a real console would answer 400 to, which is the failure the stub could not see',
      setup: (root) => {
        copyIn(root, here);
        const file = join(root, SCRIPT);
        const text = readFileSync(file, 'utf8');
        write(root, SCRIPT, text.replace('body: { branch: { name: PARENT_BRANCH_NAME } },', 'body: { name: PARENT_BRANCH_NAME },'));
      },
    },
    {
      level: 'fail',
      why: 'a self-test that reports nothing and exits clean, which is a removed check rather than a passing one',
      setup: (root) => {
        copyIn(root, here);
        const text = readFileSync(join(root, SCRIPT), 'utf8');
        write(
          root,
          SCRIPT,
          text.replace(/^import \{ spawnSync \}.*$/m, "import { spawnSync } from 'node:child_process';\nprocess.exit(0);"),
        );
      },
    },
    {
      level: 'warn',
      why: 'a checkout with no provisioning program in it, where there is nothing to prove',
      setup: () => {},
    },
  ],
  run(root) {
    if (!existsSync(join(root, SCRIPT))) {
      return {
        level: 'warn',
        detail: `${SCRIPT} is not here — the provisioning self-tests had nothing to run`,
        hint: 'the store CI job resolves its two Neon ids with this program; without it that job has nothing to resolve them with',
      };
    }

    const broken = [];
    let claims = 0;
    for (const [mode, what] of MODES) {
      const { failed, silent, blame, couldNotRun, output } = run(root, mode);
      if (couldNotRun !== null) {
        broken.push(`${mode} could not be run at all — ${couldNotRun}`);
        continue;
      }
      if (silent) {
        broken.push(`${mode} exited ${failed ? 'non-zero' : 'clean'} having printed no checks — that is a self-test that ran nothing, not one that passed`);
        continue;
      }
      claims += output.split('\n').filter((line) => line.startsWith('PASS')).length;
      if (!failed) continue;
      broken.push(`${mode} (${what}) failed${blame ? ` — ${blame.replace(/^FAIL\s+/, '')}` : ''}`);
      // One failure is enough to report, and the mode that failed is the more
      // useful half of its output, so the rest is only shown when there is
      // nothing more specific to say.
      if (output.split('\n').length <= 2) broken.push(output);
    }

    if (broken.length > 0) {
      return {
        level: 'fail',
        detail: `${broken.length} of ${MODES.length} provisioning self-test modes did not pass`,
        hint: [
          ...broken,
          'run `node scripts/neon-secrets.mjs --self-test` and `--self-test-e2e` to see every check',
          'neither mode needs an account, a network or a secret: the second one talks to a fake console on localhost',
        ],
      };
    }
    return {
      detail: `${claims} provisioning checks passed across both modes — no account, no network, no secret needed`,
    };
  },
};

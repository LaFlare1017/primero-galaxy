/**
 * Whether the programs that drive Neon still pass their own checks.
 *
 * Two of them, and neither can be tested the way they are used. `neon-secrets.mjs`
 * finds or creates the project and the empty parent branch the store CI job
 * branches from; `neon-branch.mjs` creates the branch for one run, waits for its
 * compute to start, resolves a connection URI and drops it again. Both only do
 * anything once there is an account, and this repository has no
 * `NEON_API_KEY`, so every run of that job has skipped every step either of them
 * is responsible for. A branch created without `read_write`, a readiness poll
 * that gives up one attempt early, a URI resolved for the wrong branch: each
 * would first be seen as "the driver is untested", which is the job's least
 * useful failure message, because it is the one you get when the setup itself
 * is wrong.
 *
 * The console they are tested against is `neon-fake-console.mjs`, which is a
 * module of its own rather than part of either program: a fake that lives inside
 * the program it tests can only be used by that program, which is what made the
 * branch program's checks import the provisioning program to get at it.
 *
 * So this is the question rather than a rule about the source: the modes are
 * run, and a failure in any of them is a failure here. A check that read the
 * files could only report that the programs still exist and still mention their
 * modes, which is true of scripts whose create path has been broken since the
 * day they were written.
 *
 * It is a commit-time check because it is among the fastest here — a handful of
 * node processes, no fixture checkout, no git, no network — and because the
 * commit that breaks a script is the one that should not be the commit that
 * finds out.
 *
 * The environment is the fixture one, for the same reason every program run
 * inside this doctor gets it: a doctor started by a commit has `GIT_DIR` and
 * its siblings exported into it, and those name the real checkout.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureEnv, write } from '../fixture.mjs';

/**
 * Every program, and every mode of it, that has to pass.
 *
 * Two shapes of program, one table: `neon-secrets.mjs` decides whether to create
 * the project and the branch or reuse what is there, and `neon-branch.mjs` owns
 * the branch a single run lives on. A mode listed here and never run is a claim
 * with nothing behind it, and a program that grows a mode without a row here
 * is a program whose new behaviour is untested in a way nothing reports.
 */
const PROGRAMS = [
  {
    script: 'scripts/neon-secrets.mjs',
    what: 'provisioning',
    modes: [
      ['--self-test', 'decisions'],
      ['--self-test-e2e', 'create path over HTTP'],
    ],
  },
  {
    script: 'scripts/neon-branch.mjs',
    what: 'per-run branch',
    modes: [
      ['--self-test', 'decisions'],
      ['--self-test-e2e', 'create, readiness, URI and delete over HTTP'],
    ],
  },
];

/**
 * What a mode has to import to run at all.
 *
 * Every file, not just the entry points: a fixture that copies the two programs
 * and not the client and the console beside them gets a module-not-found, which
 * is a doctor failure about the fixture rather than a finding about a Neon
 * program. That is the shape of bug this check exists to catch being caught by
 * the check itself.
 */
const SHARED = [
  'scripts/is-main.mjs',
  'scripts/neon-api.mjs',
  'scripts/neon-fake-console.mjs',
];

/** Long enough for four node startups and two loopback servers, short enough for a commit. */
const LIMIT = 60_000;

/** The mode, and the first line that says it failed. */
function run(root, script, mode) {
  const result = spawnSync(process.execPath, [join(root, script), mode], {
    cwd: root,
    encoding: 'utf8',
    timeout: LIMIT,
    env: fixtureEnv(),
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const lines = output.split('\n');
  const name = script.replace('scripts/', '');
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
    blame: lines.find((line) => line.startsWith('FAIL') || line.startsWith(`${name}:`)) ?? '',
    couldNotRun: result.error ? result.error.code ?? result.error.message : null,
  };
}

/** The programs as they are, so a fixture can be given working ones. */
function copyIn(root, from) {
  for (const { script } of PROGRAMS) {
    write(root, script, readFileSync(join(from, script), 'utf8'));
  }
  for (const shared of SHARED) write(root, shared, readFileSync(join(from, shared), 'utf8'));
}

/** One program, broken in one named way. */
function breakScript(root, script, from, to) {
  const path = join(root, script);
  const text = readFileSync(path, 'utf8');
  if (!text.includes(from)) throw new Error(`${script} no longer contains the text this fixture edits`);
  write(root, script, text.replace(from, to));
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
      why: 'both programs as they are — every check in every mode holds',
      setup: (root) => copyIn(root, here),
    },
    {
      level: 'fail',
      why: 'a create path whose request a real console would answer 400 to, which is the failure the stub could not see',
      setup: (root) => {
        copyIn(root, here);
        breakScript(
          root,
          'scripts/neon-secrets.mjs',
          'body: { branch: { name: PARENT_BRANCH_NAME } },',
          'body: { name: PARENT_BRANCH_NAME },',
        );
      },
    },
    {
      level: 'fail',
      why: 'a branch that never starts being treated as ready — the window only a real console has',
      setup: (root) => {
        copyIn(root, here);
        breakScript(
          root,
          'scripts/neon-branch.mjs',
          "if (state === 'ready') return { ready: true, attempt };",
          "if (state !== 'absent') return { ready: true, attempt };",
        );
      },
    },
    {
      level: 'fail',
      why: 'a self-test that reports nothing and exits clean, which is a removed check rather than a passing one',
      setup: (root) => {
        copyIn(root, here);
        breakScript(
          root,
          'scripts/neon-secrets.mjs',
          "import { spawnSync } from 'node:child_process';",
          "import { spawnSync } from 'node:child_process';\nprocess.exit(0);",
        );
      },
    },
    {
      level: 'warn',
      why: 'a checkout with neither program in it, where there is nothing to prove',
      setup: () => {},
    },
    // ── the console's four refusals on the CREATE paths ───────────────────
    //
    // These are the strictness the fake console's own header names as the
    // reason it exists: a create sent in the wrong shape, and a name used
    // twice. Every other refusal that console enforces was already pinned by a
    // check in one of the two programs above — the bad bearer, the `expires_at`
    // the console would reject, the `connection_uri` for a branch that is gone
    // — so those needed no fixture of their own. These four had no check
    // anywhere in this repository, which meant the strictness was a sentence in
    // a comment rather than a behaviour anyone could break and find out.
    //
    // Each fixture forgives ONE refusal in the console and requires this check
    // to go red, which is the whole claim: a fake that forgave these would pass
    // every program here, and would pass the fixture above that proves the
    // nested `branch.name` matters — a fixture that would then be green for the
    // wrong reason instead of red for the right one.
    {
      level: 'fail',
      why: 'a project create with no name, which the console forgives and answers with a nameless row',
      setup: (root) => {
        copyIn(root, here);
        breakScript(
          root,
          'scripts/neon-fake-console.mjs',
          "if (typeof body.name !== 'string' || body.name === '') {",
          'if (false) {',
        );
      },
    },
    {
      level: 'fail',
      why: 'a duplicate project name the console admits twice rather than answering 409',
      setup: (root) => {
        copyIn(root, here);
        breakScript(
          root,
          'scripts/neon-fake-console.mjs',
          'if (projects.some((p) => p.name === body.name)) {',
          'if (false) {',
        );
      },
    },
    {
      level: 'fail',
      why: 'a branch create whose name is not nested under `branch`, read off the top level instead of refused',
      setup: (root) => {
        copyIn(root, here);
        // Deliberately NOT `if (false)`. A console that merely stopped CHECKING
        // would then dereference the absent `body.branch` and crash, which fails
        // for a reason that has nothing to do with the refusal — the same
        // mistake as a proof that passes because it crashed. This is what
        // forgiving actually looks like: take the name wherever it finds it.
        breakScript(
          root,
          'scripts/neon-fake-console.mjs',
          'const asked = body.branch;',
          'const asked = body.branch ?? body;',
        );
      },
    },
    {
      level: 'fail',
      why: 'a duplicate branch name the console admits twice, so two runs could branch from different databases under one name',
      setup: (root) => {
        copyIn(root, here);
        breakScript(
          root,
          'scripts/neon-fake-console.mjs',
          'if (branchList().some((b) => b.name === asked.name)) {',
          'if (false) {',
        );
      },
    },
  ],
  run(root) {
    const present = PROGRAMS.filter((program) => existsSync(join(root, program.script)));
    if (present.length === 0) {
      return {
        level: 'warn',
        detail: 'neither Neon program is here — the provisioning self-tests had nothing to run',
        hint: 'the store CI job resolves its two Neon ids and then creates a branch per run; without these programs that job has nothing to run',
      };
    }
    const absent = PROGRAMS.filter((program) => !present.includes(program)).map((p) => p.script);
    if (absent.length > 0) {
      // Not a warning: the store job calls these by path, so a checkout missing
      // one has a job that fails at a step rather than one that skips.
      return {
        level: 'fail',
        detail: `${absent.length} of ${PROGRAMS.length} Neon programs are missing: ${absent.join(', ')}`,
        hint: 'the store CI job runs these by path, so a missing program is a failed step, not a skipped one',
      };
    }

    const broken = [];
    let claims = 0;
    for (const { script, what, modes } of PROGRAMS) {
      for (const [mode, about] of modes) {
        const { failed, silent, blame, couldNotRun, output } = run(root, script, mode);
        if (couldNotRun !== null) {
          broken.push(`${script} ${mode} could not be run at all — ${couldNotRun}`);
          continue;
        }
        if (silent) {
          broken.push(
            `${script} ${mode} exited ${failed ? 'non-zero' : 'clean'} having printed no checks — that is a self-test that ran nothing, not one that passed`,
          );
          continue;
        }
        claims += output.split('\n').filter((line) => line.startsWith('PASS')).length;
        if (!failed) continue;
        broken.push(`${script} ${mode} (${what}: ${about}) failed${blame ? ` — ${blame.replace(/^FAIL\s+/, '')}` : ''}`);
        // One failure is enough to report, and the mode that failed is the more
        // useful half of its output, so the rest is only shown when there is
        // nothing more specific to say.
        if (output.split('\n').length <= 2) broken.push(output);
      }
    }

    if (broken.length > 0) {
      return {
        level: 'fail',
        detail: `${broken.length} of ${PROGRAMS.reduce((n, p) => n + p.modes.length, 0)} Neon self-test modes did not pass`,
        hint: [
          ...broken,
          'run `node scripts/neon-secrets.mjs --self-test-e2e` and `node scripts/neon-branch.mjs --self-test-e2e` to see every check',
          'no mode needs an account, a network or a secret: they talk to a fake console on localhost',
        ],
      };
    }
    return {
      detail: `${claims} Neon checks passed across ${PROGRAMS.length} programs — no account, no network, no secret needed`,
    };
  },
};

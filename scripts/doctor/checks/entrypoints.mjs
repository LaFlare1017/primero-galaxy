/**
 * Every script under `scripts/` that is run as a program, run.
 *
 * A program says so about itself, and in one of two ways: the
 * `#!/usr/bin/env node` shebang that makes a file executable, or a call to
 * `isMain(import.meta.url)` guarding the body that makes it a program. The
 * files that say neither — the shared libraries here, the check modules under
 * `scripts/doctor/` — are not programs and are not asked: importing them is the
 * whole of what they do.
 *
 * The failure this exists for is the one that reads as a pass. `isMain` was
 * written because `import.meta.url === pathToFileURL(process.argv[1]).href` is
 * wrong on a checkout reached through a symlink — on macOS `mkdtemp` hands back
 * `/var/folders/...`, which resolves to `/private/var/folders/...` — and when it
 * is wrong the guarded body is skipped: nothing runs, nothing prints, and the
 * exit code is 0, which every caller reads as success. Which is the same
 * signature `scripts/untracked-gate.mjs` treats as "the other gate never ran",
 * and the reason every check in this directory has to prove it can still report
 * bad news.
 *
 * So each program is invoked, in a repository of its own seeded with a copy of
 * the checkout's `scripts/`. The copy is what makes this a test of the
 * invocation rather than of the file: it lives under the system temp directory,
 * so the path it is run through has the symlinked shape `is-main.mjs` exists
 * for, and a guard that compares paths literally is caught here instead of in
 * somebody's clone. And the sandbox is what makes it safe to run a program whose
 * job is to change something — `hooks-install.mjs` points `core.hooksPath` at
 * `.githooks/`, and a doctor that ran the installer against the checkout it was
 * asked about would be changing the thing it is reporting on. It writes that
 * config in a checkout that is discarded, and the hook and the rules the other
 * programs read are copied in beside it so they answer about something real.
 *
 * What is refused is silence. A program may exit non-zero — `flaky-report.mjs`
 * prints its usage and exits 2, and a gate that found a problem is supposed to
 * fail — but every one of them says something first, and a run that answers
 * with nothing answers exactly the way a run that never happened does. That is
 * the one judgment made here, and it is made against the output rather than the
 * exit code, because the exit code is the half a skipped entry point gets right.
 *
 * One program cannot be asked the question it normally answers: a full
 * `doctor.mjs` run contains this check, so it would put the same question to the
 * next doctor for ever. It is run with `--fast`, the report it runs at commit
 * time, which is the doctor that prints.
 *
 * This is the slowest check here by a distance — the two gates are most of it,
 * and each of those spends seconds building its own fixture checkouts before it
 * says anything — which is the other reason it is not one of the commit-time
 * checks: it is the kind of question CI should wait for and a commit should not.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { commit, discard, fixtureEnv, newRepo, track, write } from '../fixture.mjs';

/** A program says so with the shebang that makes it one, or by guarding its entry point. */
const SHEBANG = /^#!.*\bnode\b/m;

/**
 * The guard is a statement that opens a line (an `if` around it, or the call
 * itself), which is what keeps it apart from the places it is otherwise written
 * down: in prose, in the docstrings of `is-main.mjs` and of every program that
 * uses it; and inside the fixture below, which holds a whole program in a
 * string. A rule that read any mention as a declaration found that copy and
 * reported this file as a program the first time it was run — which it is not,
 * and which is the mirror image of the failure this check exists for.
 */
const GUARD = /^\s*(?:if\s*\(\s*)?isMain\(import\.meta\.url\)/m;

/** A file's lines with the whole-line comments dropped, for the same reason. */
function code(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

/** The argument a program needs before it can be asked anything at all. */
const ARGUMENTS = new Map([['scripts/doctor.mjs', ['--fast']]]);

/** How long a program gets before this check calls it hung rather than quiet. */
const LIMIT = 60_000;

/** Every file under `scripts/` that is meant to be executed, as paths against the root. */
function programs(root) {
  const dir = join(root, 'scripts');
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile() || !/\.(mjs|js)$/.test(entry.name)) continue;
      // Read as text because this is the one question a file answers about
      // itself that cannot be answered by running it: running it is what the
      // rest of this check does.
      const text = readFileSync(path, 'utf8');
      if (SHEBANG.test(text) || GUARD.test(code(text))) found.push(relative(root, path));
    }
  };
  walk(dir);
  return found;
}

/** A tree copied as it is, modes included: a hook's executable bit travels with it. */
function copy(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) copy(src, dest);
    else if (entry.isFile()) {
      copyFileSync(src, dest);
      chmodSync(dest, statSync(src).mode & 0o777);
    }
  }
}

/**
 * A repository of its own with the programs in it. The scripts go in as a tree,
 * because they import one another by relative path — a program copied alone
 * would fail on its first import and prove nothing about its entry point.
 */
function sandbox(root) {
  const dir = newRepo();
  copy(join(root, 'scripts'), join(dir, 'scripts'));
  if (existsSync(join(root, '.githooks'))) copy(join(root, '.githooks'), join(dir, '.githooks'));
  if (existsSync(join(root, '.gitignore'))) write(dir, '.gitignore', readFileSync(join(root, '.gitignore'), 'utf8'));
  const seeded = ['scripts', '.githooks', '.gitignore'].filter((path) => existsSync(join(dir, path)));
  track(dir, ...seeded);
  commit(dir, 'sandbox');
  return dir;
}

/**
 * Runs one program in a checkout of its own. `said` is null when it could not be
 * started at all, which is a different finding from a program that started and
 * printed nothing — and both are findings, since neither says the entry point
 * was reached.
 */
function invoke(root, file) {
  const dir = sandbox(root);
  try {
    const result = spawnSync(process.execPath, [join(dir, file), ...(ARGUMENTS.get(file) ?? [])], {
      cwd: dir,
      encoding: 'utf8',
      timeout: LIMIT,
      // The environment has to be the fixture one: a doctor started by a commit
      // has GIT_DIR and friends exported into it by git, and every one of those
      // names the checkout being doctored — inherited, this program would read
      // and write the real repository instead of the sandbox it was given.
      env: fixtureEnv(),
    });
    if (result.error) return { said: null, detail: result.error.code ?? result.error.message };
    return { said: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(), status: result.status };
  } finally {
    discard(dir);
  }
}

export default {
  name: 'entrypoints',
  order: 65,
  proof: [
    {
      level: 'pass',
      why: 'a program whose entry point is reached and prints, which is what every program here should do',
      setup: (root) => write(root, 'scripts/loud.mjs', "#!/usr/bin/env node\nconsole.log('the entry point ran');\n"),
    },
    {
      level: 'fail',
      why: 'a guarded program whose entry point is skipped — it exits 0 saying nothing, which is what a symlinked invocation used to produce',
      setup: (root) => {
        write(root, 'scripts/is-main.mjs', 'export const isMain = () => true;\n');
        write(
          root,
          'scripts/quiet.mjs',
          "#!/usr/bin/env node\nimport { isMain } from './is-main.mjs';\n\nif (isMain(import.meta.url)) {\n  // the entry point this guard is supposed to reach\n}\n",
        );
      },
    },
    {
      level: 'fail',
      why: 'a program that fails without saying anything, which no exit code makes visible either',
      setup: (root) => write(root, 'scripts/mute.mjs', '#!/usr/bin/env node\nprocess.exit(2);\n'),
    },
    {
      level: 'warn',
      why: 'a checkout with no program under scripts/ at all, where there is nothing to invoke',
      setup: () => {},
    },
  ],
  run(root) {
    const found = programs(root);
    if (found.length === 0) {
      return {
        level: 'warn',
        detail: 'nothing under scripts/ says it is a program — nothing was invoked',
        hint: 'a program is a file with a node shebang or an `isMain(import.meta.url)` guard',
      };
    }

    const quiet = [];
    for (const file of found) {
      const { said, detail, status } = invoke(root, file);
      if (said !== null && said !== '') continue;
      quiet.push(said === null ? `${file}  (${detail})` : `${file}  (exit ${status}, nothing printed)`);
    }

    if (quiet.length > 0) {
      return {
        level: 'fail',
        detail: `${quiet.length} of ${found.length} programs under scripts/ answered with nothing when invoked`,
        hint: [
          ...quiet,
          'a program that says nothing is indistinguishable from a program that never ran: a caller reads the exit code and calls it a pass',
        ],
      };
    }
    return { detail: `${found.length} programs under scripts/ each printed something when invoked` };
  },
};

/**
 * Whether the numbers quoted in `linkedin/` still agree with the repo.
 *
 * `linkedin/stats.mjs` is the one thing that knows how to reconcile them —
 * commits, declared keyboards, enumerated states, the test count through
 * `playwright --list` — so it is run rather than reimplemented, and its two very
 * different failures are told apart by their output: "N numbers disagree" is the
 * copy drifting from the repo, while anything else is the check unable to read
 * the repo at all, which must not be reported as disagreement with something it
 * never managed to read.
 *
 * Read last, and read EVERYWHERE. The era the assets quote is a range between
 * two declared commits rather than a count to `HEAD`, so a number can be right on
 * the commit that carries it and still right on the commit after — which is what
 * makes this checkable on CI, where the reader is always a later commit, instead
 * of a false alarm about the reader. Its one precondition is history: the era is
 * a git range, so a checkout that cannot see it is told that rather than told the
 * copy drifted, and the CI job fetches the full history for this check.
 *
 * The era's guards are proved here rather than left to the report, and proved
 * twice, because they answer two different questions.
 *
 *   - The scenarios below point the real script at fixture repositories, so a
 *     refused era is shown to reach this check as a FAILURE rather than as
 *     drift. That is the level this check claims, and a stub that prints "not in
 *     this checkout" proves no more than that it can be printed.
 *   - `proveItCanCountTheEra` asks the guards themselves, one fixture per answer
 *     they exist to refuse. A level cannot say which guard refused: the guards
 *     run in order, so a reversed range that gets past its own guard is caught
 *     by the count guard, and an era missing from the checkout is caught by the
 *     ancestor guard the moment the presence guard is gone — the same refusal on
 *     the same state, for a reason nothing checked. Each fixture there names the
 *     reason it is asking for, and any other answer fails it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eraLength } from '../../../linkedin/stats.mjs';
import { commit, discard, git, makeDir, newRepo, track, write } from '../fixture.mjs';

const WRITER = 'linkedin/stats.mjs';

/** The real script, because the guard is the thing under proof, not a copy of it. */
const STATS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'linkedin', 'stats.mjs');

/**
 * A writer that asks the real guard about the repository it was planted in. The
 * state arrives in `era.json` rather than in this source, so every fixture runs
 * one program and only the repository beneath it changes — and the count it
 * expects is in there too, since a range that counts the wrong number is the
 * other way this answer looks the same when it is wrong.
 */
const ERA = `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eraLength } from ${JSON.stringify(STATS)};

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'era.json'), 'utf8'));
try {
  const count = eraLength(fixture.repo, { first: fixture.first, last: fixture.last });
  if (count !== fixture.commits) {
    console.error(\`the era counted \${count} commits, and this fixture put \${fixture.commits} in it\`);
    process.exit(1);
  }
  console.log(\`the era counted \${fixture.commits} commits\`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
`;

/** The writer this check runs, over the state a fixture built. */
function plant(root, state) {
  write(root, 'era.json', `${JSON.stringify(state, null, 2)}\n`);
  write(root, WRITER, ERA);
}

/**
 * Commit three times and declare the era over the last three, returning its two
 * ends. `newRepo()` has already committed the fixture commit, and that is what
 * makes `first^..last` a range git resolves at all: an era whose first end is a
 * root commit is a git error rather than one of the answers the guards give.
 */
function eraRange(root) {
  for (const name of ['one', 'two', 'three']) {
    write(root, `${name}.md`, '# fixture\n');
    track(root, `${name}.md`);
    commit(root, name);
  }
  return {
    first: git(['rev-parse', 'HEAD~2'], { cwd: root }),
    last: git(['rev-parse', 'HEAD'], { cwd: root }),
  };
}

/**
 * The states the guards exist to refuse, and the one that has to count. Each
 * builds itself into the repository it is handed, and each is the state a
 * scenario plants and the state the prover below asks about — one construction,
 * asked two ways, so the fixture the report shows and the fixture the guards are
 * held to cannot drift apart.
 */
const STATES = {
  /** A range this repository holds and this branch carries. */
  counts: (root) => {
    const { first, last } = eraRange(root);
    return { repo: root, first, last, commits: 3 };
  },
  /** The same two commits, asked for in the other order. */
  reversed: (root) => {
    const { first, last } = eraRange(root);
    return { repo: root, first: last, last: first, commits: 3 };
  },
  /** Both ends present, and HEAD on a branch that diverged before the era ended. */
  branch: (root) => {
    const { first, last } = eraRange(root);
    git(['branch', 'elsewhere', 'HEAD~1'], { cwd: root });
    git(['checkout', '-q', 'elsewhere'], { cwd: root });
    return { repo: root, first, last, commits: 3 };
  },
  /** A clone carrying one commit of a two-commit source: the era is not in it. */
  shallow: (root) => {
    const source = makeDir(root, 'source');
    git(['init', '-q'], { cwd: source });
    for (const name of ['first', 'second']) {
      write(source, `${name}.md`, '# fixture\n');
      track(source, `${name}.md`);
      commit(source, name);
    }
    const first = git(['rev-parse', 'HEAD~1'], { cwd: source });
    const last = git(['rev-parse', 'HEAD'], { cwd: source });
    const copy = join(root, 'shallow');
    // Cloning a plain path copies the objects and ignores `--depth`, so the
    // `file://` URL is what makes this a shallow clone rather than a remark
    // about one.
    git(['clone', '-q', '--depth', '1', pathToFileURL(source).href, copy], { cwd: root });
    if (git(['rev-parse', '--is-shallow-repository'], { cwd: copy }) !== 'true') {
      throw new Error('the fixture clone came back deep, so it is not the shallow checkout it claims to be');
    }
    return { repo: copy, first, last, commits: 2 };
  },
};

/**
 * The reasons the guards give, as the fragments that tell them apart. A fragment
 * and not the whole message because the message carries the fixture's own commit
 * names, which are different in every repository one of these is built in.
 */
const REASONS = [
  ['an era declared backwards', 'reversed', 'is not an ancestor of ERA_LAST'],
  ['an era that did not land on this branch', 'branch', "is not in this branch's history"],
  ['a shallow clone missing the era', 'shallow', 'is not in this checkout'],
];

/**
 * The guards, asked directly, one fixture per answer they exist to refuse.
 *
 * Proved once per process and then remembered: this is code in a module that
 * cannot change while the process runs, and every run that reads the report asks
 * for it — the real one, and each of the scenarios below, which is nine times on
 * a run that builds its fixtures. A refusal is not remembered: a proof that
 * failed fails again for the next caller.
 */
let proved = false;
function proveItCanCountTheEra() {
  if (proved) return;
  const built = [];
  const fresh = () => {
    const root = newRepo();
    built.push(root);
    return root;
  };
  try {
    const counts = STATES.counts(fresh());
    const counted = eraLength(counts.repo, { first: counts.first, last: counts.last });
    if (counted !== counts.commits) {
      throw new Error(
        `the era counted ${counted} commits and the fixture put ${counts.commits} in it — without this, a guard that refused everything would pass every case below`,
      );
    }

    for (const [what, state, reason] of REASONS) {
      const ends = STATES[state](fresh());
      let said;
      try {
        said = `it counted ${eraLength(ends.repo, { first: ends.first, last: ends.last })} commits`;
      } catch (error) {
        said = error.message;
      }
      if (!said.includes(reason)) {
        throw new Error(`${what} was answered with "${said}", where this fixture asks for the refusal "${reason}"`);
      }
    }
    proved = true;
  } finally {
    for (const root of built) discard(root);
  }
}

export default {
  name: 'linkedin',
  order: 80,
  proof: [
    {
      level: 'pass',
      why: 'the writer exits clean, which is it saying every quoted number agrees',
      setup: (root) => write(root, WRITER, 'process.exit(0);\n'),
    },
    {
      level: 'fail',
      why: 'the writer reports disagreements, which is the assets drifting from the repo',
      setup: (root) => write(root, WRITER, "console.error('linkedin assets disagree with the repo (3):');\nprocess.exit(1);\n"),
    },
    {
      level: 'fail',
      why: 'the writer could not read the repo at all — a failure, not drift, since it never saw the copy',
      setup: (root) => write(root, WRITER, "console.error(\"Cannot find module '@playwright/test'\");\nprocess.exit(1);\n"),
    },
    {
      level: 'skip',
      why: 'there are no linkedin assets in this checkout',
      setup: () => {},
    },
    {
      level: 'fail',
      why: 'the era is not in this checkout to be counted — a reader that cannot see the history, not copy that drifted',
      setup: (root) =>
        write(
          root,
          WRITER,
          "console.error('ERA_LAST (5aaffda) is not in this checkout, so the era cannot be counted');\nprocess.exit(1);\n",
        ),
    },
    {
      level: 'pass',
      repo: true,
      why: 'the era is a range this repository holds and this branch carries, so it counts — the control that says the guards refuse those states and not a range as such',
      setup: (root) => plant(root, STATES.counts(root)),
    },
    {
      level: 'fail',
      repo: true,
      why: 'the era is declared backwards: its first end is a descendant of its last, and the refusal reaches this check as a failure',
      setup: (root) => plant(root, STATES.reversed(root)),
    },
    {
      level: 'fail',
      repo: true,
      why: 'the era did not land on this branch — both ends are in the repository, and HEAD is where the era is not',
      setup: (root) => plant(root, STATES.branch(root)),
    },
    {
      level: 'fail',
      repo: true,
      why: 'the checkout is a shallow clone missing the era, where a count would come back short rather than come back refused',
      setup: (root) => plant(root, STATES.shallow(root)),
    },
  ],
  run(root) {
    // The guards are what this check reads the era through, so they are proved
    // before its answer is believed — the way the modes check proves the reader
    // it asks, and for the same reason: a guard that stopped refusing prints
    // exactly what a guard with nothing to refuse prints.
    proveItCanCountTheEra();

    const script = join(root, 'linkedin', 'stats.mjs');
    if (!existsSync(script)) return { level: 'skip', detail: 'no linkedin assets in this checkout' };

    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    if (result.error) throw new Error(`could not run linkedin/stats.mjs: ${result.error.message}`);
    if (result.status === 0) return { detail: 'the numbers quoted in linkedin/ agree with the repo' };

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const count = /linkedin assets disagree with the repo \((\d+)\)/.exec(output);
    if (!count) {
      const first = output.split('\n').find((line) => line.trim() !== '') ?? `exit ${result.status}`;
      return {
        level: 'fail',
        detail: `could not run: ${first.trim()}`,
        hint: 'it reads the repo through git, the declarations and `playwright test --list` — npm ci covers the last one, and the era needs the history behind HEAD',
      };
    }
    return {
      level: 'fail',
      detail: `${count[1]} quoted ${count[1] === '1' ? 'number disagrees' : 'numbers disagree'} with the repo`,
      // `--write` is the fix for a number that drifted; a number that is new has
      // to be derived or declared frozen, which is the whole point of the check.
      hint: ['node linkedin/stats.mjs  — lists each disagreement', 'node linkedin/stats.mjs --write  — rewrites the drifted ones'],
    };
  },
};

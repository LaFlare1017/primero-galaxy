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
 * Read last, and deliberately quiet on CI. The era count is
 * `rev-list --count ERA_FIRST^..HEAD`, so it grows by one with every commit: by
 * construction the commit carrying the refreshed assets is already behind the
 * count its own HEAD reports, and on CI the reader is always a later commit.
 * Every asset would read as drifted however carefully it was written, which is a
 * false alarm about the reader rather than about the copy. It stays the check it
 * was built as on the machine where `--write` is one command away.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { write } from '../fixture.mjs';

const WRITER = 'linkedin/stats.mjs';

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
      level: 'skip',
      why: 'on CI the era count is one behind the commit that carries it, by construction',
      context: { ci: true },
      setup: (root) => write(root, WRITER, 'process.exit(0);\n'),
    },
  ],
  run(root, { ci = false } = {}) {
    const script = join(root, 'linkedin', 'stats.mjs');
    if (!existsSync(script)) return { level: 'skip', detail: 'no linkedin assets in this checkout' };

    if (ci) {
      return {
        level: 'skip',
        detail: 'not read on CI — the era count counts HEAD, so the commit carrying the assets is one behind it by construction; run it where `--write` is to hand',
      };
    }

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
        hint: 'it reads the repo through git, the declarations and `playwright test --list` — npm ci covers the last one',
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

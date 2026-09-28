/**
 * Whether the dependencies are installed.
 *
 * The failure this exists for is the one that does not look like itself: a
 * checkout with a half-finished install, or none at all, goes on to fail in
 * whatever it runs next — a lint run, a build, the LinkedIn check's
 * `playwright --list` — and each of those failures is reported as its own thing.
 * Asked here, the answer is one line and names the command.
 *
 * A missing install is a FAILURE rather than a warning because it cannot be a
 * choice: nothing in this repo works without it, and a doctor that left its exit
 * code clean here would be certifying a checkout that cannot run its own checks.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeDir } from '../fixture.mjs';

export default {
  name: 'deps',
  order: 20,
  proof: [
    {
      level: 'pass',
      why: 'node_modules is installed and holds the dependency the app is built on',
      setup: (root) => makeDir(root, 'node_modules/next'),
    },
    {
      level: 'fail',
      why: 'nothing is installed, so every check below this one is about to fail for a reason of its own',
      setup: () => {},
    },
    {
      level: 'fail',
      why: 'node_modules exists and the app is not in it — the half-finished install',
      setup: (root) => makeDir(root, 'node_modules'),
    },
  ],
  run(root) {
    const modules = join(root, 'node_modules');
    if (!existsSync(modules)) {
      return { level: 'fail', detail: 'node_modules is missing', hint: 'npm ci' };
    }
    // A half-finished install is the failure that looks most like a real bug.
    if (!existsSync(join(modules, 'next'))) {
      return { level: 'fail', detail: 'node_modules exists but `next` is not installed', hint: 'npm ci' };
    }
    return { detail: 'node_modules installed' };
  },
};

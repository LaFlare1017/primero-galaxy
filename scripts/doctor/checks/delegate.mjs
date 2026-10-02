/**
 * The nested `delegate/` workspace: installed, built, and newer than its
 * sources.
 *
 * The web app imports the TypeScript under `delegate/src` directly, so an
 * unbuilt or even uninstalled workspace does not break `next dev` — it breaks
 * the workspace's OWN scripts, which is worth knowing and not worth failing
 * over. Hence warnings, and a `dist` compared by mtime against the sources it
 * was built from, since a build that silently predates the code in it is the
 * kind of staleness that reads as a real bug somewhere else.
 *
 * CI is a different checkout for this question: it installs the root
 * dependencies and builds the app, and never installs or builds this workspace,
 * so the states below are not choices anybody there made. The check stands down
 * there rather than warning about a build CI has no reason to want.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { age, makeDir, write } from '../fixture.mjs';
import { mtimes, show } from '../lib.mjs';

/** The workspace every scenario but the absent one is about. */
const WORKSPACE = (root) => write(root, 'delegate/package.json', '{ "name": "delegate" }\n');

export default {
  name: 'delegate',
  order: 70,
  proof: [
    {
      level: 'pass',
      why: 'dist is newer than every source it was built from',
      setup: (root) => {
        WORKSPACE(root);
        makeDir(root, 'delegate/node_modules');
        // Aged rather than merely written first: two writes in the same
        // millisecond would make this a race instead of a proof.
        age(write(root, 'delegate/src/index.ts', 'export const x = 1;\n'), 60 * 60 * 1000);
        write(root, 'delegate/dist/index.js', 'built\n');
      },
    },
    {
      level: 'warn',
      why: 'the workspace is installed and nothing was ever built from it',
      setup: (root) => {
        WORKSPACE(root);
        makeDir(root, 'delegate/node_modules');
      },
    },
    {
      level: 'warn',
      why: 'dist predates the source it was built from',
      setup: (root) => {
        WORKSPACE(root);
        makeDir(root, 'delegate/node_modules');
        age(write(root, 'delegate/dist/index.js', 'built\n'), 60 * 60 * 1000);
        write(root, 'delegate/src/index.ts', 'export const x = 1;\n');
      },
    },
    {
      level: 'skip',
      why: 'there is no delegate workspace in this checkout',
      setup: () => {},
    },
    {
      level: 'skip',
      why: 'CI does not build this workspace and nothing it runs needs the build',
      context: { ci: true },
      setup: (root) => WORKSPACE(root),
    },
  ],
  run(root, { ci = false } = {}) {
    const workspace = join(root, 'delegate');
    if (!existsSync(join(workspace, 'package.json'))) {
      return { level: 'skip', detail: 'no delegate workspace in this checkout' };
    }
    if (ci && !existsSync(join(workspace, 'dist'))) {
      return {
        level: 'skip',
        detail: 'not built — CI does not build this workspace, and the app reads delegate/src directly',
      };
    }
    if (!existsSync(join(workspace, 'node_modules'))) {
      return {
        level: 'warn',
        detail: 'delegate/node_modules is missing — its build and test scripts cannot run',
        hint: 'npm --prefix delegate install',
      };
    }
    const dist = join(workspace, 'dist');
    if (!existsSync(dist)) {
      return {
        level: 'warn',
        detail: 'not built — the app reads delegate/src directly, but its own scripts need dist/',
        hint: 'npm --prefix delegate run build',
      };
    }

    const sources = mtimes(join(workspace, 'src'), '.ts');
    const outputs = mtimes(dist, '.js');
    if (sources.length === 0 || outputs.length === 0) {
      return { level: 'warn', detail: 'delegate/dist exists but looks empty', hint: 'npm --prefix delegate run build' };
    }
    const built = Math.max(...outputs.map((output) => output.mtime));
    const stale = sources.filter((source) => source.mtime > built);
    if (stale.length > 0) {
      const newest = stale.reduce((latest, source) => (source.mtime > latest.mtime ? source : latest));
      return {
        level: 'warn',
        detail: `delegate/dist predates ${stale.length} ${stale.length === 1 ? 'file' : 'files'} in delegate/src, newest ${show(newest.path, root)}`,
        hint: 'npm --prefix delegate run build',
      };
    }
    return { detail: `built, and newer than all ${sources.length} files in delegate/src` };
  },
};

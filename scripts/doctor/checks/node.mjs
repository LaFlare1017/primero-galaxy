/**
 * The Node running these checks, against the Node the workflows ask for.
 *
 * Read first, with `deps` and `env`, because everything below them is answered
 * through a toolchain this check is the first word about — a failure in a check
 * further down means less if the runtime is not the one the project is built on.
 *
 * CI is the single place this repo states its Node version: there is no
 * `.nvmrc` and no `engines` field, so the workflows are the expectation rather
 * than a second copy of one. A mismatch is a warning and not a failure — the
 * suite passes on both, and the difference is worth knowing rather than obeying.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { write } from '../fixture.mjs';

/**
 * The Node major every workflow asks for, read out of the workflow files rather
 * than repeated here: a copy of the answer is a thing that can disagree with it.
 */
function ciNodeVersions(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  const declared = new Set();
  for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      const match = /^\s*node-version:\s*['"]?([^'"#\s]+)/.exec(line);
      if (match) declared.add(match[1]);
    }
  }
  return [...declared].sort();
}

export default {
  name: 'node',
  order: 10,
  proof: [
    {
      level: 'pass',
      why: 'the workflow asks for the major this process is running',
      setup: (root) => write(root, '.github/workflows/ci.yml', `node-version: ${process.versions.node.split('.')[0]}\n`),
    },
    {
      level: 'warn',
      why: 'the workflow asks for a major nobody here is running',
      setup: (root) => write(root, '.github/workflows/ci.yml', 'node-version: 99\n'),
    },
    {
      level: 'warn',
      why: 'nothing declares a version to compare against, so there is no answer to give',
      setup: () => {},
    },
  ],
  run(root) {
    const local = process.versions.node;
    const declared = ciNodeVersions(root);
    if (declared.length === 0) {
      return { level: 'warn', detail: `v${local} — no workflow declares a Node version to compare against` };
    }
    if (declared.length > 1) {
      return { level: 'warn', detail: `v${local} — the workflows disagree about Node (${declared.join(', ')})` };
    }
    const [wanted] = declared;
    const major = local.split('.')[0];
    if (!/^\d+$/.test(wanted)) {
      return { detail: `v${local} — CI asks for "${wanted}"` };
    }
    if (wanted === major) return { detail: `v${local} — the major CI declares` };
    // Not a failure: the suite passes on both, and the difference is worth
    // knowing rather than obeying.
    return {
      level: 'warn',
      detail: `v${local} — CI declares Node ${wanted}`,
      hint: 'only a problem if something fails here that passes on CI',
    };
  },
};

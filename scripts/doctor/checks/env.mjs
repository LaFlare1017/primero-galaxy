/**
 * Whether `.env.local` is there — the one file a developer is expected to create
 * by hand, and the one this check never reads.
 *
 * It holds a value (`NEXT_PUBLIC_SITE_URL`, which becomes the `metadataBase`
 * every Open Graph and canonical URL resolves against), and a doctor has no
 * reason to open it: the question is whether the file exists, not what is in it.
 * Absent, the app still runs — metadataBase falls back to
 * `http://localhost:3000` — so this is a warning on a machine, with the `cp`
 * that fixes it.
 *
 * On CI the absence is not a state at all: the file is gitignored on purpose,
 * the workflow injects the same value from a repository secret, and a fresh
 * checkout has none by construction. The check says so and stands down rather
 * than warning about a choice nobody there made — which is also what lets CI run
 * the whole doctor under `--strict`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { write } from '../fixture.mjs';
import { show } from '../lib.mjs';

export default {
  name: 'env',
  order: 30,
  proof: [
    {
      level: 'pass',
      why: 'the template is tracked and the local file was made from it',
      setup: (root) => {
        write(root, '.env.local.example', 'NEXT_PUBLIC_SITE_URL=\n');
        write(root, '.env.local', 'NEXT_PUBLIC_SITE_URL=https://example.invalid\n');
      },
    },
    {
      level: 'warn',
      why: 'the template is there and nothing was made from it',
      setup: (root) => write(root, '.env.local.example', 'NEXT_PUBLIC_SITE_URL=\n'),
    },
    {
      level: 'fail',
      why: 'the tracked template is missing, so this is not a checkout of this repo',
      setup: () => {},
    },
    {
      level: 'skip',
      why: 'on CI there is no .env.local and no reason for one',
      context: { ci: true },
      setup: (root) => write(root, '.env.local.example', 'NEXT_PUBLIC_SITE_URL=\n'),
    },
  ],
  run(root, { ci = false } = {}) {
    const template = join(root, '.env.local.example');
    if (!existsSync(template)) {
      return { level: 'fail', detail: `${show(template, root)} is missing — it is tracked, so this is a broken checkout` };
    }
    // Never read: it holds a value, and a doctor has no reason to open it.
    if (!existsSync(join(root, '.env.local'))) {
      if (ci) {
        return {
          level: 'skip',
          detail: 'no .env.local — CI has none by design, and metadataBase falls back to http://localhost:3000',
        };
      }
      return {
        level: 'warn',
        detail: 'no .env.local — metadataBase falls back to http://localhost:3000',
        hint: `cp ${show(template, root)} .env.local`,
      };
    }
    return { detail: '.env.local present' };
  },
};

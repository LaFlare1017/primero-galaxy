/**
 * The other half of the gitignore contradiction: a generated or vendored path
 * that no rule covers, which every `git status` lists again and only somebody
 * remembering not to type `git add -A` keeps out of a commit.
 *
 * The audit — and the fixture that proves it can still see — belongs to
 * `scripts/untracked-gate.mjs`, which is imported rather than re-derived, the
 * same way the gate it mirrors is. Its judgment is already the one this report
 * wants: a path that is provably generated or vendored and uncovered is a
 * failure, and anything else untracked is a decision in progress and no more
 * than a warning.
 *
 * Only the reading is proved here. The gate can also write the lines it prints
 * (`--fix`), and that half carries its own fixture at home, run by the gate
 * itself: this check diagnoses, and a doctor that repaired would be the doctor
 * its own docstring refuses to be.
 *
 * Read with `gitignore` above it because the two are one question asked from
 * opposite sides, and NOT one of the commit-time checks even though it is just
 * as quick. Its subject is the paths the commit does *not* contain: it is red
 * today on artifacts nobody has ruled on yet, and a hook that refused every
 * commit until that was settled would be switched off within a day — which is
 * the failure the gate exists to prevent.
 */
import { audit, proveItCanSee } from '../../untracked-gate.mjs';
import { write } from '../fixture.mjs';

export default {
  name: 'untracked',
  order: 50,
  proof: [
    {
      level: 'pass',
      repo: true,
      why: 'a committed checkout with nothing untracked in it',
      setup: () => {},
    },
    {
      level: 'warn',
      repo: true,
      why: 'a new source file nobody has decided about',
      setup: (root) => write(root, 'new-feature.ts', 'export const x = 1;\n'),
    },
    {
      level: 'fail',
      repo: true,
      why: 'a build directory with no rule reaching this second location',
      setup: (root) => write(root, 'dist/bundle.js', 'built\n'),
    },
  ],
  run(root) {
    // Prove the checker still catches the thing it checks before believing it
    // when it says there is nothing to catch.
    proveItCanSee();
    const { hits, groups, unaccounted } = audit(root);
    if (hits.length > 0) {
      return {
        level: 'fail',
        detail: `${hits.length} untracked ${hits.length === 1 ? 'path is' : 'paths are'} generated or vendored, and no rule covers ${hits.length === 1 ? 'it' : 'them'}`,
        hint: [
          groups.map((group) => group.rule).join('  '),
          'node scripts/untracked-gate.mjs  — prints the exact .gitignore lines for them',
          'node scripts/untracked-gate.mjs --fix  — writes them, having shown the diff first',
        ],
      };
    }
    if (unaccounted.length > 0) {
      return {
        level: 'warn',
        detail: `${unaccounted.length} untracked ${unaccounted.length === 1 ? 'path is' : 'paths are'} neither ignored nor tracked — a decision in progress, not a problem`,
        hint: 'git status will keep listing them, and `git add -A` would sweep them in',
      };
    }
    return { detail: 'nothing untracked is waiting for a decision' };
  },
};

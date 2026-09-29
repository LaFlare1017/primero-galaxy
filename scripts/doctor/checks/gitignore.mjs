/**
 * No tracked file may be covered by a `.gitignore` rule.
 *
 * A tracked path that a rule also matches is invisible in both places you would
 * look for it: `git status` stays quiet because the file is committed, and the
 * rule reads as though the path were never meant to be here. Whichever half is
 * wrong, nothing says so — the file keeps shipping while the rule keeps claiming
 * it should not.
 *
 * The scan itself — and the fixture that proves it can still catch what it
 * looks for — belongs to `scripts/gitignore-gate.mjs`, which is imported rather
 * than re-derived: a second opinion about this invariant is a second thing to
 * keep in sync. What this file adds is the report, and
 * `commit: true`.
 *
 * It is one of the two checks the commit-time hook runs, because its subject is
 * the commit being made rather than this machine, and because a rule that
 * contradicts a tracked path is cheapest to fix at the moment it is written.
 */
import { proveItCanFail, scan } from '../../gitignore-gate.mjs';
import { track, write } from '../fixture.mjs';

export default {
  name: 'gitignore',
  order: 40,
  commit: true,
  proof: [
    {
      level: 'pass',
      repo: true,
      why: 'every tracked path is in the repo on purpose, and the fixture rule covers none of them',
      setup: () => {},
    },
    {
      level: 'fail',
      repo: true,
      why: 'a rule committed after the file it covers — the order this actually happens in',
      setup: (root) => {
        write(root, 'planted.txt', 'planted\n');
        track(root, 'planted.txt');
        write(root, '.gitignore', '# fixture\nplanted.txt\n');
        track(root, '.gitignore');
      },
    },
  ],
  run(root) {
    // Prove the checker still catches the thing it checks before believing it
    // when it says there is nothing to catch.
    proveItCanFail();
    const { tracked, hits } = scan(root);
    if (hits.length > 0) {
      return {
        level: 'fail',
        detail: `${hits.length} tracked ${hits.length === 1 ? 'path is' : 'paths are'} covered by a committed .gitignore rule`,
        hint: [
          ...hits.map((hit) => `${hit.path}  (${hit.source}:${hit.line}  "${hit.pattern}")`),
          '`node scripts/gitignore-gate.mjs --fix` writes the negation this needs, showing the diff first.',
          '`node scripts/gitignore-gate.mjs --fix --dry-run` shows the same plan and diff and writes nothing.',
        ],
      };
    }
    return { detail: `${tracked} tracked files, none covered by a committed rule (fixture passes)` };
  },
};

/**
 * The executable bit git records, allowed only where something runs the file by
 * path — the hooks git runs, and the two scripts this repo executes that way.
 *
 * The `hooks` check beside this one reads that same bit from the other end: git
 * *ignores* a hook without it, prints a hint and carries the commit on, so a hook
 * can be executable where it was written and dead in every clone. This is the
 * mirror of that question. A bit recorded on a file nothing executes buys nothing
 * and costs something — it is a difference the next reader has to explain, and
 * the one this repo actually produced was two scripts under `scripts/` that
 * arrived at 100755 in the commit that made the checks one doctor while the
 * twenty-odd files beside them were 100644.
 *
 * Two things are allowed, and they are allowed for one reason: the file is run
 * by path, so the kernel's bit decides whether the invocation works at all.
 *
 *   - the hooks git runs, discovered through `shadowed` — imported from the
 *     installer that already answers which files those are, rather than answered
 *     a second time here. So an executable file in `.githooks/` whose name git
 *     does not accept as a hook is refused with everything else: being a hook is
 *     what earns the bit, not the directory.
 *   - the paths in `EXECUTED` below, which are listed rather than discovered
 *     because nothing here discovers an invocation. The handoff documents run
 *     `./scripts/reset.sh <db>`, and a shell script invoked by path needs the bit
 *     for that to work — which is a decision somebody made, so it is written
 *     down where it can be read and removed. The list is an allowance and not a
 *     requirement: a name the bit has been dropped from is a permission nothing
 *     is using, and the files it names are the ones a reader would have to
 *     explain either way.
 *
 * Reading those two records is `scripts/recorded-modes.mjs`, imported rather
 * than parsed here: `hookProblems` — which the hooks check beside this one, the
 * hook check and the installer all go through — asks the same two commands about
 * one hook, and a second parse of `ls-files -s` against `ls-tree` is a second
 * place to have learned the difference from.
 *
 * Both records are asked, and they are two different findings. The index is what
 * the next commit would carry, so a bit there is refused. HEAD is what a clone
 * checks out, and a bit that is in HEAD and not in the index is a repair somebody
 * has already staged — the same "decision in progress" the untracked gate warns
 * about rather than failing on, since denying it would mean refusing a run for
 * the state the fix is in on its way in. `atCommit` drops HEAD, where it is the
 * commit before this one: the way to fix a mode HEAD recorded wrong is the commit
 * being made, and asking it would refuse the very commit that repairs it.
 *
 * That is also why it is one of the commit-time checks: a mode is written when
 * somebody types `chmod +x` and commits, and asking costs two git calls and a
 * directory read — plus the shared reader's fixture, which the hooks check asks
 * for as well and which proves itself once however many checks come asking.
 */
import { join, relative } from 'node:path';
import { HOOKS_PATH, shadowed } from '../../hooks-install.mjs';
import { executable, listing, proveItCanReadModes } from '../../recorded-modes.mjs';
import { commit, track, writeExecutable } from '../fixture.mjs';
import { git } from '../lib.mjs';

/**
 * The tracked paths this repo runs by path, where the bit is doing something.
 * Named one by one so a new file under the same directory does not inherit the
 * permission, and so the doctor can tell a reader why each one is here.
 */
const EXECUTED = ['delegate/scripts/reset.sh', 'delegate/scripts/snapshot.sh'];

/** The paths an executable bit is allowed on: the hooks, and the by-path scripts. */
function allowed(root) {
  return new Set([...shadowed(join(root, HOOKS_PATH)).map((path) => relative(root, path)), ...EXECUTED]);
}

/** The paths of one record that carry the bit and are on neither list. */
function stray(entries, permitted) {
  return entries.filter(({ mode, path }) => executable(mode) && !permitted.has(path)).map(({ path }) => path);
}

/**
 * A tracked file marked executable — on disk, and in the index whatever the
 * filesystem records, so the fixtures do not depend on `core.fileMode`. The mode
 * being asked about is the one git records, and a machine that records none would
 * otherwise have nothing to plant.
 */
function mark(root, path, contents) {
  writeExecutable(root, path, contents);
  track(root, path);
  git(['update-index', '--chmod=+x', path], { cwd: root });
}

/** The one file in this repo that has to be executable, for a fixture to plant. */
const HOOK = `${HOOKS_PATH}/pre-commit`;

/** The repair, named the way the failing record is. */
const drop = (path) => `git update-index --chmod=-x ${path}`;

export default {
  name: 'modes',
  order: 62,
  commit: true,
  proof: [
    {
      level: 'pass',
      repo: true,
      why: 'a repository where nothing is executable, which is every file here but the hook',
      setup: () => {},
    },
    {
      level: 'pass',
      repo: true,
      why: 'the tracked hook carries the bit, since a hook git skips is a gate that stopped running',
      setup: (root) => {
        mark(root, HOOK, '#!/bin/sh\nexit 0\n');
        commit(root, 'the hook');
      },
    },
    {
      level: 'fail',
      repo: true,
      why: 'a script marked executable that git never runs as a hook',
      setup: (root) => mark(root, 'build.sh', '#!/bin/sh\nexit 0\n'),
    },
    {
      level: 'fail',
      repo: true,
      why: 'an executable file inside .githooks/ that is not a hook — the directory is not what earns the bit',
      setup: (root) => mark(root, `${HOOKS_PATH}/README.md`, 'not a hook\n'),
    },
    {
      level: 'warn',
      repo: true,
      why: 'HEAD records the bit and the index has dropped it, so the repair is staged and a clone gets it until this lands',
      setup: (root) => {
        mark(root, 'deploy.sh', '#!/bin/sh\nexit 0\n');
        commit(root, 'the bit');
        git(['update-index', '--chmod=-x', 'deploy.sh'], { cwd: root });
      },
    },
    {
      level: 'pass',
      repo: true,
      why: 'at commit time only the index is asked, and this index has already dropped the bit — the commit repairing it must not be the one refused',
      context: { atCommit: true },
      setup: (root) => {
        mark(root, 'deploy.sh', '#!/bin/sh\nexit 0\n');
        commit(root, 'the bit');
        git(['update-index', '--chmod=-x', 'deploy.sh'], { cwd: root });
      },
    },
  ],
  run(root, { atCommit = false } = {}) {
    // Prove the reader still reads a mode before believing what it says about
    // these ones — a reader that answered `100644` about everything would find
    // nothing wrong anywhere in this repo.
    proveItCanReadModes();
    const tracked = listing(root, 'index');
    const recorded = tracked.filter(({ mode }) => executable(mode)).map(({ path }) => path).sort();
    const permitted = allowed(root);
    const carried = stray(tracked, permitted);

    if (carried.length > 0) {
      return {
        level: 'fail',
        detail: `${carried.length} tracked ${carried.length === 1 ? 'file is' : 'files are'} recorded as executable and nothing here runs ${carried.length === 1 ? 'it' : 'them'} by path`,
        hint: [
          ...carried.map((path) => `${path}  (recorded in the index)`),
          ...carried.map((path) => drop(path)),
          'or, if something in this repo runs the file by path, name it in EXECUTED in scripts/doctor/checks/modes.mjs',
          'the hooks and the scripts run by path are the only files this bit buys anything for',
        ],
      };
    }

    const inherited = atCommit ? [] : stray(listing(root, 'HEAD'), permitted);
    if (inherited.length > 0) {
      return {
        level: 'warn',
        detail: `${inherited.length} tracked ${inherited.length === 1 ? 'file is' : 'files are'} recorded as executable in HEAD and not in the index — a clone checks that bit out until the repair lands`,
        hint: [
          ...inherited.map((path) => `${path}  (recorded in HEAD)`),
          ...inherited.map((path) => drop(path)),
          'then commit the mode change: what a clone gets is the mode HEAD records',
        ],
      };
    }

    return {
      detail: recorded.length === 0
        ? `${tracked.length} tracked files, none recorded as executable`
        : `${tracked.length} tracked files, and the bit only on ${recorded.join(', ')}`,
    };
  },
};

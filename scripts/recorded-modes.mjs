/**
 * Git's two records of a file's mode, read in one place.
 *
 * The executable bit is the one thing about a file that git stores and the
 * filesystem does not: what a clone checks out is a mode in the index and in
 * HEAD, not the bit on the machine that wrote the commit. Two things read that
 * record — the doctor's `modes` check, which asks about every path at once, and
 * `hookProblems` in `scripts/hooks-install.mjs`, which asks about one hook — and
 * `hookProblems` is itself reached by the hooks check, by `scripts/hook-check.mjs`
 * and by the installer. Two readers of one record is one reader too many:
 * `ls-files -s` and `ls-tree` print different words between the mode and the
 * path, and a second parse of that is a second place to have learned it from.
 *
 * So the commands, the parse and the meaning live here. `index` is what the next
 * commit would carry; `HEAD` is what a clone gets.
 *
 *   index   `ls-files -s`   a mode, an object name, a stage, a tab, the path
 *   HEAD    `ls-tree -r`    a mode, a type, an object name, a tab, the path
 *
 * Both are asked with `-z`, and that is not tidiness. Without it git prints a
 * path it cannot write plainly between quotes and backslash-escapes — an
 * accented name, a name holding a quote or a tab — so a reader that split the
 * text would compare the record against a path that is not the one in it, and
 * the one place modes are read would be the one place names come back wrong.
 * NUL-separated output is git saying "print it as it is".
 *
 * An unborn HEAD is not a record that could not be read; it is one that does not
 * exist yet, and it is the only absence treated as an answer. That is asked
 * separately, so that a record which genuinely failed to read is never what
 * "nothing is recorded" comes back as — the kind of answer this repo refuses
 * everywhere else.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The one mode git records for a file it will run. */
const EXECUTABLE = '100755';

/** The two records, and the command that prints one — all of it, or one path. */
const RECORDS = new Map([
  ['index', (paths) => ['ls-files', '-s', '-z', ...(paths.length > 0 ? ['--', ...paths] : [])]],
  ['HEAD', (paths) => ['ls-tree', '-r', '-z', '--full-tree', 'HEAD', ...(paths.length > 0 ? ['--', ...paths] : [])]],
]);

function git(args, { cwd }) {
  const result = spawnSync('git', args, { cwd });
  if (result.error) throw new Error(`could not run \`git ${args.join(' ')}\` in ${cwd}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').toString().trim();
    throw new Error(`\`git ${args.join(' ')}\` exited ${result.status} in ${cwd}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8');
}

/** The command for one record, refused by name when the name is neither. */
function command(source, paths = []) {
  const ask = RECORDS.get(source);
  if (ask === undefined) {
    throw new Error(`there is no ${JSON.stringify(source)} record of a mode here — this reads \`index\` and \`HEAD\``);
  }
  return ask(paths);
}

/**
 * Whether there is a commit to read. Asked before asking HEAD, so that an unborn
 * repository — where there is legitimately no mode recorded for anything — is
 * never what a HEAD that could not be read comes back as.
 */
function hasHead(root) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root });
  if (result.error) throw new Error(`could not run git rev-parse in ${root}: ${result.error.message}`);
  return result.status === 0;
}

/** The path is everything after the FIRST tab, which is why first is the word. */
function split(entry) {
  const at = entry.indexOf('\t');
  return at === -1 ? [entry, ''] : [entry.slice(0, at), entry.slice(at + 1)];
}

/** One record's NUL-separated output, as `{ mode, path }` per entry. */
function entries(text) {
  return text
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [meta, path] = split(entry);
      return { mode: meta.split(' ')[0], path };
    });
}

/**
 * Every tracked path in one record, with the mode that record carries. Paths come
 * back as git prints them and as the rest of this repo names files: relative to
 * the repository root.
 */
export function listing(root, source = 'index') {
  if (source === 'HEAD' && !hasHead(root)) return [];
  return entries(git(command(source), { cwd: root }));
}

/**
 * The mode one path carries in one record, or null when that record has no entry
 * for it: a path the index does not track, or one HEAD does not have. The
 * divergence the two records exist for — an index that has dropped a bit HEAD
 * still carries — is this function asked twice.
 */
export function modeOf(root, source, path) {
  if (source === 'HEAD' && !hasHead(root)) return null;
  const [entry] = entries(git(command(source, [path]), { cwd: root }));
  return entry === undefined ? null : entry.mode;
}

/** Whether git would run a file whose record carries this mode. Nothing else is one. */
export function executable(mode) {
  return mode === EXECUTABLE;
}

/**
 * The fixture: plant each record and require it back, because a reader that
 * answered the same thing about everything would report a hook git skips as a
 * hook that works — the silent disable this reading exists to catch.
 *
 * The states are the ones the callers act on. The index and HEAD are made to
 * disagree, which is the only reason there are two records to read, and the state
 * the modes check warns about and `hookProblems` reports. A path is asked for
 * that the index does not track, and one that only the index has. One name holds
 * a tab, which is the name git hands back quoted and escaped unless it is asked
 * for the record itself. And a repository with no commit at all is read as a
 * record with nothing in it, rather than as a failure to read one.
 *
 * Proved once per process, and then remembered. What is under test is the code in
 * this module, which cannot change while the process runs — and this is asked for
 * by every check that reads a mode, several times each on a run that builds its
 * fixtures, where a scratch repository apiece is a cost nobody agreed to pay. A
 * refusal is not remembered: a fixture that fails fails again for the next caller.
 */
let proved = false;
export function proveItCanReadModes() {
  if (proved) return;
  const dir = mkdtempSync(join(tmpdir(), 'recorded-modes-'));
  const unborn = mkdtempSync(join(tmpdir(), 'recorded-modes-unborn-'));
  try {
    git(['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, 'plain.txt'), 'plain\n');
    writeFileSync(join(dir, 'hook.sh'), '#!/bin/sh\nexit 0\n');
    writeFileSync(join(dir, 'with\ttab.md'), '# a name git will not print plainly\n');
    git(['add', '--', 'plain.txt', 'hook.sh', 'with\ttab.md'], { cwd: dir });
    git(['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-q', '-m', 'fixture'], {
      cwd: dir,
    });

    // The repair somebody has already staged, which is what the two records are
    // for: the index has dropped the bit and HEAD still carries it.
    git(['update-index', '--chmod=+x', 'hook.sh', 'with\ttab.md'], { cwd: dir });
    // Tracked after the commit, so the index has it and HEAD does not.
    writeFileSync(join(dir, 'later.txt'), 'later\n');
    git(['add', '--', 'later.txt'], { cwd: dir });

    // The name git would quote and escape, back as it was written, is the word
    // that finds it at all: `at` refuses a record that does not hold exactly one
    // entry for the path it was asked about, and half of a tab-split name is no
    // entry at all.
    const at = (entries, path) => {
      const found = entries.filter((entry) => entry.path === path);
      if (found.length !== 1) {
        throw new Error(`the record holds ${found.length} entries for ${JSON.stringify(path)} — it lists ${entries.map((entry) => JSON.stringify(entry.path)).join(', ')}`);
      }
      return found[0].mode;
    };
    const is = (what, found, wanted) => {
      if (found !== wanted) throw new Error(`${what} reads ${JSON.stringify(found)} and not ${JSON.stringify(wanted)}`);
    };

    const index = listing(dir, 'index');
    const head = listing(dir, 'HEAD');
    is('the index mode of a plain file', at(index, 'plain.txt'), '100644');
    is('the index mode of a staged repair', at(index, 'hook.sh'), '100755');
    is('the HEAD mode behind that repair', at(head, 'hook.sh'), '100644');
    is('the index mode of a name holding a tab', at(index, 'with\ttab.md'), '100755');
    is('the index mode of a file added after the commit', at(index, 'later.txt'), '100644');
    if (index.some((entry) => !/^\d{6}$/.test(entry.mode))) {
      throw new Error(`a mode came back as something other than six digits: ${JSON.stringify(index.map((entry) => entry.mode))}`);
    }
    if (head.length !== 3) throw new Error(`HEAD lists ${head.length} entries and not the three that were committed`);

    // The single-path door, which is what `hookProblems` asks through, has to
    // agree with the record it came from — including about absence.
    is('one path, the index', modeOf(dir, 'index', 'hook.sh'), '100755');
    is('the same path in HEAD', modeOf(dir, 'HEAD', 'hook.sh'), '100644');
    is('a path the index does not track', modeOf(dir, 'index', 'untracked.txt'), null);
    is('a path only the index has', modeOf(dir, 'HEAD', 'later.txt'), null);

    if (!executable('100755')) throw new Error('the one mode git runs was read as not executable');
    if (executable('100644')) {
      throw new Error('an ordinary file was read as executable — this is the answer that lets a hook git skips read as one that works');
    }
    if (executable(null)) throw new Error('a record with no entry was read as executable');

    // A name that is neither record is a typo to be refused by name, not answered
    // with the index.
    let refused = null;
    try {
      listing(dir, 'worktree');
    } catch (error) {
      refused = error.message;
    }
    if (refused === null || !refused.includes('worktree')) {
      throw new Error(`asking for a record that does not exist was not refused by name: ${refused}`);
    }

    // And a repository with no commit: nothing recorded, and not an error.
    git(['init', '-q'], { cwd: unborn });
    if (listing(unborn, 'HEAD').length !== 0) throw new Error('an unborn HEAD listed modes it cannot have');
    if (modeOf(unborn, 'HEAD', 'anything') !== null) throw new Error('an unborn HEAD reported a mode for a path');

    proved = true;
  } finally {
    for (const scratch of [dir, unborn]) rmSync(scratch, { recursive: true, force: true });
  }
}

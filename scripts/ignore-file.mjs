/**
 * The part of writing an ignore file that both gates need.
 *
 * `scripts/gitignore-gate.mjs` and `scripts/untracked-gate.mjs` argue about the
 * same file from opposite sides, and each can write its half of the answer: the
 * gate that fails on a tracked path under a rule can add the negation that
 * rescues it, and the gate that fails on an uncovered artifact can add the rule
 * that ignores it. Two implementations of "show the diff, then write" would be
 * two things to keep in step — and the second one would be the one that drifts,
 * because it is the one nobody reads.
 *
 * So the whole of that phrase is shared: appending the block, showing the diff of
 * it, and — when a dry run asked for the diff alone — stopping there rather than
 * writing something nobody agreed to.
 *
 * Only the mechanics live here. Which lines to write is a judgment, and a
 * judgment belongs in the gate that makes it: this is handed files and their new
 * contents, and has no opinion about either.
 *
 * The fixture for that phrase lives here too, at the bottom, and both gates ask
 * for it on every run. It is the one place a wrong write could reach both of
 * them, and neither gate's own fixture can see the half of it the other
 * exercises — so it is proved where it lives rather than only through the
 * callers that happen to be tested.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/**
 * A file's contents with `block` appended, separated by one blank line and
 * ending in a newline whatever the file ended in.
 */
export function appended(before, block) {
  const gap = before === '' || before.endsWith('\n') ? '\n' : '\n\n';
  return `${before}${gap}${block.join('\n')}\n`;
}

/**
 * The diff of what is about to be written, in git's own format because git owns
 * diffs here and because the reader is being asked to decide on the strength of
 * it. The draft goes in a temp file, so the header can name the file being
 * changed rather than the draft.
 *
 * The lines that name a pair of blobs — `diff --git`, and `index <before>..<after>
 * <mode>` — are dropped: the hunks below them are the whole answer, and both file
 * headers are rewritten to answer "which file, and which side of the change". The
 * two dots and the mode are why the pattern below is written out rather than
 * assumed: an `index` line git prints and this does not recognise ends up in the
 * middle of a diff somebody is being asked to decide on.
 */
export function showDiff(file, after, name = basename(file)) {
  const dir = mkdtempSync(join(tmpdir(), 'ignore-file-draft-'));
  try {
    const draft = join(dir, 'draft');
    writeFileSync(draft, after);
    const result = spawnSync('git', ['diff', '--no-index', '--no-color', '--unified=3', '--', file, draft], {
      cwd: dir,
      encoding: 'utf8',
    });
    if (result.error) throw new Error(`could not run git diff: ${result.error.message}`);
    return (result.stdout ?? '')
      .split('\n')
      .filter((line) => !line.startsWith('diff --git ') && !/^index [0-9a-f]+\.\.[0-9a-f]+/.test(line))
      .map((line) => {
        if (line.startsWith('--- ')) return `--- ${name}`;
        if (line.startsWith('+++ ')) return `+++ ${name} (after --fix)`;
        return line;
      })
      .join('\n')
      .trimEnd();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The change, shown and then made — unless the caller asked for the preview
 * alone, which is the one case where the diff is the whole answer.
 *
 * `changes` are the ignore files that would differ, in the order they read, each
 * `{ name, path, contents }` the way `scan` and `audit` name them. A lone change
 * needs no line above its diff, because the diff's headers already say which file
 * it is; several do, or the reader cannot tell which hunk belongs to which file.
 *
 * Returns true when the change was written. A dry run returns false having
 * written nothing and said so: the read-back that follows a write means something
 * only about a file that was written, so this is where a run asked for the diff
 * stops, with the complaint it was about still standing.
 *
 * Both gates are asked this way on every run, and the fixture that proves
 * `--fix --dry-run` reads the preview as a diff: the change printed has to be the
 * change written, down to the lines. What it shows is `showDiff` output with
 * nothing of git's in it but the hunks, which is what makes that comparison the
 * same question in both runs.
 */
export function preview(changes, { log = console.log, dryRun = false } = {}) {
  log(`\n${changes.length === 1 ? changes[0].name : `${changes.length} ignore files`} would change:`);
  for (const change of changes) {
    log(changes.length === 1 ? '' : `\n${change.name}`);
    log(showDiff(change.path, change.contents, change.name));
  }

  if (dryRun) {
    log('\nNothing was written: --dry-run asked for the diff, not the file.');
    log('The read-back that goes with this write only means something about a file that was');
    log('actually written, so this run stops here — and the complaint above still stands.');
    return false;
  }

  for (const change of changes) writeFileSync(change.path, change.contents);
  return true;
}

/**
 * One run of `preview`, everything it says kept out of the real stdout: the sink
 * it was handed, and anything that went around it. A helper that printed straight
 * to the console would print over the report it is part of — which is the whole
 * reason the gates hand it a sink — so a leak is captured here rather than taken
 * on trust, from `console` and from the streams `console` writes through.
 */
function attempt(impl, changes, dryRun) {
  const lines = [];
  const leaked = [];
  const tattle = (...chunks) => {
    leaked.push(chunks.join(' '));
    return true;
  };
  const out = process.stdout.write;
  const err = process.stderr.write;
  const say = console.log;
  const complain = console.error;
  process.stdout.write = tattle;
  process.stderr.write = tattle;
  console.log = tattle;
  console.error = tattle;
  try {
    return { lines, leaked, returned: impl(changes, { log: (line) => lines.push(line), dryRun }) };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    console.log = say;
    console.error = complain;
  }
}

/**
 * One change's diff as this repo reads one: the two headers, and hunks. Throws
 * naming what is wrong with it — a diff that hides which file it is about, that
 * still shows the lines git names a pair of blobs with, or that is not the change
 * the caller was shown.
 */
function published(diff, change, added) {
  const lines = diff.split('\n');
  // Asked for first, because it is the one that sits between the two headers:
  // a filter that stopped matching pushes the two of them apart, and the reader
  // is then shown a blob hash where the file's name should be.
  const blobs = lines.filter((line) => line.startsWith('diff --git ') || line.startsWith('index '));
  if (blobs.length > 0) {
    throw new Error(`the diff of ${change.name} shows the lines git names a pair of blobs with: ${blobs.join(' | ')}`);
  }
  if (lines[0] !== `--- ${change.name}` || lines[1] !== `+++ ${change.name} (after --fix)`) {
    throw new Error(`${change.name}: the diff does not say which file, and which side of the change, it is:\n${diff}`);
  }
  if (!lines.includes(`+${added}`)) {
    throw new Error(`the diff of ${change.name} does not show the line the change adds:\n${diff}`);
  }
}

/**
 * Everything `preview` promises, in the order a caller meets it, against one
 * scratch directory. Throws on the first thing that is not true, so a failure
 * names the promise rather than a line number.
 */
function held(impl, dir) {
  const outer = join(dir, '.gitignore');
  const inner = join(dir, 'sub', '.gitignore');
  mkdirSync(dirname(inner), { recursive: true });
  const base = '# fixture\n';
  const nested = '# nested\n';
  writeFileSync(outer, base);
  writeFileSync(inner, nested);
  const changes = [
    { name: '.gitignore', path: outer, contents: `${base}\n!/notes.txt\n` },
    { name: 'sub/.gitignore', path: inner, contents: `${nested}\n!/sub/notes.txt\n` },
  ];
  const added = ['!/notes.txt', '!/sub/notes.txt'];

  // Asked for the diff alone, for both files at once: the only way to reach the
  // header written for several, and the form in which a missing name line above
  // a hunk leaves the reader unable to tell which hunk belongs to which file.
  const asked = attempt(impl, changes, true);
  if (asked.leaked.length > 0) {
    throw new Error(`a dry run printed to the console instead of the log sink it was handed: ${JSON.stringify(asked.leaked[0].slice(0, 72))}`);
  }
  if (readFileSync(outer, 'utf8') !== base || readFileSync(inner, 'utf8') !== nested) {
    throw new Error('a dry run wrote to a file it was only asked to show');
  }
  if (asked.returned !== false) {
    throw new Error(`a dry run returned ${asked.returned}, so a caller reads it as a change that was made`);
  }
  if (asked.lines[0] !== '\n2 ignore files would change:') {
    throw new Error(`two files changing were announced as ${JSON.stringify(asked.lines[0])}`);
  }
  for (const [at, change] of changes.entries()) {
    if (asked.lines[at * 2 + 1] !== `\n${change.name}`) {
      throw new Error(`the diff of ${change.name} is not named above it: ${JSON.stringify(asked.lines[at * 2 + 1])}`);
    }
    published(asked.lines[at * 2 + 2], change, added[at]);
  }
  const stopped = asked.lines.findIndex((line) => line.startsWith('\nNothing was written'));
  if (stopped === -1) {
    throw new Error(`the dry run did not say it had written nothing:\n${asked.lines.join('\n')}`);
  }
  if (asked.lines.length - stopped !== 3) {
    throw new Error(
      `the dry run ended with ${asked.lines.length - stopped} lines rather than the three that say nothing was written`,
    );
  }

  // Then the same change with the write agreed to. One file, which is the
  // header's other form: the name inside the sentence, and no line above the
  // diff repeating it.
  const wrote = attempt(impl, [changes[0]], false);
  if (wrote.leaked.length > 0) {
    throw new Error(`writing a change printed to the console instead of the log sink it was handed: ${JSON.stringify(wrote.leaked[0].slice(0, 72))}`);
  }
  if (wrote.lines[0] !== '\n.gitignore would change:') {
    throw new Error(`one file changing was announced as ${JSON.stringify(wrote.lines[0])}`);
  }
  if (wrote.lines.length !== 3 || wrote.lines[1] !== '') {
    throw new Error(`one change printed ${wrote.lines.length} lines — the header and the diff, and nothing else, was expected`);
  }
  published(wrote.lines[2], changes[0], added[0]);
  if (wrote.returned !== true) {
    throw new Error(`writing returned ${wrote.returned}, so a caller cannot tell whether the file it asked for was written`);
  }
  if (readFileSync(outer, 'utf8') !== changes[0].contents) {
    throw new Error('the write did not put the bytes it was handed into the file');
  }
  if (readFileSync(inner, 'utf8') !== nested) {
    throw new Error('a write reached a file it was not handed');
  }
}

/**
 * Three wrong versions of `preview`, each wrong in one way, with the fragment of
 * the refusal that has to name it. A fixture nobody has watched refuse anything
 * is a fixture that has not been asked a question yet — the same reason the
 * doctor's runner is proved with checks that are objects rather than files.
 */
const BROKEN = [
  [
    'printed to the console rather than the sink it was handed',
    (changes, { dryRun }) => {
      console.log(`\n${changes.length} ignore files would change:`);
      if (!dryRun) for (const change of changes) writeFileSync(change.path, change.contents);
      return !dryRun;
    },
    'printed to the console',
  ],
  [
    'wrote when it was asked for the diff alone',
    (changes, options) => preview(changes, { ...options, dryRun: false }),
    'dry run wrote to a file',
  ],
  [
    "left git's blob lines in the diff",
    (changes, options) =>
      preview(changes, {
        ...options,
        // The line git prints above the file headers, put back where git puts
        // it: what the filter in `showDiff` is for, and the shape of the bug it
        // was written after — the pattern recognised one dot, and git prints two.
        log: (line) => options.log(line.replace(/^--- /m, 'index 0123456..789abcd 100644\n--- ')),
      }),
    'names a pair of blobs',
  ],
];

/**
 * The fixture for `preview`, asked for by both gates on every run.
 *
 * Both gates write through this one function, so a fault in it is a fault in
 * both — and `showDiff` is the part of it worth pinning hardest, because its
 * filter is what decides whether a reader is asked to agree to a change on the
 * strength of a diff or of a diff with git's plumbing still in it. Then the same
 * assertions are pointed at the versions above, which have to be refused, and
 * refused for their own reason rather than for any reason at all.
 */
export function proveItCanPreview() {
  const dir = mkdtempSync(join(tmpdir(), 'ignore-file-preview-'));
  try {
    held(preview, dir);
    for (const [wrong, impl, reason] of BROKEN) {
      let refused = null;
      try {
        held(impl, dir);
      } catch (error) {
        refused = error.message;
      }
      if (refused === null) throw new Error(`the fixture accepted a preview that ${wrong}`);
      if (!refused.includes(reason)) {
        throw new Error(`the fixture refused a preview that ${wrong}, but for the wrong reason: ${refused}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

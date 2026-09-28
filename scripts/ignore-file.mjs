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
 * Only the mechanics live here. Which lines to write is a judgment, and a
 * judgment belongs in the gate that makes it.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

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
 * The lines that name a pair of blobs — `diff --git`, `index` — are dropped: the
 * hunks below them are the whole answer, and both file headers are rewritten to
 * answer "which file, and which side of the change".
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

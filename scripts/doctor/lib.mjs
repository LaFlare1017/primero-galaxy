/**
 * The mechanics a check is built from: asking git a question, walking a
 * directory, naming a path against the repository.
 *
 * Nothing here judges anything. The verdicts live one per file in `checks/`,
 * and the split is deliberate: a helper that knows what a good answer looks like
 * is a check, and belongs in a check. What is left is the vocabulary they share,
 * which is why `git` here is the plain version — it throws on a non-zero exit
 * because a caller that wanted to tolerate one would be making a judgment, and
 * that judgment should be visible in the caller.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Runs git and returns stdout, trimmed. A non-zero exit is an error. */
export function git(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd });
  if (result.error) throw new Error(`could not run \`git ${args.join(' ')}\`: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').toString().trim();
    throw new Error(`\`git ${args.join(' ')}\` exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8').trim();
}

/** Paths read best against the repository, unless they are outside it. */
export function show(path, root) {
  const rel = relative(root, path);
  return rel && !rel.startsWith('..') ? rel : path;
}

/** The `.git` directory, worktrees and submodules included. */
export function gitDir(root) {
  const shown = git(['rev-parse', '--git-dir'], { cwd: root });
  return isAbsolute(shown) ? shown : resolve(root, shown);
}

/** Every file under `dir` with this extension, and when it was last written. */
export function mtimes(dir, extension) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(extension)) found.push({ path, mtime: statSync(path).mtimeMs });
    }
  };
  if (existsSync(dir)) walk(dir);
  return found;
}

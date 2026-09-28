/**
 * Whether this file is the program the runtime was asked to run.
 *
 * Every script here is both a program and a library: the doctor imports
 * `scan`, `audit` and the check modules, and each of them has to be runnable on
 * its own. The obvious test is `import.meta.url === pathToFileURL(process.argv[1]).href`,
 * and it is wrong in a way that costs nothing visible — `import.meta.url` is the
 * *resolved* path, so an invocation through a symlink compares unequal and the
 * entry point's whole body is skipped. macOS is the everyday case: `mkdtemp`
 * hands back `/var/folders/...`, which resolves to `/private/var/folders/...`,
 * and a cloud-synced checkout is a symlink more often than not.
 *
 * Nothing runs, nothing prints, and the exit code is 0 — which every caller
 * reads as a pass. A guard that can decline to run is a gate that can decline to
 * check, so this compares real paths on both sides, and treats having no
 * `process.argv[1]` at all (a program on stdin) as not being the main module.
 *
 * `url` is the caller's own `import.meta.url` and has to be passed in:
 * `import.meta` is per-module, so a helper that read its own would compare this
 * file against the invocation and answer "no" for every program in the repo.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function isMain(url) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(fileURLToPath(url)) === realpathSync(invoked);
  } catch {
    // A path that does not resolve is not a reason to take the run down: fall
    // back to the literal comparison, which answers "no" for a path not there.
    return url === pathToFileURL(invoked).href;
  }
}

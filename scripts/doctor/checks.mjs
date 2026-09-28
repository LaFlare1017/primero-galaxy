/**
 * The checks, discovered rather than listed.
 *
 * Every file in `checks/` is one invariant. It default-exports a descriptor —
 * `{ name, order, commit, run }` — and the doctor runs whatever it finds, so
 * adding a check is adding a file. There is deliberately no table of names here:
 * a list is a second place a check can be forgotten, and a check nobody runs is
 * indistinguishable from a rule that holds.
 *
 * Three things are refused loudly rather than tolerated, because each of them
 * would otherwise read as a pass:
 *
 *   - a directory with no checks in it. A doctor that checked nothing prints the
 *     same summary as a doctor that found nothing wrong.
 *   - a module that is not a check: no `name` to be called in the report, no
 *     `order`, no `run`. It is named by file, because the file is what changes.
 *   - two checks with the same `name`. One of them would be counted, and the
 *     other would print over it.
 *
 * `order` is where the line reads best, and the gaps between the numbers are
 * there so a check can be slipped between two others without renumbering
 * either. `commit: true` puts a check in the subset the commit-time hook runs
 * (`.githooks/pre-commit` calls the doctor with `--fast`): the ones whose
 * subject is the commit in progress rather than this machine.
 */
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'checks');

/** Where the check came from, as short as the caller's working directory allows. */
const home = (file) => relative(process.cwd(), join(DIR, file));

function validate(check, file) {
  const who = home(file);
  if (check === null || typeof check !== 'object') {
    throw new Error(`${who} must default-export a check — { name, order, run }`);
  }
  if (typeof check.name !== 'string' || check.name.trim() === '') {
    throw new Error(`${who} has no \`name\` — the report would have nothing to call it`);
  }
  if (!Number.isFinite(check.order)) {
    throw new Error(`${who} has no numeric \`order\` — where it reads in the report belongs in the file, not in a list`);
  }
  if (typeof check.run !== 'function') {
    throw new Error(`${who} has no \`run(root, context)\` — a check that cannot be run is not a check`);
  }
  return { ...check, file: who };
}

/**
 * The check files, or a refusal that says what is wrong in the doctor's own
 * terms: a directory that cannot be read and a directory with no checks in it
 * both mean the same thing, and an OS error is not that sentence.
 */
function checkFiles() {
  const where = relative(process.cwd(), DIR);
  let entries;
  try {
    entries = readdirSync(DIR);
  } catch (error) {
    throw new Error(`${where} cannot be read (${error.code ?? error.message}) — a doctor with no checks reads as a pass`);
  }
  const files = entries.filter((name) => name.endsWith('.mjs')).sort();
  if (files.length === 0) {
    throw new Error(`${where} holds no checks — a doctor with no checks reads as a pass`);
  }
  return files;
}

/** Every check in `checks/`, in the order the report reads. */
export async function checks() {
  const found = [];
  for (const file of checkFiles()) {
    const module = await import(pathToFileURL(join(DIR, file)).href);
    found.push(validate(module.default, file));
  }

  const seen = new Map();
  for (const check of found) {
    if (seen.has(check.name)) {
      throw new Error(`two checks are called "${check.name}": ${seen.get(check.name)} and ${check.file}`);
    }
    seen.set(check.name, check.file);
  }

  return found.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

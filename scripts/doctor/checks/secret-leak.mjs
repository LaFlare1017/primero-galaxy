/**
 * Whether any program under `scripts/` could put a credential it was handed
 * somewhere it survives the run.
 *
 * `scripts/neon-secrets.mjs` reads a Neon API key from the environment and
 * writes it to three repository secrets. The key is the one input to that
 * program with no second copy anywhere else and no way to rotate it from a
 * terminal: it authorises project and branch creation on somebody's Neon
 * account. So the ways it can escape are the ways the program is wrong, and
 * there are only three worth ruling out:
 *
 *   - **printed.** A `console.*` line naming the key is a CI log line, and CI
 *     logs are readable by everyone with read access to a repository and are
 *     kept past the run.
 *   - **raised.** A key inside a `throw new Error(...)` is worse than printed,
 *     because an error travels further than a log line: it can end up in an
 *     issue, in a comment, in somebody's terminal scrollback.
 *   - **passed as an argument.** A value in a `spawnSync` argument array is in
 *     `ps` output for as long as the process lives, and in the shell history of
 *     whatever invoked it. `gh secret set` is called with the value on stdin
 *     precisely so this cannot happen.
 *
 * A masked value is the allowed form everywhere, and `mask()` calls are removed
 * from a line before it is read, so `${mask(apiKey)}` is the answer this check
 * is looking for rather than a near miss of it.
 *
 * The fourth rule is about the mask itself, because a mask that is one digit too
 * wide is the same leak wearing a disguise: `slice(0, 8)` on a 29-character key
 * prints eight characters of it, which is enough to be a real prefix of a real
 * key and is exactly the mistake that reads as harmless. Four leading and two
 * trailing is the line: enough for a person to confirm which key they exported,
 * too few to use.
 *
 * WHAT IT REFUSES, because a false positive here would be worse than the leak:
 * putting the key in an HTTP `Authorization` header is the program working. It
 * is the credential's actual purpose, it goes to the one host it is for, and it
 * never becomes a string in a log, an argument list, or an error. A rule that
 * flagged a correctly-made authenticated request would be a rule nobody keeps.
 *
 * It reads the same way on both sides of a fix, which is what makes the fix
 * reviewable: the check names the line and the masked or stdin form to use.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { write } from '../fixture.mjs';

/** The only program that reads a credential today; every program is scanned. */
const ROOTS = ['scripts'];

/** Where a credential arrives and leaves. One name, checked in every form. */
const KEY = String.raw`\bapiKey\b`;

/** A `mask(...)` call, removed before the line is read: the allowed form. */
const MASKED = /mask\(\s*[^()]*\s*\)/g;

/** Anything that puts text in front of a person: a log line, or an error. */
const OUTPUT = /\bconsole\s*\.\s*(?:log|error|warn|info|debug|trace)\s*\(|\bthrow\s+new\s+\w*\s*Error\s*\(/;

/** Anything whose argument array is visible in `ps` while it runs. */
const SPAWNED = /\bspawn(?:Sync)?\s*\(|\bexec(?:Sync|File)?\s*\(/;

/** The ellipsis the mask joins its two ends with. */
const ELLIPSIS = '…';

const RULES = [
  ['the key reaches output', OUTPUT],
  ['the key is an argument', SPAWNED],
];

/**
 * A mask, by shape: it slices a head off one end, joins with an ellipsis, and
 * slices a tail off the other. Scoping the rule to that shape is what keeps it
 * off the unrelated `slice(0, 120)` that trims an error body, which is not a
 * mask and does not print a credential.
 */
function maskWidth(line) {
  if (!line.includes(ELLIPSIS) || !/slice\(\s*-\s*\d+\s*\)/.test(line)) return null;
  const head = /slice\(\s*0\s*,\s*(\d+)\s*\)/.exec(line);
  return head ? Number(head[1]) : null;
}

/**
 * Comments out, keeping every newline, so a line number still means what it
 * meant and prose *about* a leak is not one. Newlines are replaced with
 * newlines rather than collapsed: a comment that becomes a single space would
 * shift every line after it, and a check that reports the wrong line is worse
 * than one that reports nothing.
 */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) =>
    comment.replace(/[^\n]/g, ' '),
  );
}

/**
 * Every program under the roots, minus the ignored directories.
 *
 * `doctor` is skipped because this file would otherwise report itself: the
 * fixtures below contain, on purpose, the leaking lines this check looks for, so
 * a scan that reached them would find four violations in the program doing the
 * finding and fail every run for the life of the repository. The fixtures are
 * read through `findingFrom` instead, where each one is judged in a throwaway
 * directory holding nothing but the line under test.
 */
function sources(root) {
  const found = [];
  const skip = new Set(['node_modules', 'doctor']);
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return; // a root this checkout does not have, which is not a failure
    }
    for (const entry of entries) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) walk(full);
      else if (full.endsWith('.mjs') || full.endsWith('.js')) found.push(full);
    }
  };
  for (const name of ROOTS) walk(join(root, name));
  return found;
}

/**
 * The ways a credential could escape, as `path:line  rule  source` rows.
 *
 * A line is read with its `mask(...)` calls removed, so the question asked of
 * every line is the one that matters: after the masked parts are set aside,
 * does the credential itself appear in something a person or a log can see?
 */
export function violationsIn(root) {
  const rows = [];
  const key = new RegExp(KEY);
  for (const file of sources(root)) {
    const rel = relative(root, file);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    code(text)
      .split('\n')
      .forEach((line, index) => {
        const masked = line.replace(MASKED, 'mask()');
        const width = maskWidth(line);
        // First rule that matches, so one leak is counted once. A key printed
        // inside a `console.log` that also spawns nothing is one mistake, and a
        // count that double-reported it would misstate how many lines to fix.
        const hit = RULES.find(([, pattern]) => pattern.test(line) && key.test(masked));
        if (hit) rows.push({ rel, line: index + 1, rule: hit[0], source: line.trim() });
        else if (width !== null && width > 4) {
          rows.push({
            rel,
            line: index + 1,
            rule: 'the mask keeps too much of it',
            source: line.trim(),
          });
        }
      });
  }
  return rows;
}

export default {
  name: 'secret-leak',
  order: 47,
  commit: true,
  proof: [
    {
      level: 'pass',
      why: 'the masked form is the answer this check is looking for, not a near miss of it',
      setup: (root) =>
        write(root, 'scripts/neon-secrets.mjs', 'console.log(`NEON_API_KEY is ${mask(apiKey)}.`);\n'),
    },
    {
      level: 'fail',
      why: 'a key in a log line is readable by everyone with read access, and kept past the run',
      setup: (root) =>
        write(root, 'scripts/neon-secrets.mjs', 'console.log(`the key is ${apiKey}`);\n'),
    },
    {
      level: 'fail',
      why: 'a key inside an error travels further than a log line — into issues and scrollback',
      setup: (root) =>
        write(root, 'scripts/neon-secrets.mjs', 'throw new Error(`Neon rejected key ${apiKey}`);\n'),
    },
    {
      level: 'fail',
      why: 'a value in an argument array is in `ps` output for as long as the process lives',
      setup: (root) =>
        write(root, 'scripts/neon-secrets.mjs', "spawnSync('gh', ['secret', 'set', apiKey]);\n"),
    },
    {
      level: 'pass',
      why: 'the stdin handoff is why a secret never appears in an argument array',
      setup: (root) =>
        write(
          root,
          'scripts/neon-secrets.mjs',
          "const result = spawnSync('gh', ['secret', 'set', name], { input: value });\n",
        ),
    },
    {
      level: 'pass',
      why: 'an Authorization header is the credential working — it goes to the one host it is for',
      setup: (root) =>
        write(root, 'scripts/neon-secrets.mjs', 'headers: { Authorization: `Bearer ${apiKey}` },\n'),
    },
    {
      level: 'pass',
      why: 'reading the key from the environment is the point: a command line lands in shell history',
      setup: (root) =>
        write(root, 'scripts/neon-secrets.mjs', "const apiKey = (process.env.NEON_API_KEY ?? '').trim();\n"),
    },
    {
      level: 'pass',
      why: 'four leading and two trailing: enough to confirm which key, too few to use',
      setup: (root) =>
        write(root, 'scripts/neon-secrets.mjs', 'return `${key.slice(0, 4)}…${key.slice(-2)}`;\n'),
    },
    {
      level: 'fail',
      why: 'a mask one digit too wide is the same leak wearing a disguise',
      setup: (root) =>
        write(root, 'scripts/neon-secrets.mjs', 'return `${key.slice(0, 8)}…${key.slice(-2)}`;\n'),
    },
    {
      level: 'pass',
      why: 'prose naming the leak is not the leak — the check file itself documents it',
      setup: (root) =>
        write(root, 'scripts/neon-secrets.mjs', '// never printed: console.log(apiKey) is the mistake\n'),
    },
  ],
  run(root) {
    const found = violationsIn(root);
    if (found.length === 0) {
      return { detail: 'no credential reaches output, an argument array, or a mask wider than four' };
    }
    const first = found[0];
    return {
      level: 'fail',
      detail: `${found.length} place${found.length === 1 ? '' : 's'} a credential could escape`,
      // The fix is a one-line change in each case, so the check names it rather
      // than describing it: mask it for a person, or hand it over on stdin.
      hint: [
        `${first.rel}:${first.line} — ${first.rule}: ${first.source}`,
        'print `mask(apiKey)`, pass the value to `gh` on stdin (`{ input: value }`), never in an argument array',
        'an Authorization header is NOT what this check reports — that is the credential working',
      ],
    };
  },
};

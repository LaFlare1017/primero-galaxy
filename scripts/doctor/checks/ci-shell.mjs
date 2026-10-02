/**
 * Whether the CI workflow still decides anything in shell.
 *
 * Every correctness claim this repository makes about CI used to be made by a
 * `run:` block, which means it used to be made by whichever shell GitHub
 * happened to pick. That is a real dependency and it is invisible in review,
 * because a `run:` block reads as a command:
 *
 *   - the remote store gate piped the gate into `tee` and read
 *     `${PIPESTATUS[0]}`. `PIPESTATUS` is a **bash** array. On a Linux runner
 *     the default is `bash -e {0}`, so it worked — until somebody sets
 *     `shell: sh`, or copies the block somewhere POSIX is in charge, and then
 *     the status is empty and the step's verdict is a shell's opinion rather
 *     than the gate's. The dangerous direction is the other one: a block that
 *     guards the pipeline with a construct that does not survive the move reads
 *     `tee`'s status, which is zero, and the job goes green having proved
 *     nothing. `set -e` cannot save it, because a pipeline's status IS its last
 *     stage's.
 *   - the Lighthouse step started a server with `&`, waited for it with
 *     `curl … && break` in a `for` loop with no `else`, and killed it with
 *     `kill $SERVER 2>/dev/null || true` AFTER the audits. A server that never
 *     came up fell through to the audits, whose empty reports the gate read as
 *     a pass; and a lighthouse failure — the only case the gate exists to
 *     catch — skipped the cleanup entirely.
 *   - the resolve step was `neon-secrets.mjs --resolve >> "$GITHUB_ENV"`, so
 *     the program's contract was "whatever it prints becomes an environment
 *     variable" and nothing in the program said so.
 *
 * All three are programs now. This check is what stops the fourth.
 *
 * WHAT IT REFUSES, because the false positive here is worse than the bug: a
 * single command in a `run:` block is not shell logic. `run: npm ci` and
 * `run: node scripts/store-gate-remote.mjs` are irreducibly shell — the runner
 * has to interpret *something* — and demanding a program for each would produce
 * a wrapper per command and no safety at all. The rule is narrower and aimed at
 * the thing that actually went wrong: a `run:` block that does MORE than run one
 * thing. A pipeline, a redirection, a subshell, a background job, a loop, a
 * `PIPESTATUS`, a `tee`, a `curl` poll. Those are the constructs that turn a
 * step's verdict into a shell feature's behaviour.
 *
 * A single command with `env:` beside it, or with a `working-directory`, is
 * fine. So is a multi-line block whose lines are all part of one invocation —
 * a long `npx` command with backslash continuations — which is why a block that
 * is only continuations of one command does not trip it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { write } from '../fixture.mjs';

const WORKFLOW = '.github/workflows/ci.yml';

/**
 * The constructs that make a step's OUTCOME depend on a shell.
 *
 * Each is a thing this repository actually shipped, and each is a thing a
 * `node scripts/*.mjs` call does not need. `>>` is here because writing to
 * `$GITHUB_ENV` from a program is the program's own business — a redirection
 * means the contract "print nothing but the answer" is enforced by the shell
 * rather than by the program, which is how a stray progress line becomes an
 * environment variable.
 */
const RULES = [
  ['a pipeline', /\|/],
  ['a redirection', />>|[0-9]>&[12]|<\(/],
  ['a subshell or command substitution', /\$\(|\|\||&&/],
  ['a background job', /&\s*$/m],
  ['a status array from a pipeline', /PIPESTATUS/],
  ['a poll for readiness', /\bcurl\b/],
  ['a loop', /\b(?:for|while|until)\b/],
  ['a variable assignment the runner would have to expand', /\$\{?[A-Z_][A-Z0-9_]*\}?/],
  ['a test or conditional', /\[\s|^\s*if\s/],
  // The backstop, and it has to be last: a block that runs a SECOND command has
  // no separator to match, so every rule above would miss it. A `run:` block
  // that is more than one command is the shape this check exists to refuse,
  // whatever the second command happens to be.
  ['a second command in one step', /^\s*(?:node|npm|npx|bash|sh|curl|echo|cd|export)\b/],
];

/** A line that carries no command of its own: a continuation, or a comment. */
function isFiller(line) {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('\\') || trimmed === '---';
}

/**
 * A line that is not part of this `run:` block at all.
 *
 * A block scalar ends at the first line indented no further than its key. The
 * comparison is on the key's own indentation, and NOT including the `- ` that
 * introduces a step: in this workflow `run: >-` sits at 8 spaces with its body
 * at 10, and the next step's keys are back at 8 with a `- ` in front — so
 * measuring the dash's column instead of the key's reads the whole rest of the
 * job as one `run:` block. That is how this check first reported four
 * violations in a workflow with none, and a check that cries wolf on its first
 * run is a check nobody runs a second time.
 */
function endsBlock(line, indent) {
  if (line.trim() === '') return false;
  return line.search(/\S/) <= indent;
}

/**
 * Strip a GitHub expression, which is not shell.
 *
 * `${{ … }}` is GitHub's own interpolation and is expanded BEFORE the shell
 * sees the line. The e2e job uses it heavily — `--fork-pr` is chosen by
 * `${{ github.event_name == 'pull_request' && … }}` — and that contains both an
 * `&&` and a `|`, neither of which reaches a shell. A check that flagged those
 * would be flagging the one construct in this workflow that is emphatically not
 * the problem.
 */
function withoutExpressions(line) {
  return line.replace(/\$\{\{[\s\S]*?\}\}/g, ' ');
}

/**
 * Every `run:` block in the workflow, as `{ job, step, body }`.
 *
 * A YAML parse would be more precise, and this repository has no YAML parser as
 * a dependency — so the blocks are found by indentation, which is enough
 * because `run:` blocks are either one line or a `|` / `>-` block whose
 * continuation lines are indented past the key.
 */
export function runBlocksIn(text) {
  const lines = text.split('\n');
  const blocks = [];
  let job = '(top level)';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // A job is two-space indented and ends in a colon. This is a heuristic
    // rather than a parse, and it only affects the label in a message.
    const asJob = line.match(/^ {2}([a-z][a-z0-9_-]*):\s*$/);
    if (asJob) job = asJob[1];

    const asRun = line.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!asRun) continue;
    // The KEY's column, which is where the `run:` text starts — not where the
    // line starts. A step introduced with `- ` puts the key two columns in, and
    // the block body is measured against the key.
    const [, lead, rest] = asRun;
    const indent = lead.length + (line.slice(lead.length).startsWith('- ') ? 2 : 0);

    // `run: >-` and `run: |` are block scalars; the body is the following lines
    // indented further than the key. `>-` folds, `|` keeps newlines, and the
    // difference changes nothing about what the shell sees.
    if (rest === '|' || rest === '>' || rest === '>-' || rest === '|+') {
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const next = lines[j];
        if (endsBlock(next, indent)) break;
        body.push(next);
      }
      blocks.push({ job, step: `run: ${rest} at line ${i + 1}`, body, line: i + 1 });
      i = j - 1;
      continue;
    }

    blocks.push({ job, step: rest, body: [rest], line: i + 1 });
  }
  return blocks;
}

/** The lines in a block that carry a command, with their numbers. */
function commands(block) {
  return block.body
    .map((text, index) => ({ text, line: block.line + 1 + index }))
    .filter(({ text }) => !isFiller(text))
    // A line that is another step's key never got here — `endsBlock` stops the
    // body — but a `run:` whose body is empty still yields the NEXT step's
    // lines on some shapes of the file, and a key like `path: |` is not a
    // command. Anything that looks like `key:` at the start of a line and has no
    // command before it is YAML, not shell.
    .filter(({ text }) => !/^[a-z][a-z0-9_-]*:\s*(?:\||>|-?\d*)?\s*$/.test(text));
}

/**
 * Whether a block is irreducibly one command.
 *
 * Continuations and comments do not count, and neither does a single command
 * spread over several lines with backslashes — which is the shape a long `npx`
 * invocation takes, and flagging it would be a rule nobody keeps.
 *
 * Every line but the last must therefore end in a continuation, AND the last
 * line must not carry a separator of its own. Both halves are load-bearing and
 * the second was a real miss: a block of two plain commands with no backslash
 * and no `&&` between them reads as "one command" under a check that only
 * looked for a separator on the final line, so
 *
 *     run: |
 *       node scripts/lighthouse-run.mjs
 *       echo done
 *
 * passed — a block that runs two things, reported as one. Continuations are
 * what makes a multi-line line a continuation, so their absence is the signal.
 */
function isOneCommand(block) {
  const real = commands(block);
  if (real.length === 0) return true;
  // Every line but the last ends in a continuation. This is also what rules out
  // a second plain command line: `echo done` does not end in a backslash.
  for (let i = 0; i < real.length - 1; i += 1) {
    if (!real[i].text.trimEnd().endsWith('\\')) return false;
  }
  // The final line must not itself contain a second command. Expressions are
  // stripped first for the same reason the rules read them stripped: an `&&`
  // inside `${{ }}` is GitHub's, not a shell's.
  const last = withoutExpressions(real[real.length - 1].text);
  return !/\|/.test(last) && !/\$\(/.test(last) && !/>>/.test(last) && !/&&/.test(last) && !/;/.test(last);
}

/** The shell features a block reaches for, as `rule` rows. */
export function violationsIn(text) {
  const rows = [];
  for (const block of runBlocksIn(text)) {
    if (isOneCommand(block)) continue;
    const real = commands(block);
    real.forEach(({ text: line, line: number }, index) => {
      // GitHub's own interpolation is expanded before a shell exists, so it is
      // removed before the rules read the line. See `withoutExpressions`.
      const shell = withoutExpressions(line);
      // The FIRST command in a multi-command block is not itself "a second
      // command" — it is the step, and the problem is everything after it. The
      // backstop rule matches any `node …` line, so without this it fired on
      // the opening line of every folded block in the workflow, which is how
      // `run: >-\n  node scripts/e2e-coverage.mjs …` was reported as two
      // commands.
      const skipSecondCommandRule = index === 0;
      const hit = RULES.find(([rule, pattern]) =>
        !(skipSecondCommandRule && rule === 'a second command in one step') && pattern.test(shell),
      );
      if (hit) rows.push({ job: block.job, step: block.step, line: number, rule: hit[0], source: line.trim() });
    });
  }
  return rows;
}

export default {
  name: 'ci shell',
  order: 49,
  commit: true,
  proof: [
    {
      level: 'pass',
      why: 'a single command per step, which is irreducibly shell and must stay allowed',
      setup: (root) => write(root, WORKFLOW, 'jobs:\n  build:\n    steps:\n      - run: npm ci\n      - run: node scripts/doctor.mjs\n'),
    },
    {
      level: 'fail',
      why: 'the store gate reading PIPESTATUS out of a pipeline — a bash array, so the verdict is a shell feature',
      setup: (root) =>
        write(
          root,
          WORKFLOW,
          'jobs:\n  store:\n    steps:\n      - run: |\n          node gate.js | tee /tmp/g.log\n          status=${PIPESTATUS[0]}\n          exit "$status"\n',
        ),
    },
    {
      level: 'fail',
      why: 'a readiness poll whose loop has no else, so a server that never came up falls through to the audits',
      setup: (root) =>
        write(
          root,
          WORKFLOW,
          'jobs:\n  lh:\n    steps:\n      - run: |\n          npm start &\n          for i in $(seq 1 30); do\n            curl -sf -o /dev/null http://localhost:3100/ && break\n            sleep 1\n          done\n',
        ),
    },
    {
      level: 'fail',
      why: "writing to $GITHUB_ENV by redirection makes 'print nothing but the answer' a shell's promise",
      setup: (root) =>
        write(root, WORKFLOW, 'jobs:\n  store:\n    steps:\n      - run: node scripts/neon-secrets.mjs --resolve >> "$GITHUB_ENV"\n'),
    },
    {
      level: 'fail',
      why: 'a background job with a cleanup after the step that is supposed to fail',
      setup: (root) =>
        write(root, WORKFLOW, 'jobs:\n  lh:\n    steps:\n      - run: |\n          npm run start -- -p 3100 > /tmp/s.log 2>&1 &\n          SERVER=$!\n          kill $SERVER 2>/dev/null || true\n'),
    },
    {
      level: 'fail',
      why: 'two plain commands in one step, with no separator to match — the case a separator-only rule misses',
      setup: (root) =>
        write(
          root,
          WORKFLOW,
          'jobs:\n  lh:\n    steps:\n      - run: |\n          node scripts/lighthouse-run.mjs\n          echo done\n',
        ),
    },
    {
      level: 'pass',
      why: "a GitHub expression's own && and | are expanded before a shell exists",
      setup: (root) =>
        write(
          root,
          WORKFLOW,
          "jobs:\n  e2e:\n    steps:\n      - run: >-\n          node scripts/e2e-coverage.mjs ${{ github.event_name == 'pull_request' && github.ref || 'push' }}\n",
        ),
    },
    {
      level: 'pass',
      why: 'one long command wrapped with backslashes is one command, not a script',
      setup: (root) =>
        write(
          root,
          WORKFLOW,
          'jobs:\n  lh:\n    steps:\n      - run: |\n          npx lighthouse http://localhost:3100/ \\\n            --output=json \\\n            --only-categories=accessibility,seo\n',
        ),
    },
    {
      level: 'pass',
      why: 'the workflow this repository ships today, with every step a program call',
      setup: (root) =>
        write(
          root,
          WORKFLOW,
          [
            'jobs:',
            '  checks:',
            '    steps:',
            '      - run: npm ci',
            '      - run: node scripts/doctor.mjs --strict',
            '  store:',
            '    steps:',
            '      - name: resolve',
            '        run: node scripts/neon-secrets.mjs --resolve',
            '      - name: remote leg',
            '        run: node scripts/store-gate-remote.mjs',
            '  lighthouse:',
            '    steps:',
            '      - run: node scripts/lighthouse-run.mjs',
            '',
          ].join('\n'),
        ),
    },
  ],
  run(root) {
    let text;
    try {
      text = readFileSync(join(root, WORKFLOW), 'utf8');
    } catch {
      return {
        level: 'skip',
        detail: 'no workflow in this checkout — the shell question has nothing to ask',
      };
    }
    const found = violationsIn(text);
    if (found.length === 0) {
      return {
        detail: 'every CI step runs one program or command — no verdict rests on a shell feature',
      };
    }
    const first = found[0];
    return {
      level: 'fail',
      detail: `${found.length} CI step${found.length === 1 ? '' : 's'} decide${found.length === 1 ? 's' : ''} something in shell`,
      hint: [
        `${first.job} · ${first.rule} — ${first.source}`,
        'a `run:` block that does more than run one thing makes the step outcome a property of the runner\'s default shell',
        'move the logic into a program under scripts/ with a --self-test mode, and call it: `run: node scripts/your-program.mjs`',
        'a single command per step is fine and should stay that way',
      ],
    };
  },
};

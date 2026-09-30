/**
 * Whether anything still decides event ORDER or event WINDOW membership by
 * comparing `ts` values to each other.
 *
 * The event log is append-only and `id` is the order it was written in. `ts` is
 * a wall-clock reading with millisecond resolution, so several events in one
 * turn routinely share it — the log from a real run of this suite holds
 *
 *   prompt_sent    17:40:12.219Z
 *   tool_call      17:40:12.219Z
 *   tool_call      17:40:12.224Z
 *   agent_response 17:40:12.224Z
 *
 * and two real bugs came out of reading that as an order. The transcript's turn
 * window (`e.ts <= message.ts && e.ts > previousMessage.ts`) dropped every tool
 * call in that shape, so the watch pane rendered a reply with no evidence of
 * the work behind it. The facilitator grid's `agentWorkingForRun` used a strict
 * `e.ts > last.ts`, which on a tie keeps the FIRST of the tied events, so a turn
 * that finished inside one millisecond read as `prompt_sent` and the grid
 * reported a participant whose agent had already answered as still working.
 *
 * Neither failed a test in a way anyone read. The first looked like a flake
 * whose failing set moved between runs; the second had no failing test at all
 * until it was looked for. That is the argument for a check rather than a
 * review habit: the mistake reads as timing, so it survives review, and it is
 * invisible on any machine whose clock happens to tick between events.
 *
 * WHAT IT REFUSES, because the false positive here would be worse than the bug:
 * comparing a `ts` to the CLOCK is not this mistake. `Date.now() - new Date
 * (event.ts)` asks how long ago something happened, which is a wall-clock
 * question that only a wall clock can answer, and the grid's staleness window
 * (a tool_call older than the budget guard is a stalled turn) is correct and
 * must stay. So the rule is narrow: two event timestamps compared to EACH
 * OTHER to decide which came first, or to decide membership of a range. One
 * side being `Date.now()` is the clock, and is left alone.
 *
 * It reads the same way on both sides of a fix, which is what makes the fix
 * reviewable: the check names the line and the id-based form to use instead.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { write } from '../fixture.mjs';

/** Source roots worth reading: the runtime, the routes, and the specs. */
const ROOTS = ['app', 'components', 'delegate/src', 'e2e', 'lib', 'store'];
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js']);

const SOURCE = 'delegate/src/runtime/history.ts';

/** Files that exist to talk ABOUT timestamps rather than order events by them. */
const EXEMPT_FILES = new Set(['test-transcript.ts']);

/**
 * A comparison between two event timestamps.
 *
 * Both sides must be an event's timestamp. One side being the clock means the
 * question is "how long ago", which is legitimate — see the header.
 */
const EVENT_TS = String.raw`(?:\w+)\??\.(?:ts|createdAt)`;

/** `a.ts > b.ts`, `a.ts <= b.ts` — ordering, either direction. */
const ORDERED_BY_TS = new RegExp(
  String.raw`${EVENT_TS}\s*(?:<=|>=|<|>|===|!==)\s*${EVENT_TS}`,
);

/** A membership test: `.ts <= x && x > y` style, or an explicit range filter. */
const WINDOWED_BY_TS = new RegExp(
  String.raw`${EVENT_TS}\s*(?:<=|>=|<|>)\s*(?:\w+)\??\.(?:ts|createdAt)`,
);

/**
 * A sort whose comparator reads a timestamp: ordering by clock rather than by
 * id. The body is matched to the end of the STATEMENT rather than to the first
 * `)`, because a comparator is a nested call — `.sort((a, b) => a.ts.localeCompare(b.ts))`
 * closes a paren before the timestamp is ever reached, and a pattern that stops
 * at the first `)` sees a sort with no timestamp in it.
 */
const SORTED_BY_TS = new RegExp(
  String.raw`\.sort\([^;]*${EVENT_TS}`,
);

/** `a - b` between two timestamps, which is the same mistake in arithmetic. */
const DIFFERENCE_OF_TS = new RegExp(
  String.raw`${EVENT_TS}\s*-\s*(?:\w+)\??\.(?:ts|createdAt)`,
);

const RULES = [
  ['ordered by ts', ORDERED_BY_TS],
  ['windowed by ts', WINDOWED_BY_TS],
  ['sorted by ts', SORTED_BY_TS],
  ['a difference of two ts', DIFFERENCE_OF_TS],
];

/**
 * Lines the check must not read as violations, with the reason each is right.
 * Every one of these is code that ships today, so a rule that flagged them
 * would be a rule nobody would keep.
 */
const ALLOWED = [
  {
    why: 'the clock is one side of it, so it asks how long ago — a wall-clock question',
    line: 'return Date.now() - new Date(last.ts).getTime() < AGENT_STALE_AFTER_MS;',
  },
  {
    why: 'a duration of a turn is measured against the clock, not against another event',
    line: 'const elapsed = Date.now() - startedAt;',
  },
  {
    why: 'an elapsed clock is derived from the clock',
    line: 'setElapsed(Math.floor((Date.now() - startedAt) / 1000));',
  },
  {
    why: 'a toast is seeded into the past to age it, which is the fixture doing the ageing',
    line: '{ id: "t-remaining", kind: "added", star, createdAt: Date.now() - (ms - remaining) },',
  },
];

/** Every source file under the roots, minus the ignored directories. */
function sources(root) {
  const found = [];
  const skip = new Set(['node_modules', '.next', '.next-e2e', 'dist', 'test-results', 'snapshots']);
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
      else if (EXTS.has(full.slice(full.lastIndexOf('.')))) found.push(full);
    }
  };
  for (const name of ROOTS) walk(join(root, name));
  return found;
}

/**
 * Strip comments and string literals, so prose about the bug and a fixture
 * holding a seeded timestamp are not violations of it. `test-transcript.ts` is
 * exempt outright for the same reason: its whole job is to contain the wrong
 * bound and assert that it loses.
 */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/** The violations in one repository, as `path:line  rule  source` rows. */
export function violationsIn(root) {
  const rows = [];
  for (const file of sources(root)) {
    const rel = relative(root, file);
    if (EXEMPT_FILES.has(file.slice(file.lastIndexOf('/') + 1))) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const stripped = code(text);
    stripped.split('\n').forEach((line, index) => {
      // First rule that matches, so one mistake is counted once. `a.ts <= b.ts
      // && a.ts > c` satisfies both the ordering and the windowing patterns, and
      // a count that double-reports the same line would misstate how many
      // places need fixing.
      const hit = RULES.find(([, pattern]) => pattern.test(line));
      if (hit) rows.push({ rel, line: index + 1, rule: hit[0], source: line.trim() });
    });
  }
  return rows;
}

export default {
  name: 'event-windowing',
  order: 45,
  commit: true,
  proof: [
    {
      level: 'pass',
      why: 'a window drawn on ids, which is what the log orders by, is not read as a violation',
      setup: (root) =>
        write(root, SOURCE, 'export const w = (e) => e.id > lowerId && e.id <= upperId;\n'),
    },
    {
      level: 'fail',
      why: 'two event timestamps compared to each other is the mistake, and it reaches a failure',
      setup: (root) => write(root, SOURCE, 'export const w = (e) => e.ts <= message.ts && e.ts > lower;\n'),
    },
    {
      level: 'fail',
      why: 'a strict `>` on a tie keeps the first of the tied events, so ordering by ts is caught too',
      setup: (root) => write(root, SOURCE, 'if (!last || e.ts > last.ts) last = e;\n'),
    },
    {
      level: 'fail',
      why: 'a sort whose key is a timestamp orders the log by the clock, and is caught',
      setup: (root) => write(root, SOURCE, 'return events.sort((a, b) => a.ts.localeCompare(b.ts));\n'),
    },
    {
      level: 'pass',
      why: 'the clock against one ts is a wall-clock question — the staleness window is correct and stays',
      setup: (root) =>
        write(root, SOURCE, 'return Date.now() - new Date(last.ts).getTime() < AGENT_STALE_AFTER_MS;\n'),
    },
    {
      level: 'fail',
      why: 'a difference of two event timestamps is the same mistake in arithmetic, and is caught as one',
      setup: (root) => write(root, SOURCE, 'export const span = (a, b) => a.ts - b.ts;\n'),
    },
    {
      level: 'pass',
      why: 'prose naming the mistake is not the mistake — the gate file itself documents it',
      setup: (root) =>
        write(root, SOURCE, '/** the old bound was e.ts <= message.ts && e.ts > previousMessage.ts */\nexport const w = (e) => e.id;\n'),
    },
    {
      level: 'pass',
      why: "a fixture that seeds a timestamp into the past is ageing it, not ordering by it",
      setup: (root) =>
        write(root, SOURCE, "export const seed = { createdAt: Date.now() - (ms - remaining) };\n"),
    },
  ],
  run(root) {
    const found = violationsIn(root);
    if (found.length === 0) {
      return { detail: 'no event is ordered or windowed by ts — ids decide both' };
    }
    const first = found[0];
    return {
      level: 'fail',
      detail: `${found.length} place${found.length === 1 ? '' : 's'} ${found.length === 1 ? 'decides' : 'decide'} event order or window by ts`,
      // The fix is a one-line change, so the check names it rather than
      // describing it: `id` is the order the append-only log actually has.
      hint: [
        `${first.rel}:${first.line} — ${first.rule}: ${first.source}`,
        'order and window on `id` (see toolCallsForTurn in delegate/src/runtime/history.ts)',
        'a comparison against Date.now() is a wall-clock question and is NOT what this check reports',
      ],
    };
  },
};

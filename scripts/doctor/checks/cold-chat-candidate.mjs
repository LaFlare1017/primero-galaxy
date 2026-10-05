/**
 * Whether the recorded cold-chat candidate on disk is one anybody could promote.
 *
 * `RECORD_TRANSCRIPT=1` writes `e2e/fixtures/cold-chat-transcript.candidate.json`
 * beside the committed fixture, and the recorder never writes the committed one.
 * The candidate is gitignored, which is right — nothing here is meant to be
 * committed without a person reading it first. But that same fact means the file
 * is only ever seen by whoever just recorded it, and the recorder's silence
 * about it is the whole risk: it writes the file, prints a path, and moves on.
 *
 * The property being checked is the one the cold-chat spec exists to protect.
 * That spec proves a restarted server recovered a conversation from the store
 * rather than answering from its own prompt, and it proves it by replaying a
 * transcript matched AGAINST THE REQUEST: the turn carrying the recovered
 * question is served only when that question appears in the body. A turn with
 * no `requires` is served on its own question alone, so it answers identically
 * whether the history came back or was lost — which is exactly the case the
 * spec is written to catch, quietly neutralised.
 *
 * Two warnings, and they are not the same warning:
 *
 *   - `$unproven` is not empty. The recorder lists a turn there when it found
 *     no earlier question in that request's body, so it already knows it cannot
 *     derive a `requires`. This is the recorder admitting the recording was thin.
 *   - A later turn has no `requires`, or names one that is not an earlier turn's
 *     question. Worse, when that turn is NOT in `$unproven`: the file then
 *     claims to be proven and is not, which means it was edited by hand or
 *     `$unproven` was cleared by hand, and the recorder's own admission was the
 *     only thing that would have caught it.
 *
 * The first turn is exempt. `turnsFrom` derives `requires` from an EARLIER
 * question, and turn one has no earlier question, so `turn-1` legitimately
 * carries none and is never listed.
 *
 * NOT checked here, and the reason is worth stating because it reads as an
 * oversight and is not. The COMMITTED fixture (`cold-chat-transcript.json`) has
 * a turn with no `requires` on purpose: its third turn is
 * `cold-without-history`, the fallback that answers when the process did NOT
 * recover the conversation, which is what lets the spec tell recovering from
 * not. Applying this rule to that file would "fix" the one turn it cannot do
 * without. The two files have the same shape and opposite rules, so this check
 * reads only the candidate.
 *
 * Absent is a skip, not a pass: the file is gitignored, so on CI it is never
 * there, and on a machine that has not recorded there is nothing to have an
 * opinion about.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { write } from '../fixture.mjs';

const CANDIDATE = join('e2e', 'fixtures', 'cold-chat-transcript.candidate.json');
const COMMITTED = join('e2e', 'fixtures', 'cold-chat-transcript.json');

/** What a recorded candidate looks like when every turn after the first is sound. */
const PROVEN = { unproven: [], turn3: { requires: 'And what about April?' } };

/**
 * The candidate's shape, or the reason it does not have one.
 *
 * Every refusal here is a failure rather than a warning, because all of them
 * read as healthy to anything that only asks "is `$unproven` empty": a file with
 * no `$unproven` key is a file whose `$unproven` is not empty in the only sense
 * that matters.
 */
function readCandidate(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { error: `it could not be read (${error.code ?? error.message})` };
  }
  let file;
  try {
    file = JSON.parse(text);
  } catch (error) {
    return { error: `it is not JSON (${error.message})` };
  }
  if (file === null || typeof file !== 'object' || Array.isArray(file)) {
    return { error: 'it is JSON, and not a candidate file' };
  }
  if (!Array.isArray(file.$unproven)) {
    return { error: 'it carries no $unproven list, so nothing says which turns could not be proven' };
  }
  if (!Array.isArray(file.turns) || file.turns.length === 0) {
    return { error: 'it carries no turns, and the recorder refuses to write one that has none' };
  }
  for (const turn of file.turns) {
    if (turn === null || typeof turn !== 'object' || typeof turn.when !== 'string' || turn.when === '') {
      return { error: 'a turn has no `when`, so no later turn can require it' };
    }
  }
  return { file };
}

/**
 * Why a later turn cannot prove it depends on the conversation, or null.
 *
 * `before` is the questions asked SO FAR. Reading it from the array being
 * walked is what makes an unsatisfiable requirement detectable: a `requires`
 * naming a LATER turn's question is as broken as one naming nothing, because it
 * can never be present in the body when that turn is served.
 */
function requiresFault(turn, before) {
  if (turn.requires === undefined) return 'carries no `requires`';
  if (!before.includes(turn.requires)) return 'requires a question no earlier turn asked';
  return null;
}

export default {
  name: 'cold-chat-candidate',
  order: 90,
  proof: [
    {
      level: 'skip',
      why: 'no candidate on disk — the normal state, since recording is opt-in and the file is gitignored',
      setup: (root) => committedOnly(root),
    },
    {
      level: 'pass',
      why: 'every turn after the first requires an earlier turn\u2019s question and $unproven is empty \u2014 a candidate somebody could promote',
      setup: (root) => candidate(root, PROVEN),
    },
    {
      level: 'warn',
      why: '$unproven is not empty, so the recorder already knew a turn could not be proven',
      setup: (root) => candidate(root, { ...PROVEN, unproven: ['turn-2'] }),
    },
    {
      level: 'warn',
      why: 'a later turn carries no `requires` while $unproven is empty \u2014 the file claims to be proven and is not',
      setup: (root) => candidate(root, { ...PROVEN, turn3: { requires: undefined } }),
    },
    {
      level: 'warn',
      why: 'a later turn requires a question no earlier turn asked, so the requirement can never be met and the turn answers either way',
      setup: (root) => candidate(root, { ...PROVEN, turn3: { requires: 'a question nobody asked' } }),
    },
    {
      level: 'fail',
      why: 'the candidate is not JSON, which is the check unable to look rather than a candidate that is fine',
      setup: (root) => write(root, CANDIDATE, 'not json at all\n'),
    },
    {
      level: 'fail',
      why: 'the candidate is JSON with no $unproven \u2014 the shape a hand-made file has, and one whose $unproven reads as empty',
      setup: (root) => write(root, CANDIDATE, `${JSON.stringify({ turns: [{ id: 'turn-1', when: 'hi' }] }, null, 2)}\n`),
    },
    {
      level: 'fail',
      why: 'the candidate has turns but none of them a `when`, so nothing can require anything',
      setup: (root) => write(root, CANDIDATE, `${JSON.stringify({ $unproven: [], turns: [{ id: 'turn-1' }] }, null, 2)}\n`),
    },
    {
      level: 'fail',
      why: 'the candidate is an empty object \u2014 which is what the file in this checkout was, and what a recorder would never write',
      setup: (root) => write(root, CANDIDATE, '{}\n'),
    },
  ],

  run(root) {
    const path = join(root, CANDIDATE);
    if (!existsSync(path)) {
      return {
        level: 'skip',
        detail: 'no recorded candidate \u2014 RECORD_TRANSCRIPT=1 writes one, and a person reads it before promoting it',
      };
    }

    const read = readCandidate(path);
    if (read.error !== undefined) {
      return {
        level: 'fail',
        detail: `the recorded candidate is not one this check can read \u2014 ${read.error}`,
        hint: [
          'an unreadable candidate is worse than none: it sits where the next recording overwrites it, looking like one',
          'RECORD_TRANSCRIPT=1 rewrites it from a real run',
        ],
      };
    }

    const { turns, $unproven: unproven } = read.file;
    const faults = [];
    const questions = [];
    turns.forEach((turn, at) => {
      const fault = at === 0 ? null : requiresFault(turn, questions);
      if (fault !== null) {
        faults.push({
          id: typeof turn.id === 'string' ? turn.id : `turn ${at + 1}`,
          why: fault,
          listed: unproven.includes(turn.id),
        });
      }
      questions.push(turn.when);
    });

    if (faults.length === 0 && unproven.length === 0) {
      return {
        detail: `the recorded candidate is promotable \u2014 ${turns.length} turns, each after the first requiring an earlier question`,
      };
    }

    const named = faults.map((fault) => `${fault.id} (${fault.why})`).join('; ');
    const detail =
      faults.length === 0
        ? `$unproven names ${unproven.join(', ')} \u2014 the recorder could not derive what those turns depend on`
        : `${faults.length} of the ${turns.length} recorded turns cannot prove they depend on the conversation: ${named}`;

    const unlisted = faults.filter((fault) => !fault.listed);
    return {
      level: 'warn',
      detail,
      hint: [
        unlisted.length > 0
          ? `${unlisted.map((fault) => fault.id).join(', ')} ${unlisted.length === 1 ? 'is' : 'are'} absent from $unproven, so the file claims to be proven and is not \u2014 it was edited after the recorder wrote it`
          : null,
        unproven.length > 0 ? `$unproven: ${unproven.join(', ')}` : null,
        'a turn with no `requires` is served on its own question, so it answers identically whether the restarted process recovered the conversation or lost it',
        'RECORD_TRANSCRIPT=1 rewrites the candidate from a real run; promoting one is a person\u2019s decision, not this check\u2019s',
      ].filter((line) => line !== null),
    };
  },
};

/** A repository that has the committed fixture and has recorded nothing. */
function committedOnly(root) {
  write(root, COMMITTED, `${JSON.stringify({ $note: 'the committed one', turns: [{ id: 'warm', when: 'Reconcile the March operating bank account', hops: [] }] }, null, 2)}\n`);
}

/** A three-turn candidate at the given shape, beside a committed fixture. */
function candidate(root, { unproven = [], turn3 = {} }) {
  committedOnly(root);
  const first = 'Reconcile the March operating bank account';
  const second = 'And what about April?';
  const hop = [{ content: [], stop_reason: 'end_turn' }];
  const file = {
    $note: 'a CANDIDATE, recorded from a live model.',
    $unproven: unproven,
    $recordedAt: '2026-01-01T00:00:00.000Z',
    turns: [
      { id: 'turn-1', when: first, hops: hop },
      { id: 'turn-2', when: second, requires: first, hops: hop },
      { id: 'turn-3', when: 'Summarise both', ...turn3, hops: hop },
    ],
  };
  write(root, CANDIDATE, `${JSON.stringify(file, null, 2)}\n`);
}
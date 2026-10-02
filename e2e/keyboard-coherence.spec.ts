import { expect, test } from './worker-server';

import {
  UNGATED,
  agreement,
  coherence,
  reachableWorlds,
  standingDown,
  type CoherenceReport,
  type KeyboardChord,
  type KeyboardManifest,
  type KeyboardRow,
  type NamedDeclaration,
} from './keyboard-coherence';

/**
 * The declaration harness, on a manifest of its own.
 *
 * The console's spec (delegate-shortcuts.spec.ts) uses this harness against
 * the console. That proves the harness fits the console; it cannot prove the
 * harness fits anything else, and it cannot prove some of the checks work at
 * all — two readers built from one predicate agree even when the predicate is
 * the thing that is wrong, so a set comparison between them can never fail on
 * the console's module and has to be exercised somewhere it CAN.
 *
 * So this file declares a second, deliberately tiny keyboard — five rows, one
 * chord, one advertising surface, three gates — and runs both directions:
 * coherent, where every list in the report has to be empty, and broken
 * nineteen ways, where each list has to name what went wrong. The
 * readers below are a minimal reference implementation rather than a second
 * copy of the console's: enough to answer the harness's questions and no more,
 * which is exactly what a manifest hands over in practice.
 *
 * The third check is about a PAIR of declarations rather than about one, so it
 * is exercised on a pair of its own — the shape of the real one, the console's
 * global row beside the palette's — coherent in one case and broken seven ways,
 * including the disagreement that actually existed: a chord declared with one
 * of its two platform spellings.
 *
 * It runs in node, like the harness: no page, no DOM, no fixtures.
 */

interface FakeState {
  /** The rows the walk can move through. */
  room: readonly string[];
  panel: boolean;
  /** The row a cursor action would act on, by index. */
  cursor: number | null;
}

/** The fake's gates as a plain record: the harness never needs their names. */
type FakeGates = Record<string, boolean>;

type FakeManifest = KeyboardManifest<KeyboardRow, KeyboardChord, FakeGates, FakeState>;

const FAKE_ROWS: readonly KeyboardRow[] = [
  { id: 'next', keys: ['j'], gate: 'walk', mount: 'map' },
  { id: 'open', keys: ['o'], gate: 'link', mount: 'map' },
  { id: 'close', keys: ['Escape'], gate: 'panel', mount: 'layer' },
  { id: 'dismiss', keys: ['Escape'], gate: UNGATED, mount: 'primitive' },
  { id: 'palette', keys: ['Meta+k'], gate: UNGATED, mount: 'global' },
];

const FAKE_CHORDS: readonly KeyboardChord[] = [{ id: 'jump', keys: 'g j', gate: 'walk' }];

/**
 * A LADDER of page-level bindings, which is the other shape `under` has to
 * carry: three rows on one dismissal key, each answering only while every rung
 * above it is shut. Their gates are deliberately independent of the fake's
 * other three, so that each element of the bottom rung's list is the one doing
 * the work in some reachable state — a ladder whose second element never
 * mattered would prove nothing about either.
 */
const LADDER_ROWS: readonly KeyboardRow[] = [
  { id: 'ladder-top', keys: ['Escape'], gate: 'search', mount: 'global' },
  { id: 'ladder-middle', keys: ['Escape'], gate: 'form', mount: 'global', under: 'search' },
  {
    id: 'ladder-bottom',
    keys: ['Escape'],
    gate: 'selection',
    mount: 'global',
    under: ['search', 'form'],
  },
];

const LADDER_GATES = (state: FakeState): FakeGates => ({
  ...fakeGates(state),
  search: state.panel,
  form: state.cursor !== null,
  selection: state.room.length > 0,
});

function fakeGates(state: FakeState): FakeGates {
  return { walk: state.room.length > 0, panel: state.panel, link: state.cursor !== null };
}

function fakeGateIsLive(gate: string, gates: FakeGates): boolean {
  return gate === UNGATED || gates[gate] === true;
}

function fakeRowIsLive(row: KeyboardRow, gates: FakeGates): boolean {
  if (!fakeGateIsLive(row.gate, gates)) return false;
  if (standingDown(row).some((gate) => fakeGateIsLive(gate, gates))) return false;
  return true;
}

/**
 * The readers, built from the declaration they belong to — as a module's are.
 * A reader that reached for the base rows instead would keep answering for a
 * manifest it was not given, which is the one mistake a fake like this can
 * make and still look like it works.
 */
function readersFor(
  rows: readonly KeyboardRow[],
  chords: readonly KeyboardChord[],
): Omit<FakeManifest, 'rows' | 'chords' | 'surfaces' | 'gates'> {
  const rowById = new Map(rows.map((row) => [row.id, row] as const));
  return {
    gateIsLive: fakeGateIsLive,
    rowIsLive: fakeRowIsLive,
    layerIsLive: (id, gates) => {
      const row = rowById.get(id);
      return row !== undefined && row.mount === 'layer' && fakeRowIsLive(row, gates);
    },
    liveKeyMap: (gates, _held, handlers) => {
      const map: Record<string, () => void> = {};
      for (const row of rows) {
        if (row.mount !== 'map' || !fakeRowIsLive(row, gates)) continue;
        for (const key of row.keys) {
          const handler = handlers[row.id]?.[key];
          if (handler !== undefined) map[key] = handler;
        }
      }
      return map;
    },
    liveChordMap: (gates, runs) => {
      const map: Record<string, () => void> = {};
      for (const chord of chords) {
        const run = runs[chord.id];
        if (run !== undefined && fakeGateIsLive(chord.gate, gates)) map[chord.keys] = run;
      }
      return map;
    },
    armedChords: (prefix, gates, runs) =>
      chords.filter(
        (chord) =>
          fakeGateIsLive(chord.gate, gates) &&
          runs[chord.id] !== undefined &&
          chord.keys.startsWith(`${prefix} `),
      ),
    liveShortcuts: (ids, gates, _held) =>
      ids
        .flatMap((id) => {
          const row = rowById.get(id);
          return row === undefined ? [] : row.keys.filter(() => fakeRowIsLive(row, gates));
        })
        .join(' '),
  };
}

function fake(overrides: Partial<FakeManifest> = {}): FakeManifest {
  const rows = overrides.rows ?? FAKE_ROWS;
  const chords = overrides.chords ?? FAKE_CHORDS;
  return {
    surfaces: { list: ['next', 'open', 'close'] },
    gates: fakeGates,
    ...readersFor(rows, chords),
    rows,
    chords,
    ...overrides,
  };
}

/**
 * The fake's own worlds, enumerated the way a manifest's spec would: the
 * facts are the room, the panel and the cursor INDEX, and `accept` is both the
 * invariant and the derivation — a cursor exists only in a non-empty room, and
 * never past its end. Three room sizes x two panel states x three cursors is
 * eighteen combinations, twelve of which are reachable, which is the point:
 * the filter has to be the thing that decides.
 */
const FAKE_WORLDS = reachableWorlds<FakeState>(
  { room: [[], ['a'], ['a', 'b']], panel: [false, true], cursor: [null, 0, 1] },
  ({ room, panel, cursor }) => {
    if (!Array.isArray(room) || typeof panel !== 'boolean') return null;
    if (cursor !== null && typeof cursor !== 'number') return null;
    if (room.length === 0 && cursor !== null) return null;
    if (cursor !== null && cursor >= room.length) return null;
    return { room: [...room], panel, cursor };
  },
);

const FAKE_OPTIONS = { allowedSharedKeys: ['Escape'], behaviour: { withheld: ['jump'] } };

/** Every violation, whichever list it landed in. */
function allViolations(report: CoherenceReport): string[] {
  return [
    ...report.collisions,
    ...report.gates.unreachable,
    ...report.gates.unread,
    ...report.gates.bogus,
    ...report.namespace,
    ...report.claims,
    ...report.unimplemented,
    ...report.structure,
  ];
}

test.describe('keyboard declaration harness', () => {
  test('enumerates every combination of the facts, and only the reachable ones', () => {
    // The product is the harness's; which combinations are REAL is the
    // manifest's. Eighteen candidates, twelve states — and the count is what
    // says the filter ran rather than that the product happened to be small.
    expect(FAKE_WORLDS).toHaveLength(12);
    expect(
      FAKE_WORLDS.filter((world) => world.state.room.length === 0).every(
        (world) => world.state.cursor === null,
      ),
    ).toBe(true);
    expect(
      FAKE_WORLDS.every(
        (world) => world.state.cursor === null || world.state.cursor < world.state.room.length,
      ),
    ).toBe(true);
    // Every accepted combination is present exactly once: a world dropped
    // twice, or invented, would skew every check built on the set.
    expect(new Set(FAKE_WORLDS.map((world) => world.label)).size).toBe(FAKE_WORLDS.length);
    expect(
      FAKE_WORLDS.some(
        (world) => world.label.includes('room=[a,b]') && world.label.includes('panel=true'),
      ),
    ).toBe(true);

    // A label of the caller's own replaces the generated one, because those
    // labels are where a failure's explanation comes from.
    const labelled = reachableWorlds<FakeState>(
      { room: [[]], panel: [false], cursor: [null] },
      () => ({ room: [], panel: false, cursor: null }),
      (state) => `an empty room, panel ${state.panel ? 'open' : 'shut'}`,
    );
    expect(labelled.map((world) => world.label)).toEqual(['an empty room, panel shut']);
  });

  test('a coherent manifest reports nothing', () => {
    const report = coherence(fake(), FAKE_WORLDS, FAKE_OPTIONS);

    expect(report.worlds).toBe(12);
    expect(report.surfaces).toEqual(['list']);
    // Escape is claimed by a layer row AND by the primitive row, which is the
    // one overlap the caller allows — and the report still says so, so a spec
    // can pin the exact set instead of trusting the allowance.
    expect(report.sharedKeys).toEqual(['Escape']);
    expect(allViolations(report), 'a coherent declaration reports no violations').toEqual([]);
    expect(report.gates).toEqual({ unreachable: [], unread: [], bogus: [] });
  });

  test('a check that walks no state says so instead of passing', () => {
    // The failure mode every enumerated check has: an enumeration that came
    // back empty makes each assertion vacuously true, and the guard reads
    // green while checking nothing. This is the one violation that is about
    // the check rather than about the declaration.
    const report = coherence(fake(), [], FAKE_OPTIONS);
    expect(report.worlds).toBe(0);
    expect(report.structure.join(' ')).toContain('cannot fail');
    expect(allViolations(report)).toHaveLength(1);
  });

  test('reports each way a declaration can be incoherent, and where', () => {
    // Each case is ONE mutation of the coherent fake, and the assertion names
    // the list it has to land in — because these fail for different reasons,
    // and a check that only knew "something is wrong" would be no use to the
    // person who has to fix it.
    const broken: Array<{
      label: string;
      build: () => FakeManifest;
      pick: (report: CoherenceReport) => string[];
      expect: string;
      why: string;
    }> = [
      {
        label: 'two map rows on one key',
        build: () =>
          fake({ rows: FAKE_ROWS.map((row) => (row.id === 'open' ? { ...row, keys: ['j'] } : row)) }),
        pick: (report) => report.collisions,
        expect: 'the key map binds j to next and open at once',
        why: 'the later row would simply win while the sheet went on documenting both',
      },
      {
        label: 'two layers on one key',
        build: () =>
          fake({
            rows: [...FAKE_ROWS, { id: 'other-close', keys: ['Escape'], gate: 'walk', mount: 'layer' }],
          }),
        pick: (report) => report.collisions,
        expect: 'two layers both answer Escape',
        why: 'one press would close two things, which is what `under` exists to prevent',
      },
      {
        label: 'a key shared across mounts that the caller did not allow',
        build: () =>
          fake({
            rows: [...FAKE_ROWS, { id: 'other-global', keys: ['j'], gate: UNGATED, mount: 'global' }],
          }),
        pick: (report) => report.collisions,
        expect: 'claimed both by a console binding and by a row the console does not mount',
        why: 'a component elsewhere answering the walk key is a collision, not a layer',
      },
      {
        label: 'a gate no state can satisfy',
        build: () => fake({ gates: (state) => ({ ...fakeGates(state), walk: false }) }),
        pick: (report) => report.gates.unreachable,
        expect: 'walk',
        why: 'a documented key nobody can ever press',
      },
      {
        label: 'a gate nothing reads',
        build: () => fake({ gates: (state) => ({ ...fakeGates(state), orphan: true }) }),
        pick: (report) => report.gates.unread,
        expect: 'orphan',
        why: 'a name with no meaning, which the sheet cannot show either',
      },
      {
        label: 'a binding naming a gate that is not declared',
        build: () =>
          fake({ rows: FAKE_ROWS.map((row) => (row.id === 'open' ? { ...row, gate: 'nowhere' } : row)) }),
        pick: (report) => report.gates.bogus,
        expect: 'nowhere',
        why: 'a typo here is a binding that is never live and never explains why',
      },
      {
        label: 'a rung of a ladder standing down for a gate that is not declared',
        build: () =>
          fake({
            rows: [
              ...FAKE_ROWS,
              ...LADDER_ROWS.map((row) =>
                row.id === 'ladder-bottom' ? { ...row, under: ['walk', 'nowhere'] } : row,
              ),
            ],
            gates: LADDER_GATES,
          }),
        pick: (report) => report.gates.bogus,
        expect: 'nowhere',
        why: 'a ladder element is a gate name like any other, and a typo in the middle of one is invisible',
      },
      {
        label: 'a surface advertising a key it does not mount',
        build: () => fake({ liveShortcuts: () => 'j o' }),
        pick: (report) => report.claims,
        expect: 'advertises [j o] but the console mounts',
        why: 'an aria string is a claim about the element it sits on',
      },
      {
        label: 'a single key that also opens a chord namespace',
        build: () =>
          fake({
            rows: FAKE_ROWS.map((row) => (row.id === 'next' ? { ...row, keys: ['j', 'g'] } : row)),
          }),
        pick: (report) => report.namespace,
        expect: 'bound as a single key AND opens a chord namespace',
        why: 'one press cannot both arm a prefix and fire a command',
      },
      {
        label: 'a chord that is a prefix of another',
        build: () => fake({ chords: [...FAKE_CHORDS, { id: 'jump-far', keys: 'g j x', gate: 'walk' }] }),
        pick: (report) => report.namespace,
        expect: 'is a prefix of another chord',
        why: 'the shorter chord would fire before the longer one could complete',
      },
      {
        label: 'a surface naming a row it does not bind',
        build: () => fake({ surfaces: { list: ['next', 'dismiss'] } }),
        pick: (report) => report.structure,
        expect: 'which the console does not mount (primitive)',
        why: "an overlay's own dismissal is not this surface's to advertise",
      },
      {
        label: 'a surface naming a row that does not exist',
        build: () => fake({ surfaces: { list: ['next', 'ghost-row'] } }),
        pick: (report) => report.structure,
        expect: 'names no declared row (ghost-row)',
        why: 'a renamed row has to break its spec rather than quietly stop being checked',
      },
      {
        label: 'a surface that claims no rows at all',
        build: () => fake({ surfaces: { list: [] } }),
        pick: (report) => report.structure,
        expect: 'claims no rows',
        why: 'an attribute nobody writes is the silence this whole check exists to prevent',
      },
      {
        label: 'a surface listing one row twice',
        build: () => fake({ surfaces: { list: ['next', 'open', 'next'] } }),
        pick: (report) => report.structure,
        expect: 'lists next twice',
        why: 'a row counted twice is also its keys counted twice',
      },
      {
        label: 'two rows sharing an id',
        build: () =>
          fake({ rows: [...FAKE_ROWS, { id: 'next', keys: ['n'], gate: 'walk', mount: 'map' }] }),
        pick: (report) => report.structure,
        expect: 'two rows share the id next',
        why: 'behaviour is keyed by id, so the duplicate silently borrows the other one',
      },
      {
        label: 'two chords sharing an id',
        build: () => fake({ chords: [...FAKE_CHORDS, { id: 'jump', keys: 'g k', gate: 'walk' }] }),
        pick: (report) => report.structure,
        expect: 'two chords share the id jump',
        why: 'same keying, and the second chord would run the first one',
      },
      {
        label: 'a chord that is not a prefix and one key',
        build: () => fake({ chords: [{ id: 'jump', keys: 'g j x', gate: 'walk' }] }),
        pick: (report) => report.structure,
        expect: 'which is not a prefix key and the key that completes it',
        why: 'the hook and the chip both spell a chord as a prefix plus one completing key',
      },
      {
        label: 'the chip offering a chord the page cannot run',
        build: () =>
          fake({
            // The bug a shared predicate cannot see: the menu stops asking
            // about behaviour, and the agreement check below cannot catch it,
            // because both readers are built from that same answer.
            armedChords: (prefix, gates) =>
              FAKE_CHORDS.filter(
                (chord) => fakeGateIsLive(chord.gate, gates) && chord.keys.startsWith(`${prefix} `),
              ),
          }),
        pick: (report) => report.unimplemented,
        expect: 'the chip offers g j',
        why: 'a menu that shows a dead destination is teaching a key that does nothing',
      },
      {
        label: "the hook's map keeping a chord the page cannot run",
        build: () =>
          fake({
            liveChordMap: (gates) => {
              const map: Record<string, () => void> = {};
              for (const chord of FAKE_CHORDS) {
                if (fakeGateIsLive(chord.gate, gates)) map[chord.keys] = () => undefined;
              }
              return map;
            },
          }),
        pick: (report) => report.unimplemented,
        expect: "the hook's map keeps g j",
        why: 'a mounted binding with nothing behind it is the same lie in another costume',
      },
      {
        label: 'a yield on a row the key map does not mount',
        build: () =>
          fake({
            rows: FAKE_ROWS.map((row) =>
              row.id === 'close' ? { ...row, yieldKeys: ['Escape'] } : row,
            ),
          }),
        pick: (report) => report.structure,
        expect: 'stands a key down but is not mounted in the key map',
        why: 'only a key map row holds the keyboard, so nothing else has a key to stand down',
      },
      {
        label: 'a yield naming a key the row does not bind',
        build: () =>
          fake({ rows: FAKE_ROWS.map((row) => (row.id === 'next' ? { ...row, yieldKeys: ['k'] } : row)) }),
        pick: (report) => report.structure,
        expect: 'stands down k, which it does not bind',
        why: 'a yield is a per-key courtesy about a key the row actually declares',
      },
    ];

    for (const item of broken) {
      const report = coherence(item.build(), FAKE_WORLDS, FAKE_OPTIONS);
      expect(item.pick(report).join(' | '), `${item.label}: ${item.why}`).toContain(item.expect);
    }
  });

  test('two rows the page binds itself may share one key only where the state keeps them apart', () => {
    // The page's own listeners are the one mechanism with no order to them: a
    // component elsewhere answering a key is whichever listener the browser
    // registered second, and no layer stack can separate them, because neither
    // row is mounted by anything. So the declaration has to say it instead —
    // and `under` is the whole vocabulary for saying it, here as a LADDER
    // rather than the pair a two-layer stack needs.
    const ladder = fake({ rows: [...FAKE_ROWS, ...LADDER_ROWS], gates: LADDER_GATES });

    expect(
      coherence(ladder, FAKE_WORLDS, FAKE_OPTIONS).collisions,
      'one dismissal key claimed by three rungs is coherent while each rung answers alone',
    ).toEqual([]);

    // The middle rung's `under` and the bottom rung's list are each load-
    // bearing, so each is dropped in turn. Both failures name the two rows that
    // would answer one press, because that is what a reader has to go and fix.
    const withoutMiddle = fake({
      rows: [...FAKE_ROWS, ...LADDER_ROWS.map((row) => (row.id === 'ladder-middle' ? { ...row, under: undefined } : row))],
      gates: LADDER_GATES,
    });
    expect(
      coherence(withoutMiddle, FAKE_WORLDS, FAKE_OPTIONS).collisions.join(' | '),
      'a rung that stopped standing down for the one above it would answer the same press',
    ).toContain('two rows the page binds itself both answer Escape (ladder-top and ladder-middle)');

    const withoutTopRungElement = fake({
      rows: [
        ...FAKE_ROWS,
        ...LADDER_ROWS.map((row) =>
          row.id === 'ladder-bottom' ? { ...row, under: ['form'] } : row,
        ),
      ],
      gates: LADDER_GATES,
    });
    expect(
      coherence(withoutTopRungElement, FAKE_WORLDS, FAKE_OPTIONS).collisions.join(' | '),
      'the first element of a ladder list is not decoration: it keeps the bottom rung off the top one',
    ).toContain('two rows the page binds itself both answer Escape (ladder-top and ladder-bottom)');

    // And the array is read as a list, not as one name: `standingDown` is what
    // every reader of `under` — the harness's gate bookkeeping, a manifest's own
    // `rowIsLive` — is built from, so a rung cannot stand down for a pair in one
    // reader and for the first string in another.
    expect(standingDown(LADDER_ROWS[2]), 'a rung stands down for every gate it names').toEqual([
      'search',
      'form',
    ]);
    expect(standingDown(LADDER_ROWS[0]), 'a rung with nothing above it stands down for nothing').toEqual(
      [],
    );
  });

  test('two declarations describing one binding have to describe it the same way', () => {
    // The check that needs no state and no readers: two rows, one binding, and
    // whether they say the same thing about it. The pair below is deliberately
    // the shape of the real one — the console documents a global key the
    // palette binds — including the one difference that is NOT a disagreement:
    // the left declares its two spellings in the other order, because the order
    // a surface lists alternatives in is a rendering choice.
    const left: NamedDeclaration = {
      name: 'the console',
      rows: [{ id: 'open-palette', keys: ['Control+k', 'Meta+k'], gate: UNGATED, mount: 'global' }],
    };
    const right: NamedDeclaration = {
      name: 'the palette',
      rows: [{ id: 'toggle-palette', keys: ['Meta+k', 'Control+k'], gate: UNGATED, mount: 'global' }],
    };
    const pairs = [{ left: 'open-palette', right: 'toggle-palette' }];
    const withRow = (row: Partial<KeyboardRow>): NamedDeclaration => ({
      ...right,
      rows: [{ ...right.rows[0], ...row }],
    });

    expect(agreement(left, right, pairs), 'one binding, spelled in another order, is agreed about').toEqual(
      [],
    );

    const broken: Array<{
      label: string;
      left?: NamedDeclaration;
      right?: NamedDeclaration;
      pairs?: typeof pairs;
      expect: string;
      why: string;
    }> = [
      {
        label: 'one declaration names one spelling of a two-platform chord',
        left: { ...left, rows: [{ ...left.rows[0], keys: ['Meta+k'] }] },
        expect: 'different keys ([Meta+k] and [Control+k Meta+k])',
        why: 'a surface documenting a key it does not bind would teach a PC user only half of it',
      },
      {
        label: 'the same binding under two different gates',
        right: withRow({ gate: 'panel' }),
        expect: 'different gate ([always] and [panel])',
        why: 'one of them would be documenting a key that is not there when the other is',
      },
      {
        label: 'the same binding standing down for another',
        right: withRow({ under: 'panel' }),
        expect: 'different under ([nothing] and [panel])',
        why: 'the two would disagree about when the binding answers at all',
      },
      {
        label: 'the same binding mounted differently',
        right: withRow({ mount: 'map' }),
        expect: 'different mount ([global] and [map])',
        why: 'a documented binding and a bound one are different claims about who answers',
      },
      {
        label: 'the same binding yielding different keys',
        right: withRow({ yieldKeys: ['k'] }),
        expect: 'different yieldKeys ([] and [k])',
        why: 'a yield is part of the binding: who keeps the key while a control holds it',
      },
      {
        label: 'a pair naming a row that does not exist',
        pairs: [{ left: 'open-palette', right: 'toggle-palette-x' }],
        expect: 'the palette declares no row toggle-palette-x',
        why: 'a renamed row has to break its spec rather than quietly pair with nothing',
      },
      {
        label: 'a pairing that names no bindings at all',
        pairs: [],
        expect: 'a check that compares nothing cannot fail',
        why: 'the same guard the enumeration has: a comparison of nothing reads green',
      },
    ];

    for (const item of broken) {
      expect(
        agreement(item.left ?? left, item.right ?? right, item.pairs ?? pairs).join(' | '),
        `${item.label}: ${item.why}`,
      ).toContain(item.expect);
    }
  });
});

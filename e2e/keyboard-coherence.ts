/**
 * The keyboard-declaration harness.
 *
 * A surface that declares its keyboard in one place — as the facilitator
 * console does (components/delegate/consoleShortcuts.ts) — is making two
 * promises, and both are properties of the DECLARATION rather than of that
 * console:
 *
 *   1. The declaration agrees with itself. No reachable state lets two live
 *      bindings answer to one key (on any of the four surfaces a key can
 *      arrive through: the single key map, the ordered layers, the page's own
 *      listeners, the chord namespace), and no gate is declared that no real
 *      state can reach or no binding reads.
 *   2. The declaration agrees with what each surface SAYS. An
 *      `aria-keyshortcuts` string and an armed-chord menu are claims about
 *      what is bound, so each has to equal what is actually bound — an
 *      advertised key that does nothing is the failure this whole design
 *      exists to make impossible, and in front of assistive tech it is worse
 *      than silence.
 *
 *   3. A binding TWO declarations describe is described the same way by both.
 *      A key owned by a component elsewhere is declared twice — once by the
 *      surface that binds it, once by a surface that only documents it — and
 *      neither declaration can see the other, so one of them can be wrong for
 *      as long as nobody asks.
 *
 * The first two are properties of one manifest and the third is a property of
 * a pair, but all three are things a declaration can be checked for, so they
 * live here rather than inside the one spec that first needed them. A manifest is data plus the
 * READERS that interpret it, handed over as they are, so the checks run the
 * shipped code rather than a second copy of it. What this file cannot know is
 * what a state of YOUR surface can be — that is the manifest's own business,
 * and `reachableWorlds` below is the part that is not: the cross product of
 * the facts you declare, filtered to the combinations your invariants allow.
 *
 * Everything here is a pure function over plain data: no Playwright, no DOM,
 * no imports. A manifest's spec can therefore run it in node, which is where
 * a declaration belongs — the one piece of keyboard behaviour that needs a
 * real browser (the ignore-guards in components/delegate/shortcuts.ts) is
 * checked in a browser instead.
 *
 * What it deliberately does not check: that the page IMPLEMENTS the
 * declaration. Here the page is assumed to implement all of it, and a binding
 * it does not is simulated through `withheld` to prove nothing keeps or offers
 * a dead key. That every declared binding really does something is the other
 * half, asked by e2e/facilitator-keys.spec.ts, which presses them all.
 */

/** A single-key binding, as a manifest declares it. */
export interface KeyboardRow {
  id: string;
  /** The keys one row answers to. More than one is normal (`Enter` and `w`). */
  keys: readonly string[];
  /** The gate this row is mounted on, or `UNGATED`. */
  gate: string;
  /**
   * The gate that stands this row down — what stacks two layers on one key, or
   * orders a ladder of them. More than one is the ladder's case: a dismissal
   * chain means "every overlay above me is shut", which is a list of gates
   * rather than the one the pairwise stack needs.
   */
  under?: string | readonly string[];
  mount: KeyboardMount;
  /** Keys this row stands down while one of the console's own controls holds the keyboard. */
  yieldKeys?: readonly string[];
}

/** How a row answers: through the key map, as a layer, or as a component elsewhere. */
export type KeyboardMount = 'map' | 'layer' | 'primitive' | 'global';

/** A chord: a prefix key and the key that completes it, space-joined. */
export interface KeyboardChord {
  id: string;
  /** `'g i'` — the sequence hook's own spelling. */
  keys: string;
  gate: string;
}

/** The manifest's standing excuse for a binding that is always available. */
export const UNGATED = 'always';

/**
 * The gates a row stands down for, as a list. Absent reads as none, and one
 * gate reads as itself, so a declaration that needs no ladder writes no array.
 */
export function standingDown(row: KeyboardRow): readonly string[] {
  if (row.under === undefined) return [];
  return typeof row.under === 'string' ? [row.under] : row.under;
}

/** Whether one of the console's own controls is holding the keyboard. */
export interface Held {
  ownControlFocused: boolean;
}

/** Behaviour for every key of every row, keyed by row id then by key. */
export type Handlers = Record<string, Record<string, () => void>>;

/** Behaviour for every chord, keyed by chord id. Absent means unimplemented. */
export type Runs = Record<string, (() => void) | undefined>;

/**
 * A manifest, as the harness needs to read it: the declaration, plus the
 * module's own readers lifted out unchanged. Generic over the manifest's
 * types so a module passes its own functions without rewriting them — the
 * harness asks the questions, the manifest answers them.
 */
export interface KeyboardManifest<
  Row extends KeyboardRow,
  Chord extends KeyboardChord,
  Gates extends object,
  State,
> {
  rows: readonly Row[];
  chords: readonly Chord[];
  /** Which rows each advertising surface claims, by surface id. */
  surfaces: Readonly<Record<string, readonly string[]>>;
  gates: (state: State) => Gates;
  gateIsLive: (gate: string, gates: Gates) => boolean;
  rowIsLive: (row: Row, gates: Gates) => boolean;
  layerIsLive: (id: string, gates: Gates) => boolean;
  liveKeyMap: (gates: Gates, held: Held, handlers: Handlers) => Record<string, () => void>;
  liveChordMap: (gates: Gates, runs: Runs) => Record<string, () => void>;
  armedChords: (prefix: string, gates: Gates, runs: Runs) => readonly Chord[];
  liveShortcuts: (ids: readonly string[], gates: Gates, held?: Held) => string;
}

/** A state the surface can actually be in, labelled for failure messages. */
export interface World<State> {
  label: string;
  state: State;
}

/** What one independent fact of a state can be. */
export type WorldFact = string | number | boolean | null | readonly string[];

/**
 * Every state the declared facts can produce that the invariants allow.
 *
 * The facts are the inputs that vary INDEPENDENTLY — the room, what is
 * watched, whether a panel is open — and `accept` is both the invariant and
 * the derivation: it turns a candidate combination into a real state, or
 * returns null for the combinations that cannot happen. That distinction is
 * the one thing an enumerator cannot guess, and it matters: a guard that
 * counted impossible combinations would happily accept a gate that is only
 * ever true somewhere the surface cannot be.
 */
export function reachableWorlds<State>(
  facts: Readonly<Record<string, readonly WorldFact[]>>,
  accept: (candidate: Readonly<Record<string, WorldFact>>) => State | null,
  label?: (state: State) => string,
): Array<World<State>> {
  const names = Object.keys(facts);
  const worlds: Array<World<State>> = [];
  const walk = (index: number, candidate: Record<string, WorldFact>): void => {
    if (index === names.length) {
      const state = accept(candidate);
      if (state === null) return;
      worlds.push({ label: label?.(state) ?? describeFacts(names, candidate), state });
      return;
    }
    const name = names[index];
    for (const value of facts[name]) walk(index + 1, { ...candidate, [name]: value });
  };
  walk(0, {});
  return worlds;
}

function describeFacts(names: readonly string[], candidate: Readonly<Record<string, WorldFact>>): string {
  return names.map((name) => `${name}=${formatFact(candidate[name])}`).join(' ');
}

function formatFact(value: WorldFact): string {
  if (value === null) return 'none';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `[${value.join(',')}]`;
}

/** The behaviour a coherence check runs against. */
export interface BehaviourInput {
  /** Presented instead of a throwaway, when a caller has real handlers. */
  handlers?: Handlers;
  runs?: Runs;
  /**
   * Ids deliberately left unimplemented, so the check can ask that a binding
   * the page cannot perform is neither kept in the hook's map nor offered by a
   * menu. Rows and chords alike, by id.
   */
  withheld?: readonly string[];
}

export interface CoherenceOptions {
  behaviour?: BehaviourInput;
  /**
   * Keys two surfaces may legitimately share — an overlay's own dismissal is
   * the case: the policy hands that key to the open overlay before the page
   * hears it, so a console binding may carry it too. Anything shared outside
   * this list is a collision like any other.
   */
  allowedSharedKeys?: readonly string[];
}

/**
 * What the declaration got wrong, by kind. Every list is a list of
 * violations, so an empty report is a coherent manifest — and each field is
 * its own assertion, because these fail for different reasons and a spec
 * should say which one it is.
 */
export interface CoherenceReport {
  /** How many states were walked. Pinned by the caller: a check that silently
   *  walked none would pass vacuously. */
  worlds: number;
  /** The surface ids that advertise rows, so a dropped one cannot stop being checked. */
  surfaces: string[];
  /**
   * Two live bindings on one key, per mechanism — the key map, the layer
   * stack, the page's own listeners and the chord namespace — plus keys shared
   * outside `allowedSharedKeys`.
   */
  collisions: string[];
  /** The keys two mounts share, for the caller to pin exact. */
  sharedKeys: string[];
  gates: {
    /** Declared gates no reachable state satisfies. */
    unreachable: string[];
    /** Declared gates no row or chord reads. */
    unread: string[];
    /** Gates a binding names that the manifest does not declare. */
    bogus: string[];
  };
  /** A key that is also a chord prefix, or a chord that prefixes another. */
  namespace: string[];
  /** What a surface advertises, or a menu offers, against what is bound. */
  claims: string[];
  /** Bindings the page does not implement that are kept or offered anyway. */
  unimplemented: string[];
  /** The declaration's own shape: ids, mounts, yields, surface lists. */
  structure: string[];
}

const HELD: Held = { ownControlFocused: true };
const UNHELD: Held = { ownControlFocused: false };

/**
 * Check a manifest against the worlds it can be in.
 *
 * Every list in the report is populated only where the claim fails, so a spec
 * asserts each one empty (or, for the pinned observations, exact) with the
 * sentence it means.
 */
export function coherence<
  Row extends KeyboardRow,
  Chord extends KeyboardChord,
  Gates extends object,
  State,
>(
  manifest: KeyboardManifest<Row, Chord, Gates, State>,
  worlds: readonly World<State>[],
  options: CoherenceOptions = {},
): CoherenceReport {
  const surfaces = Object.keys(manifest.surfaces);
  if (worlds.length === 0) {
    return {
      worlds: 0,
      surfaces,
      collisions: [],
      sharedKeys: [],
      gates: { unreachable: [], unread: [], bogus: [] },
      namespace: [],
      claims: [],
      unimplemented: [],
      structure: ['no worlds were enumerated, and a check that walks no states cannot fail'],
    };
  }

  const allowed = new Set(options.allowedSharedKeys ?? []);
  const withheld = new Set(options.behaviour?.withheld ?? []);
  // The page is assumed to implement the whole declaration — whether it does is
  // e2e/facilitator-keys.spec.ts's question. Throwaways are enough here, since
  // only the SET of keys and sequences is ever read, and `withheld` is how a
  // caller simulates a page that does not implement one binding.
  const handlers: Handlers = { ...synthesizeHandlers(manifest.rows), ...options.behaviour?.handlers };
  const runs: Runs = { ...synthesizeRuns(manifest.chords), ...options.behaviour?.runs };
  const implementable = withoutHandlers(handlers, withheld);
  const runnable = withoutRuns(runs, withheld);

  const rowsById = new Map(manifest.rows.map((row) => [row.id, row]));
  const prefixes = [...new Set(manifest.chords.map(chordPrefix))];
  const declaredKeys = new Set(manifest.rows.flatMap((row) => [...row.keys]));

  const structure = structureViolations(manifest, surfaces, rowsById);
  const namespace = namespaceViolations(manifest, declaredKeys);

  const named = new Set<string>();
  for (const row of manifest.rows) {
    named.add(row.gate);
    for (const standing of standingDown(row)) named.add(standing);
  }
  for (const chord of manifest.chords) named.add(chord.gate);

  const gateNames = Object.keys(gateValues(manifest.gates(worlds[0].state)));
  const reachableAt: Record<string, string> = {};

  const collisions: string[] = [];
  const claims: string[] = [];
  const unimplemented: string[] = [];
  const shared = new Set<string>();

  for (const world of worlds) {
    const gates = manifest.gates(world.state);
    const values = gateValues(gates);
    for (const name of gateNames) {
      if (values[name] === true && reachableAt[name] === undefined) reachableAt[name] = world.label;
    }

    // What the console mounts right now, unheld and held. A surface's claim is
    // compared against this rather than against the rows' declarations,
    // because a shut gate binds nothing whatever the sheet says about it. The
    // unheld map is the conservative one for collisions: a yield can only
    // REMOVE a key, so nothing can collide that this does not see.
    const unheld = Object.keys(manifest.liveKeyMap(gates, UNHELD, handlers));
    const held = Object.keys(manifest.liveKeyMap(gates, HELD, handlers));

    const mapClaims: Record<string, string[]> = {};
    const layerClaims: Record<string, string[]> = {};
    const overlayKeys = new Set<string>();
    for (const row of manifest.rows) {
      if (row.mount === 'map' && manifest.rowIsLive(row, gates)) {
        for (const key of row.keys) mapClaims[key] = [...(mapClaims[key] ?? []), row.id];
      }
      if (row.mount === 'layer' && manifest.layerIsLive(row.id, gates)) {
        for (const key of row.keys) layerClaims[key] = [...(layerClaims[key] ?? []), row.id];
      }
      if ((row.mount === 'primitive' || row.mount === 'global') && manifest.rowIsLive(row, gates)) {
        for (const key of row.keys) overlayKeys.add(key);
      }
    }
    for (const [key, ids] of Object.entries(mapClaims)) {
      if (ids.length > 1) collisions.push(`${world.label}: the key map binds ${key} to ${ids.join(' and ')} at once`);
    }
    for (const [key, ids] of Object.entries(layerClaims)) {
      if (ids.length > 1) collisions.push(`${world.label}: two layers both answer ${key} (${ids.join(' and ')})`);
    }
    const consoleKeys = new Set([...Object.keys(mapClaims), ...Object.keys(layerClaims)]);
    for (const key of overlayKeys) {
      if (!consoleKeys.has(key)) continue;
      shared.add(key);
      if (!allowed.has(key)) {
        collisions.push(
          `${world.label}: ${key} is claimed both by a console binding and by a row the console does not mount`,
        );
      }
    }

    // The page's own bindings are the fourth place two claims can meet. A row
    // this component does not mount answers its key from a listener the page
    // wrote, and two of those live at once means one is on the wrong side of a
    // mounting condition — no layer stack can help here, since neither row is
    // mounted by anything, so `under` is the only lever a ladder of them has.
    const pageClaims: Record<string, string[]> = {};
    for (const row of manifest.rows) {
      if (row.mount !== 'global' || !manifest.rowIsLive(row, gates)) continue;
      for (const key of row.keys) pageClaims[key] = [...(pageClaims[key] ?? []), row.id];
    }
    for (const [key, ids] of Object.entries(pageClaims)) {
      if (ids.length > 1) {
        collisions.push(
          `${world.label}: two rows the page binds itself both answer ${key} (${ids.join(' and ')})`,
        );
      }
    }

    const chordClaims: Record<string, string[]> = {};
    for (const chord of manifest.chords) {
      if (!manifest.gateIsLive(chord.gate, gates)) continue;
      chordClaims[chord.keys] = [...(chordClaims[chord.keys] ?? []), chord.id];
    }
    for (const [sequence, ids] of Object.entries(chordClaims)) {
      if (ids.length > 1) collisions.push(`${world.label}: two chords share the sequence ${sequence} (${ids.join(' and ')})`);
    }

    // Both with and without a control holding the keyboard: the held string is
    // a claim too, and it is the one a per-key yield has to get right.
    for (const heldNow of [false, true]) {
      const mounted = heldNow ? held : unheld;
      for (const surface of surfaces) {
        const ids = manifest.surfaces[surface];
        const advertised = manifest
          .liveShortcuts(ids, gates, heldNow ? HELD : UNHELD)
          .split(' ')
          .filter((key) => key !== '');
        const bound: string[] = [];
        for (const id of ids) {
          const row = rowsById.get(id);
          if (row === undefined) continue; // structural, reported once below
          if (row.mount === 'map') {
            // The key map's own keys, which is what the hook mounts. Live keys
            // are unique per row (the collision check above), so membership
            // cannot credit one row with another's key.
            for (const key of row.keys) if (mounted.includes(key)) bound.push(key);
          } else if (row.mount === 'layer' && manifest.layerIsLive(row.id, gates)) {
            bound.push(...row.keys);
          }
        }
        if (!sameSet(advertised, bound)) {
          claims.push(
            `${world.label} ${surface}${heldNow ? ' (control focused)' : ''}: advertises [${advertised.join(' ')}] but the console mounts [${bound.join(' ')}]`,
          );
        }
        if (new Set(advertised).size !== advertised.length) {
          claims.push(`${world.label} ${surface}: advertises one key twice (${advertised.join(' ')})`);
        }
      }
    }

    const dispatchable = Object.keys(manifest.liveChordMap(gates, runs));
    for (const prefix of prefixes) {
      const expected = dispatchable.filter((sequence) => sequence.startsWith(`${prefix} `));
      const offered = manifest.armedChords(prefix, gates, runs).map((chord) => chord.keys);
      if (!sameSet(offered, expected)) {
        claims.push(`${world.label} chip ${prefix}: offers [${offered.join(' ')}] where the hook runs [${expected.join(' ')}]`);
      }
      // The chip draws the COMPLETING key of each destination, so two
      // destinations one key apart would render the same cap twice and
      // explain neither.
      const completions = manifest
        .armedChords(prefix, gates, runs)
        .map((chord) => chord.keys.split(' ')[1]);
      if (new Set(completions).size !== completions.length) {
        claims.push(`${world.label} chip ${prefix}: two destinations complete on one key (${completions.join(' ')})`);
      }
      // And the same question against a page that implements only what it can:
      // being offered and being dispatchable have to stay the same answer.
      const kept = Object.keys(manifest.liveChordMap(gates, runnable)).filter((sequence) =>
        sequence.startsWith(`${prefix} `),
      );
      const shown = manifest.armedChords(prefix, gates, runnable).map((chord) => chord.keys);
      if (!sameSet(shown, kept)) {
        claims.push(`${world.label} chip ${prefix}: a page that runs [${kept.join(' ')}] is offered [${shown.join(' ')}]`);
      }
    }

    // OUTPUT, not agreement. Two readers built from one predicate agree even
    // when that predicate is the thing that is wrong, so a binding the page
    // does not implement is checked for PRESENCE rather than for a matching
    // set — which is exactly the bug a set comparison cannot see.
    if (withheld.size > 0) {
      for (const id of withheld) {
        const row = rowsById.get(id);
        if (row !== undefined) {
          const unheldBindings = manifest.liveKeyMap(gates, UNHELD, implementable);
          const heldBindings = manifest.liveKeyMap(gates, HELD, implementable);
          for (const key of row.keys) {
            if ([unheldBindings, heldBindings].some((map) => Object.prototype.hasOwnProperty.call(map, key))) {
              unimplemented.push(`${world.label}: the key map keeps ${key} (${id}), which the page does not implement`);
            }
          }
          continue;
        }
        const chord = manifest.chords.find((candidate) => candidate.id === id);
        if (chord === undefined) continue;
        if (Object.prototype.hasOwnProperty.call(manifest.liveChordMap(gates, runnable), chord.keys)) {
          unimplemented.push(`${world.label}: the hook's map keeps ${chord.keys} (${id}), which the page does not implement`);
        }
        if (manifest.armedChords(chordPrefix(chord), gates, runnable).some((offer) => offer.keys === chord.keys)) {
          unimplemented.push(`${world.label}: the chip offers ${chord.keys} (${id}), which the page does not implement`);
        }
      }
    }
  }

  return {
    worlds: worlds.length,
    surfaces,
    collisions,
    sharedKeys: [...shared],
    gates: {
      unreachable: gateNames.filter((gate) => reachableAt[gate] === undefined),
      unread: gateNames.filter((gate) => !named.has(gate)),
      bogus: [...named].filter((gate) => gate !== UNGATED && !gateNames.includes(gate)),
    },
    namespace,
    claims,
    unimplemented,
    structure,
  };
}

/** A declaration as the agreement check reads it: what to call it, and its rows. */
export interface NamedDeclaration {
  /** What this declaration is called in a failure message. */
  name: string;
  rows: readonly KeyboardRow[];
}

/**
 * Every way two declarations that describe ONE binding disagree about it.
 *
 * A binding owned by a component elsewhere in the app ends up declared twice:
 * the surface that OWNS it declares it because that is the key it answers to,
 * and a surface that merely documents it declares it because its readers have
 * to be told the key exists — `mount: 'global'` in both is exactly that
 * arrangement, and the console's sheet printing the palette's `⌘K` is the case
 * that exists today. Two rows describing one key on one keyboard are not two
 * opinions: whichever one has the key wrong is telling its readers something
 * untrue, and neither declaration can see the other.
 *
 * What is compared is only what describes the BINDING: its keys (as a SET —
 * the order two surfaces list alternatives in is a rendering choice), the gate
 * it lives under, the gate it stands down for, how it is mounted, and the keys
 * it yields. Ids, labels and display strings stay out of it, because those are
 * how each surface speaks to its own readers and the sheet's words are not the
 * palette's.
 *
 * `pairs` is knowledge rather than anything derivable: two ids for one binding
 * have nothing in common to match on. So the caller states it, and pins it
 * where a reader can see it — a pairing dropped from the list would otherwise
 * stop being checked at all.
 */
export function agreement(
  left: NamedDeclaration,
  right: NamedDeclaration,
  pairs: ReadonlyArray<{ left: string; right: string }>,
): string[] {
  if (pairs.length === 0) {
    return ['no shared bindings were named, and a check that compares nothing cannot fail'];
  }
  const violations: string[] = [];
  for (const pair of pairs) {
    const leftRow = left.rows.find((row) => row.id === pair.left);
    const rightRow = right.rows.find((row) => row.id === pair.right);
    if (leftRow === undefined) {
      violations.push(`${left.name} declares no row ${pair.left}`);
      continue;
    }
    if (rightRow === undefined) {
      violations.push(`${right.name} declares no row ${pair.right}`);
      continue;
    }
    const where = `${left.name} ${pair.left} and ${right.name} ${pair.right}`;
    for (const fact of ROW_FACTS) {
      const from = fact.of(leftRow);
      const to = fact.of(rightRow);
      if (from === to) continue;
      violations.push(`${where} describe one binding with different ${fact.name} ([${from}] and [${to}])`);
    }
  }
  return violations;
}

/**
 * The facts that describe a binding rather than one surface's account of it.
 * Each is rendered as one string, so a disagreement can be printed the way it
 * was declared; the key sets are sorted, since two surfaces that list the same
 * alternatives in another order are saying the same thing.
 */
const ROW_FACTS: ReadonlyArray<{ name: string; of: (row: KeyboardRow) => string }> = [
  { name: 'keys', of: (row) => [...row.keys].sort().join(' ') },
  { name: 'gate', of: (row) => row.gate },
  { name: 'under', of: (row) => [...standingDown(row)].sort().join(' ') || 'nothing' },
  { name: 'mount', of: (row) => row.mount },
  { name: 'yieldKeys', of: (row) => [...(row.yieldKeys ?? [])].sort().join(' ') },
];

/** The declaration on its own, without the readers — all the shape checks need. */
interface Declaration {
  rows: readonly KeyboardRow[];
  chords: readonly KeyboardChord[];
  surfaces: Readonly<Record<string, readonly string[]>>;
}

/**
 * The declaration's own shape, once rather than per state: ids are unique,
 * chords are a prefix and one key, a yield names a key its row binds and only
 * a key map row stands anything down, and each surface lists rows that exist,
 * only rows this console binds, once each and at least one.
 */
function structureViolations(
  manifest: Declaration,
  surfaces: readonly string[],
  rowsById: ReadonlyMap<string, KeyboardRow>,
): string[] {
  const structure: string[] = [];
  for (const id of duplicates(manifest.rows.map((row) => row.id))) {
    structure.push(`two rows share the id ${id}`);
  }
  for (const id of duplicates(manifest.chords.map((chord) => chord.id))) {
    structure.push(`two chords share the id ${id}`);
  }
  for (const chord of manifest.chords) {
    const parts = chord.keys.split(' ');
    if (parts.length !== 2) {
      structure.push(`chord ${chord.id} is "${chord.keys}", which is not a prefix key and the key that completes it`);
    }
  }
  for (const row of manifest.rows) {
    if (row.yieldKeys === undefined) continue;
    if (row.mount !== 'map') structure.push(`${row.id} stands a key down but is not mounted in the key map (${row.mount})`);
    for (const key of row.yieldKeys) {
      if (!row.keys.includes(key)) structure.push(`${row.id} stands down ${key}, which it does not bind`);
    }
  }
  for (const surface of surfaces) {
    const ids = manifest.surfaces[surface];
    if (ids.length === 0) structure.push(`the ${surface} surface claims no rows`);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) structure.push(`the ${surface} surface lists ${id} twice`);
      seen.add(id);
      const row = rowsById.get(id);
      if (row === undefined) {
        structure.push(`the ${surface} surface names no declared row (${id})`);
        continue;
      }
      if (row.mount !== 'map' && row.mount !== 'layer') {
        structure.push(`the ${surface} surface claims ${id}, which the console does not mount (${row.mount})`);
      }
    }
  }
  return structure;
}

/**
 * The namespace, once: a single key that is also a chord's prefix would be
 * armed as a namespace and fired as a command by the same press, and a chord
 * that prefixes another could never complete.
 */
function namespaceViolations(manifest: Declaration, declaredKeys: ReadonlySet<string>): string[] {
  const namespace: string[] = [];
  const sequences = manifest.chords.map((chord) => chord.keys);
  for (const chord of manifest.chords) {
    if (declaredKeys.has(chordPrefix(chord))) {
      namespace.push(`${chordPrefix(chord)} is bound as a single key AND opens a chord namespace`);
    }
  }
  for (const sequence of sequences) {
    if (sequences.some((other) => other !== sequence && other.startsWith(`${sequence} `))) {
      namespace.push(`${sequence} is a prefix of another chord, so it can never complete`);
    }
  }
  return namespace;
}

function chordPrefix(chord: KeyboardChord): string {
  return chord.keys.split(' ')[0];
}

/** A no-op stand-in: only the SET of keys matters to these checks. */
function synthesizeHandlers(rows: readonly KeyboardRow[]): Handlers {
  const handlers: Handlers = {};
  for (const row of rows) {
    const perKey: Record<string, () => void> = {};
    for (const key of row.keys) perKey[key] = () => undefined;
    handlers[row.id] = perKey;
  }
  return handlers;
}

function synthesizeRuns(chords: readonly KeyboardChord[]): Runs {
  const runs: Runs = {};
  for (const chord of chords) runs[chord.id] = () => undefined;
  return runs;
}

function withoutHandlers(handlers: Handlers, withheld: ReadonlySet<string>): Handlers {
  const kept: Handlers = {};
  for (const [id, perKey] of Object.entries(handlers)) if (!withheld.has(id)) kept[id] = perKey;
  return kept;
}

function withoutRuns(runs: Runs, withheld: ReadonlySet<string>): Runs {
  const kept: Runs = {};
  for (const [id, run] of Object.entries(runs)) if (!withheld.has(id)) kept[id] = run;
  return kept;
}

/** A manifest's gates as booleans, whatever it calls their type. */
function gateValues(gates: object): Record<string, boolean> {
  const values: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(gates)) values[name] = value === true;
  return values;
}

function sameSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) twice.add(id);
    seen.add(id);
  }
  return [...twice];
}

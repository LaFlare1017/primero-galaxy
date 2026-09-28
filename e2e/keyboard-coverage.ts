import { expect, test, type Page } from '@playwright/test';

/**
 * The other half of a keyboard declaration's promise, in the one place both
 * declared keyboards can share it.
 *
 * e2e/keyboard-coherence.ts asks whether a declaration agrees with ITSELF: no
 * two live bindings answer to one key, and what each surface advertises is what
 * it mounts. That leaves the question a declaration cannot answer about itself
 * — is this binding actually IMPLEMENTED? — and it is the one a reader is most
 * likely to assume: a row in a declaration is documentation until something
 * presses it. So an exercise is demanded of every declared binding, and the
 * two lists are compared in BOTH directions, because the failure that started
 * this work is the one nobody notices: add a row to the declaration and every
 * feature test still passes, because "every feature has a test" does not imply
 * "every documented binding was pressed".
 *
 * What is shared is the claim's SHAPE, not a surface's behaviour:
 *
 *   - the bindings are READ from the declaration, never written down twice, and
 *     a declared binding with no exercise fails before a browser opens;
 *   - every KEY of a binding is pressed, not every binding — one row may bind
 *     alternatives (`Enter` and `w`), and each is a key a person can press;
 *   - each press starts from a state where that binding is live: `enter` puts
 *     the surface where a press begins (reload it, open it), `prepare` earns the
 *     state a conditional binding needs, and the effect sees the surface as it
 *     was immediately before the key went down — so a step that needs a
 *     sub-list can say it started in one, and "nothing happened" cannot be
 *     confused with "it never could have".
 *
 * What it deliberately does not do is make the effects generic. What a key is
 * supposed to do is the surface's own business, written in its own spec against
 * its own DOM; this file owns the property, that spec owns the meaning.
 */

/** A binding, flattened to the presses it takes: one id and its keys. */
export interface DeclaredBinding {
  id: string;
  /** The keys this binding answers to — one entry per alternative, as declared. */
  keys: readonly string[];
}

/**
 * One declared binding, exercised: how the surface reaches a state where the
 * binding is live, and the visible change its key has to make.
 */
export interface Exercise<Snapshot> {
  /**
   * Earn the state a conditional binding needs. Absent for a binding that is
   * live the moment `enter` has run.
   */
  prepare?: (page: Page) => Promise<void>;
  /** What the key has to do, seen from the screen. */
  effect: (page: Page, before: Snapshot, key: string) => Promise<void>;
}

export interface CoverageOptions<Snapshot> {
  /** The declaration's bindings, in the order the surface documents them. */
  declared: readonly DeclaredBinding[];
  /** One exercise per declared id — the same list, or the test fails here. */
  exercises: Readonly<Record<string, Exercise<Snapshot>>>;
  /** Once, before any step: whatever every step needs to exist at all. */
  raise?: (page: Page) => Promise<void>;
  /** Put the surface where a press begins: reload it, or open it. */
  enter: (page: Page) => Promise<void>;
  /** The surface as it is, read after `prepare` and before the key goes down. */
  snapshot: (page: Page) => Promise<Snapshot>;
}

/**
 * Press every binding of a declaration, from a live state, demanding a visible
 * effect of each. Called from inside a `test`, which is also where the steps are
 * reported, so a key that does nothing fails under the name it was declared by.
 */
export async function pressEveryDeclaredBinding<Snapshot>(
  page: Page,
  options: CoverageOptions<Snapshot>,
): Promise<void> {
  const { declared, exercises, raise, enter, snapshot } = options;

  expect(
    Object.keys(exercises).sort(),
    'every declared binding has an exercise, and every exercise names a declared binding',
  ).toEqual(declared.map((binding) => binding.id).sort());

  // A binding that names no key is not exercised by anything: the loop below
  // presses one key per declared key, so an empty list walks through the
  // binding without a press and its exercise never runs — the same "a check
  // that walks nothing cannot fail" vacuity the coherence harness refuses for
  // a manifest with no states. Found by emptying a row's keys, which the
  // both-directions check above cannot see, since it compares ids.
  expect(
    declared.filter((binding) => binding.keys.length === 0).map((binding) => binding.id),
    'no declared binding may name zero keys, and be exercised by nobody',
  ).toEqual([]);

  await raise?.(page);

  for (const binding of declared) {
    // Per KEY rather than per binding: alternatives are separate presses, and
    // each one is a key a person can press.
    for (const key of binding.keys) {
      await test.step(`${binding.id} — ${key}`, async () => {
        await enter(page);
        const exercise = exercises[binding.id];
        await exercise.prepare?.(page);
        const before = await snapshot(page);
        // A chord is typed as a sequence, which is how the hook that dispatches
        // it reads one: the declaration and the surface spell keys the same way.
        for (const pressed of key.split(' ')) await page.keyboard.press(pressed);
        await exercise.effect(page, before, key);
      });
    }
  }
}

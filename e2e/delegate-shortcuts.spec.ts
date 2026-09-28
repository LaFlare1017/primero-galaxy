import { readFileSync } from 'fs';
import { join } from 'path';

import ts from 'typescript';
import { expect, test, type Page } from '@playwright/test';

/**
 * Unit spec for the shared keyboard-shortcut POLICY
 * (components/delegate/shortcuts.ts) — the ignore-guards every Delegate
 * surface inherits when it binds a global shortcut.
 *
 * The repo has no unit-test runner (Playwright only), and adding one for
 * two predicates would cost more than it returns. Instead this spec runs
 * the module's own source in a real browser: the file has no imports by
 * design, so it is transpiled with the TypeScript already in the repo and
 * injected into a blank page. The assertions therefore exercise the
 * shipped source — not a copy of it — against real elements and real
 * dispatched KeyboardEvents, which is the only place `isContentEditable`,
 * `closest('[role=dialog]')` and event targets mean anything.
 *
 * What the policy must decide, one case per rule:
 *   - a plain control or the bare page: allowed
 *   - input, textarea, select, content-editable: blocked
 *   - anything inside a dialog (the palette's input AND a non-input
 *     inside a dialog): blocked
 *   - anything inside an OPEN overlay, in either shape it arrives: the
 *     saved-views panel exactly as Radix renders it (role="dialog",
 *     inside a popper wrapper), and the same layer claiming no role at
 *     all; the popper wrapper is the only marker left in the second case
 *   - a layer that is mounted but CLOSED: allowed — inert markup must
 *     not shadow the page
 *   - a layer that closed or removed itself ON this very key: blocked, which
 *     is a timing case rather than a markup one and gets its own test
 *   - any modifier held: blocked
 *   - Shift alone: allowed — pinned so the policy cannot quietly widen
 *     into claiming chords
 *   - which key it is: none of the guard's business
 *
 * Every case is decided from an event that actually bubbled to a window
 * listener, because a synthetic KeyboardEvent cannot have its target
 * assigned — the whole policy hangs off `event.target`, so a decision
 * made on a targetless event would prove nothing.
 *
 * The consumer side (the watch pane sweep) is proven end to end in
 * facilitator-run-link.spec.ts, including a positive control and
 * mutation-proven guards.
 *
 * The file also runs the console's keyboard DECLARATION
 * (components/delegate/consoleShortcuts.ts) the same way — from source, in a
 * browser — and holds it to the coherence its one-declaration design promises:
 * no reachable console state may let two bindings answer to one key, and no
 * gate may be declared that no state can reach or no binding reads. The two
 * modules are loaded together there, because the one key a declaration may
 * bind twice is the one the policy names.
 */

const GUARDS_PATH = join(__dirname, '..', 'components', 'delegate', 'shortcuts.ts');
const CONSOLE_PATH = join(__dirname, '..', 'components', 'delegate', 'consoleShortcuts.ts');

/**
 * Fixture DOM: every kind of target the policy has an opinion about.
 *
 * The overlay fixtures are transcribed from what the app really renders,
 * measured on the running facilitator console (see the popover case in
 * facilitator-run-link.spec.ts) — which is how two surprises got into
 * this file instead of one: Radix 1.1.23 puts role="dialog" on popover
 * content whatever its modality, and it mounts the content inside a
 * `data-radix-popper-content-wrapper` positioning wrapper. So the panel
 * below comes in BOTH shapes: the role-ful one the app ships, and a
 * role-less one, which is the case the wrapper clause exists for.
 */
const FIXTURES = `
  <button id="plain-button">button</button>
  <div id="plain-div">div</div>
  <input id="text-input" />
  <textarea id="text-area"></textarea>
  <select id="select"><option>a</option></select>
  <div id="editable" contenteditable="true">editable</div>
  <div role="dialog" aria-label="Palette">
    <input id="dialog-input" />
    <button id="dialog-button">row</button>
  </div>
  <!-- The saved-views panel exactly as Radix renders it: role="dialog",
       data-state="open", portaled into the popper wrapper. -->
  <div data-radix-popper-content-wrapper="">
    <div role="dialog" data-state="open" data-side="bottom" data-align="start" tabindex="-1">
      <button id="views-button">Saved view row</button>
    </div>
  </div>
  <!-- The same layer claiming no role at all: a hand-rolled panel, a menu
       portaled by hand, a primitive that drops the dialog role. The
       wrapper is the only thing left to identify it by. -->
  <div data-radix-popper-content-wrapper="">
    <div data-state="open" data-side="bottom" tabindex="-1">
      <input id="popover-input" aria-label="View name" />
      <button id="popover-button">panel row</button>
    </div>
  </div>
  <!-- Both shapes again, mounted but CLOSED. A closed layer is inert, so
       neither the role nor the wrapper may shadow the page behind it. -->
  <div role="dialog" data-state="closed" tabindex="-1">
    <button id="closed-dialog-button">stale dialog</button>
  </div>
  <div data-radix-popper-content-wrapper="">
    <div data-state="closed" tabindex="-1"><button id="closed-popover-button">stale panel</button></div>
  </div>
`;

interface ShortcutCase {
  label: string;
  /** Fixture id to dispatch at, or 'window' for the nothing-focused case. */
  target: string;
  key: string;
  mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };
  allowed: boolean;
  why: string;
}

const CASES: ShortcutCase[] = [
  { label: 'button', target: 'plain-button', key: 'ArrowRight', mods: {}, allowed: true, why: 'an ordinary control owns no arrow keys' },
  { label: 'div', target: 'plain-div', key: 'ArrowRight', mods: {}, allowed: true, why: 'the bare page is the shortcut territory' },
  { label: 'input', target: 'text-input', key: 'ArrowRight', mods: {}, allowed: false, why: 'a text field is being typed into' },
  { label: 'textarea', target: 'text-area', key: 'ArrowRight', mods: {}, allowed: false, why: 'a text field is being typed into' },
  { label: 'select', target: 'select', key: 'ArrowRight', mods: {}, allowed: false, why: 'a select uses arrows to change its value' },
  { label: 'editable', target: 'editable', key: 'ArrowRight', mods: {}, allowed: false, why: 'content-editable is a text field by another name' },
  { label: 'dialog input', target: 'dialog-input', key: 'ArrowRight', mods: {}, allowed: false, why: 'the palette search is an input inside a modal' },
  { label: 'dialog row', target: 'dialog-button', key: 'ArrowRight', mods: {}, allowed: false, why: 'a non-input inside a modal is still behind a modal' },
  { label: 'popover row', target: 'popover-button', key: 'j', mods: {}, allowed: false, why: 'a role-less portaled panel still owns the keys, buttons or not' },
  { label: 'popover input', target: 'popover-input', key: 'j', mods: {}, allowed: false, why: 'a field inside a role-less panel: blocked twice over' },
  { label: 'saved-views row', target: 'views-button', key: 'j', mods: {}, allowed: false, why: 'the saved-views panel as the app renders it — role="dialog" and open' },
  { label: 'closed popover row', target: 'closed-popover-button', key: 'j', mods: {}, allowed: true, why: 'a closed layer is inert; the guard must key on open, not on markup' },
  { label: 'closed dialog row', target: 'closed-dialog-button', key: 'j', mods: {}, allowed: true, why: 'a force-mounted dialog in its closed state is just as inert' },
  { label: 'meta', target: 'plain-button', key: 'ArrowRight', mods: { metaKey: true }, allowed: false, why: 'Cmd+Left/Right is the browser back/forward gesture' },
  { label: 'ctrl', target: 'plain-button', key: 'ArrowRight', mods: { ctrlKey: true }, allowed: false, why: 'a modified press belongs to the browser, not a bare binding' },
  { label: 'alt', target: 'plain-button', key: 'ArrowRight', mods: { altKey: true }, allowed: false, why: 'Alt+Arrow is a word-jump in any field' },
  { label: 'shift', target: 'plain-button', key: 'ArrowRight', mods: { shiftKey: true }, allowed: true, why: 'Shift alone is not a chord the policy arbitrates' },
  { label: 'other key', target: 'plain-button', key: 'Enter', mods: {}, allowed: true, why: 'which key it is is the binding business, not the guard' },
  { label: 'nothing focused', target: 'window', key: 'ArrowRight', mods: {}, allowed: true, why: 'no element owns the key' },
];

/**
 * Load one of the Delegate keyboard modules into the page from its source on
 * disk, and hand its own exports to the page under a global — so nothing is
 * re-declared here: if a module renames or drops an export, this spec breaks
 * at the load rather than asserting against a stale copy.
 */
async function loadModule(
  page: Page,
  path: string,
  names: readonly string[],
  global: string,
): Promise<void> {
  const source = readFileSync(path, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  await page.addScriptTag({
    type: 'module',
    content: `${js}\nwindow.${global} = { ${names.join(', ')} };`,
  });
  await page.waitForFunction(
    (key) => Boolean((window as unknown as Record<string, unknown>)[key]),
    global,
  );
}

/** The guards module, as used by the policy cases below. */
async function loadGuards(page: Page): Promise<void> {
  await loadModule(
    page,
    GUARDS_PATH,
    ['ownsArrowKeys', 'shortcutAllowed', 'OVERLAY_DISMISS_KEY'],
    '__guards',
  );
}

/** The console's keyboard declaration, as used by the manifest cases below. */
async function loadConsoleKeys(page: Page): Promise<void> {
  await loadModule(
    page,
    CONSOLE_PATH,
    [
      'CONSOLE_KEYS',
      'CONSOLE_CHORDS',
      'CONSOLE_GROUPS',
      'consoleGates',
      'gateIsLive',
      'rowIsLive',
      'liveKeyMap',
      'liveChordMap',
      'armedChords',
      'layerIsLive',
      'liveShortcuts',
    ],
    '__console',
  );
}

/**
 * Dispatch one real KeyboardEvent per case and record the policy's verdict
 * from a window listener, exactly as a mounted shortcut would see it.
 * Dispatch is synchronous with one listener attached, so the returned
 * verdicts pair up with `cases` by index.
 */
async function decide(
  page: Page,
  cases: ShortcutCase[],
): Promise<Array<{ from: string; key: string; allowed: boolean }>> {
  return page.evaluate((todo) => {
    const guards = (window as unknown as {
      __guards: { shortcutAllowed: (event: KeyboardEvent) => boolean };
    }).__guards;
    const seen: Array<{ from: string; key: string; allowed: boolean }> = [];
    const listener = (event: KeyboardEvent) => {
      const node = event.target;
      const from =
        node === window ? 'window' : node instanceof Element ? node.id || node.tagName.toLowerCase() : 'none';
      seen.push({ from, key: event.key, allowed: guards.shortcutAllowed(event) });
    };
    window.addEventListener('keydown', listener);
    for (const item of todo) {
      const el = item.target === 'window' ? window : document.getElementById(item.target);
      if (!el) throw new Error(`missing fixture: ${item.target}`);
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: item.key, bubbles: true, cancelable: true, ...item.mods }),
      );
    }
    window.removeEventListener('keydown', listener);
    return seen;
  }, cases);
}

test.describe('Delegate keyboard-shortcut policy', () => {
  test('allows only what no text field, overlay, or modifier owns', async ({ page }) => {
    await page.goto('about:blank');
    await page.evaluate((html) => {
      document.body.innerHTML = html;
    }, FIXTURES);
    await loadGuards(page);

    const verdicts = await decide(page, CASES);
    expect(verdicts).toHaveLength(CASES.length);

    CASES.forEach((testCase, i) => {
      const verdict = verdicts[i];
      // The event must have come from the fixture we aimed at, or the
      // verdict below is about some other target entirely.
      expect(verdict.from, `${testCase.label}: dispatched at the wrong element`).toBe(testCase.target);
      expect(verdict.key).toBe(testCase.key);
      expect(verdict.allowed, `${testCase.label}: ${testCase.why}`).toBe(testCase.allowed);
    });
  });

  test('a layer that closed itself on this very key still owns it', async ({ page }) => {
    // The one case that is about WHEN the policy is asked rather than what
    // it is aimed at, so it cannot live in the table above. Radix listens
    // for Escape in the CAPTURE phase: by the time a bubble-phase listener
    // on window asks who owns the keystroke, a layer that dismissed itself
    // has already flipped to data-state="closed" — while still mounted,
    // and still holding the focus the key was aimed at. Measured on the
    // saved-views panel, the shortcut sheet and the command palette alike.
    // A selector keyed on "open" answers "nobody owns this", the key falls
    // through to the layer underneath, and one Escape closed the panel AND
    // the watch pane behind it.
    //
    // So the two shapes of "closed mid-keypress" are simulated here the way
    // Radix produces them — by mutating the layer from a CAPTURE-phase
    // listener, which runs before the window listener the policy is
    // consulted from. The control at the end is the other reading of the
    // same attribute: closed, and holding no focus, must stay inert.
    //
    // Ownership is scoped to THAT key, and the measurement that says so is
    // the `flippedOtherKey` verdict below. Closing the saved-views panel
    // leaves focus on the panel's own button for a beat while it unmounts —
    // mounted, data-state="closed", still focused — so a clause that
    // claimed every key aimed at a closed layer kept the console deaf to
    // the next `j`: the walk only came back once focus was moved by hand.
    // The screen reader of the failure is a walk that does not move, so the
    // policy has to be the thing that is true.
    await page.goto('about:blank');
    await page.evaluate((html) => {
      document.body.innerHTML = html;
    }, FIXTURES);
    await loadGuards(page);

    const verdicts = await page.evaluate(() => {
      const guards = (
        window as unknown as { __guards: { shortcutAllowed: (event: KeyboardEvent) => boolean } }
      ).__guards;
      type Verdicts = {
        open: boolean;
        flipped: boolean;
        flippedOtherKey: boolean;
        removed: boolean;
        closedAndIdle: boolean;
      };
      // The app's own shape, and the CONTENT element — the one that carries
      // role and data-state. Returning the wrapper would mutate the wrong
      // node and the test would pass for the wrong reason.
      const freshLayer = (): HTMLElement => {
        const host = document.createElement('div');
        host.innerHTML =
          '<div data-radix-popper-content-wrapper=""><div role="dialog" data-state="open" tabindex="-1">' +
          '<button id="probe-button">panel row</button></div></div>';
        document.body.append(host);
        return host.firstElementChild?.firstElementChild as HTMLElement;
      };
      const press = (mutate: (layer: HTMLElement) => void, key = 'Escape'): boolean => {
        const layer = freshLayer();
        const button = layer.querySelector('button') as HTMLElement;
        button.focus();
        const seen = { allowed: true };
        // Capture, like Radix: this runs before the window listener.
        document.addEventListener('keydown', () => mutate(layer), { capture: true, once: true });
        const listener = (event: KeyboardEvent) => {
          seen.allowed = guards.shortcutAllowed(event);
        };
        window.addEventListener('keydown', listener);
        button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        window.removeEventListener('keydown', listener);
        return seen.allowed;
      };
      const verdicts: Verdicts = {
        // Untouched: the ordinary case, the selector alone answers it.
        open: press(() => {}),
        // Dismissed: data-state flipped, node still mounted, still focused.
        flipped: press((layer) => layer.setAttribute('data-state', 'closed')),
        // The same layer, the same focus, a key that did not close it: a
        // closed overlay is what the page is showing, so the page gets it.
        flippedOtherKey: press((layer) => layer.setAttribute('data-state', 'closed'), 'j'),
        // Removed outright by the same key — the remaining shape, where
        // there is no mounted-closed state left to catch it. Closed FIRST,
        // as Radix does before unmounting: an orphan that still carries
        // data-state="open" is caught by the plain selector, so it would
        // prove nothing about the clause this case exists for.
        removed: press((layer) => {
          layer.setAttribute('data-state', 'closed');
          layer.remove();
        }),
        // Closed and idle, with the key aimed at it from outside: a
        // force-mounted layer must not shadow the page, so this one is
        // allowed through.
        closedAndIdle: (() => {
          const layer = freshLayer();
          layer.setAttribute('data-state', 'closed');
          const button = layer.querySelector('button') as HTMLElement;
          (document.getElementById('plain-button') as HTMLElement).focus();
          const seen = { allowed: true };
          const listener = (event: KeyboardEvent) => {
            seen.allowed = guards.shortcutAllowed(event);
          };
          window.addEventListener('keydown', listener);
          button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          window.removeEventListener('keydown', listener);
          return seen.allowed;
        })(),
      };
      return verdicts;
    });

    expect(verdicts.open, 'a button inside an open layer is owned').toBe(false);
    expect(verdicts.flipped, 'a layer that closed itself on this key is still owned').toBe(false);
    expect(
      verdicts.flippedOtherKey,
      'a closed layer owns only the key that dismissed it',
    ).toBe(true);
    expect(verdicts.removed, 'a layer that removed itself on this key is still owned').toBe(false);
    expect(verdicts.closedAndIdle, 'a closed layer holding no focus is inert').toBe(true);
  });
});

/**
 * One console state, and the gates it has to read as. The states are named
 * for the situation a facilitator is in rather than for the fields, because
 * the thing under test is a judgement about the room: "is there anywhere to
 * walk", "is there a row to commit" — the questions the sheet dims by and
 * the bindings mount by.
 */
interface GateCase {
  label: string;
  state: {
    sweepList: string[];
    watchId: string | null;
    viewsOpen: boolean;
    cursorTarget: string | null;
    cursorRow: unknown;
  };
  gates: ConsoleGates;
  why: string;
}

interface ConsoleGates {
  walk: boolean;
  commit: boolean;
  sweep: boolean;
  link: boolean;
  pane: boolean;
  views: boolean;
}

/**
 * The console's state as `consoleGates` takes it — the five inputs every gate
 * is a judgement about. The coherence case below enumerates these directly
 * rather than going through the UI, because the claim is about the
 * DECLARATION, and the state space is small enough to walk exhaustively.
 */
interface ConsoleState {
  sweepList: string[];
  watchId: string | null;
  viewsOpen: boolean;
  cursorTarget: string | null;
  cursorRow: unknown;
}

/**
 * The declaration and the readers the coherence case calls, described by
 * SHAPE rather than imported: the module is loaded from its own source into
 * the page, so a renamed export breaks the load above rather than quietly
 * satisfying a type here.
 */
interface ConsoleDeclarationApi {
  CONSOLE_KEYS: Array<{ id: string; keys: readonly string[]; gate: string; under?: string; mount: string }>;
  CONSOLE_CHORDS: Array<{ id: string; keys: string; gate: string }>;
  consoleGates: (state: ConsoleState) => ConsoleGates;
  gateIsLive: (gate: string, gates: ConsoleGates) => boolean;
  rowIsLive: (row: { gate: string; under?: string }, gates: ConsoleGates) => boolean;
  layerIsLive: (id: string, gates: ConsoleGates) => boolean;
}

const GATE_CASES: GateCase[] = [
  {
    label: 'cold console, room on screen',
    state: { sweepList: ['run-1', 'run-2'], watchId: null, viewsOpen: false, cursorTarget: 'run-1', cursorRow: { participant: 'A' } },
    gates: { walk: true, commit: true, sweep: false, link: true, pane: false, views: false },
    why: 'a room to walk and a row to commit, but nothing watched to sweep',
  },
  {
    label: 'empty room',
    state: { sweepList: [], watchId: null, viewsOpen: false, cursorTarget: null, cursorRow: null },
    gates: { walk: false, commit: false, sweep: false, link: false, pane: false, views: false },
    why: 'nothing to walk, nothing to commit, nothing to link: every room key is dead',
  },
  {
    label: 'watching the only participant',
    state: { sweepList: ['run-1'], watchId: 'run-1', viewsOpen: false, cursorTarget: 'run-1', cursorRow: { participant: 'A' } },
    gates: { walk: true, commit: false, sweep: false, link: true, pane: true, views: false },
    why: 'the transport needs somewhere to step to; a lone run in a quiet room is a pane with no sweep',
  },
  {
    label: 'watching with room to step',
    state: {
      sweepList: ['run-1', 'run-2'],
      watchId: 'run-1',
      viewsOpen: false,
      cursorTarget: 'run-2',
      cursorRow: { participant: 'B' },
    },
    gates: { walk: true, commit: true, sweep: true, link: true, pane: true, views: false },
    why: 'watching one run while the cursor sits on another: there is still something to commit',
  },
  {
    label: 'watching the cursor row',
    state: {
      sweepList: ['run-1', 'run-2'],
      watchId: 'run-2',
      viewsOpen: false,
      cursorTarget: 'run-2',
      cursorRow: { participant: 'B' },
    },
    gates: { walk: true, commit: false, sweep: true, link: true, pane: true, views: false },
    why: 'Enter on the row already being watched has nothing to open',
  },
  {
    label: 'views panel open over a watched run',
    state: {
      sweepList: ['run-1', 'run-2'],
      watchId: 'run-1',
      viewsOpen: true,
      cursorTarget: 'run-2',
      cursorRow: { participant: 'B' },
    },
    gates: { walk: true, commit: true, sweep: true, link: true, pane: true, views: true },
    why: 'the panel is a layer, not a room state: every room gate is untouched by it',
  },
];

test.describe('Facilitator console keyboard declaration', () => {
  test('reads the console state as gates', async ({ page }) => {
    // The gate expressions are the thing the sheet dims by and the bindings
    // mount by, so they are worth a table rather than one pass through the
    // UI: "there is something to walk" is a judgement about the room, and
    // the interesting cases are the ones a workshop actually produces.
    await page.goto('about:blank');
    await loadConsoleKeys(page);

    const verdicts = await page.evaluate(
      (cases) =>
        cases.map((item) =>
          (
            window as unknown as {
              __console: { consoleGates: (state: unknown) => ConsoleGates };
            }
          ).__console.consoleGates(item.state),
        ),
      GATE_CASES,
    );

    GATE_CASES.forEach((item, i) => {
      expect(verdicts[i], `${item.label}: ${item.why}`).toEqual(item.gates);
    });
  });

  test('builds the key map, the layer mounts and the aria strings from the same rows', async ({
    page,
  }) => {
    // The three readers, against the module the page actually binds from:
    // the map the hook mounts, the ordered layer mounts, and the string the
    // surface hands to `aria-keyshortcuts`. They are built from one list, so
    // the claim being pinned is that they agree — the sheet cannot offer a
    // key nothing dispatches, and an attribute cannot advertise one either.
    await page.goto('about:blank');
    await loadConsoleKeys(page);

    const read = await page.evaluate(() => {
      const keys = (
        window as unknown as {
          __console: {
            CONSOLE_KEYS: Array<{ id: string; keys: string[]; gate: string; mount: string; group: string }>;
            CONSOLE_GROUPS: Array<{ id: string }>;
            consoleGates: (state: unknown) => ConsoleGates;
            liveKeyMap: (
              gates: ConsoleGates,
              held: { ownControlFocused: boolean },
              handlers: Record<string, Record<string, () => void>>,
            ) => Record<string, () => void>;
            layerIsLive: (id: string, gates: ConsoleGates) => boolean;
            liveShortcuts: (ids: string[], gates: ConsoleGates, held?: { ownControlFocused: boolean }) => string;
          };
        }
      ).__console;

      // Behaviour for every row id the page supplies, so a row with no
      // handler shows up as a missing key rather than as a binding nobody
      // can see. The values are throwaways: only the SET of keys matters.
      const handlers: Record<string, Record<string, () => void>> = {};
      for (const row of keys.CONSOLE_KEYS) {
        const perKey: Record<string, () => void> = {};
        for (const key of row.keys) perKey[key] = () => undefined;
        handlers[row.id] = perKey;
      }

      const cold = keys.consoleGates({
        sweepList: ['run-1', 'run-2'],
        watchId: null,
        viewsOpen: false,
        cursorTarget: 'run-1',
        cursorRow: { participant: 'A' },
      });
      const watching = keys.consoleGates({
        sweepList: ['run-1', 'run-2'],
        watchId: 'run-1',
        viewsOpen: false,
        cursorTarget: 'run-2',
        cursorRow: { participant: 'B' },
      });
      const panelOverWatching = keys.consoleGates({
        sweepList: ['run-1', 'run-2'],
        watchId: 'run-1',
        viewsOpen: true,
        cursorTarget: 'run-2',
        cursorRow: { participant: 'B' },
      });
      const empty = keys.consoleGates({
        sweepList: [],
        watchId: null,
        viewsOpen: false,
        cursorTarget: null,
        cursorRow: null,
      });

      // One row's handlers withheld, to prove the map is built from the
      // rows and not from whatever the page hands over.
      const partial = { ...handlers };
      delete partial['walk-up'];

      return {
        coldKeys: Object.keys(keys.liveKeyMap(cold, { ownControlFocused: false }, handlers)),
        heldKeys: Object.keys(keys.liveKeyMap(cold, { ownControlFocused: true }, handlers)),
        watchingKeys: Object.keys(keys.liveKeyMap(watching, { ownControlFocused: false }, handlers)),
        emptyKeys: Object.keys(keys.liveKeyMap(empty, { ownControlFocused: false }, handlers)),
        partialKeys: Object.keys(keys.liveKeyMap(cold, { ownControlFocused: false }, partial)),
        layers: {
          panelOpen: keys.layerIsLive('dismiss-views', panelOverWatching),
          paneUnderPanel: keys.layerIsLive('dismiss-pane', panelOverWatching),
          paneAlone: keys.layerIsLive('dismiss-pane', watching),
          panelAlone: keys.layerIsLive('dismiss-views', watching),
          notALayer: keys.layerIsLive('commit', cold),
          emptyRoom: keys.layerIsLive('dismiss-pane', empty),
        },
        strings: {
          grid: keys.liveShortcuts(['walk-down', 'walk-up', 'commit'], cold),
          gridHeld: keys.liveShortcuts(['walk-down', 'walk-up', 'commit'], cold, { ownControlFocused: true }),
          pane: keys.liveShortcuts(['sweep-step', 'sweep-jump', 'dismiss-pane'], watching),
          paneUnderPanel: keys.liveShortcuts(['sweep-step', 'sweep-jump', 'dismiss-pane'], panelOverWatching),
          paneClosed: keys.liveShortcuts(['sweep-step', 'sweep-jump', 'dismiss-pane'], cold),
          sheet: keys.liveShortcuts(['open-sheet'], cold),
          unknownIds: keys.liveShortcuts(['no-such-row'], cold),
        },
        rowIds: keys.CONSOLE_KEYS.map((row) => row.id),
        rowGateNames: [...new Set(keys.CONSOLE_KEYS.map((row) => row.gate))].sort(),
        rowMounts: [...new Set(keys.CONSOLE_KEYS.map((row) => row.mount))].sort(),
        groups: keys.CONSOLE_GROUPS.map((group) => group.id),
        declaredGroups: [...new Set(keys.CONSOLE_KEYS.map((row) => row.group))],
      };
    });

    // The map the page mounts, in declaration order: the walk, the commit
    // (BOTH its keys — Enter and w are one row), and the sheet's own key.
    expect(read.coldKeys).toEqual(['j', 'k', 'Enter', 'w', '?']);
    // A control holding the keyboard stands down Enter ALONE: w is still
    // bound, and a row-level reading of that rule would silently kill it.
    expect(read.heldKeys).toEqual(['j', 'k', 'w', '?']);
    // With a run watched, the transport arrives from the same list.
    expect(read.watchingKeys).toEqual([
      'j',
      'k',
      'Enter',
      'w',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      '?',
    ]);
    // An empty room binds nothing at all — and the Escape layers are not in
    // this map whatever the state, because a key two overlays both answer to
    // is decided by stacking, not by a gate.
    expect(read.emptyKeys).toEqual(['?']);
    // A row the page supplies no handler for contributes no key.
    expect(read.partialKeys).toEqual(['j', 'Enter', 'w', '?']);

    // The layering, said once: the panel is above the pane, so the pane's
    // Escape is only live while the panel is shut.
    expect(read.layers).toEqual({
      panelOpen: true,
      paneUnderPanel: false,
      paneAlone: true,
      panelAlone: false,
      notALayer: false,
      emptyRoom: false,
    });

    // The aria strings, from the same rows: what the grid claims, what the
    // pane claims, and the empty string a surface must turn into no
    // attribute at all rather than an empty claim.
    expect(read.strings).toEqual({
      grid: 'j k Enter w',
      gridHeld: 'j k w',
      pane: 'ArrowLeft ArrowRight Home End Escape',
      paneUnderPanel: 'ArrowLeft ArrowRight Home End',
      paneClosed: '',
      sheet: '?',
      unknownIds: '',
    });

    // Structural: the data itself, because every case above is built on it.
    expect(new Set(read.rowIds).size, 'row ids are unique').toBe(read.rowIds.length);
    expect(read.groups, 'every group in the sheet has a section, in order').toEqual([
      'walk',
      'watch',
      'row',
      'anywhere',
    ]);
    expect(read.declaredGroups.every((id) => read.groups.includes(id)), 'no row names a section that is not rendered').toBe(true);
    expect(read.rowMounts, 'every mount kind is one of the four the sheet documents').toEqual([
      'global',
      'layer',
      'map',
      'primitive',
    ]);
    expect(read.rowGateNames, 'every gate the rows name is a real gate or "always"').toEqual([
      'always',
      'commit',
      'pane',
      'sweep',
      'views',
      'walk',
    ]);
  });

  test('declares the chord namespace beside the keys, and binds only what it runs', async ({
    page,
  }) => {
    // The chords are read by four surfaces — the hook that dispatches them,
    // the chip that offers them, the sheet that documents them and this
    // file — and the point of declaring them in the keys' module is that
    // there is one list behind all four. So the table is asserted exactly:
    // a reworded label, a key moved, a gate loosened or a chord renamed is
    // a deliberate change here, not a silent one in the UI.
    await page.goto('about:blank');
    await loadConsoleKeys(page);

    const read = await page.evaluate(() => {
      const consoleApi = (
        window as unknown as {
          __console: {
            CONSOLE_CHORDS: Array<{ id: string; keys: string; label: string; group: string; gate: string }>;
            CONSOLE_GROUPS: Array<{ id: string }>;
            consoleGates: (state: unknown) => ConsoleGates;
            liveChordMap: (
              gates: ConsoleGates,
              runs: Record<string, (() => void) | undefined>,
            ) => Record<string, () => void>;
            armedChords: (prefix: string, gates: ConsoleGates) => Array<{ keys: string }>;
          };
        }
      ).__console;

      // Behaviour for every chord id the page supplies, so a chord with no
      // handler shows up as a missing chord rather than as a binding nobody
      // can see. The values are throwaways: only the SET of chords matters.
      const runs: Record<string, (() => void) | undefined> = {};
      for (const chord of consoleApi.CONSOLE_CHORDS) runs[chord.id] = () => undefined;

      const cold = consoleApi.consoleGates({
        sweepList: ['run-1', 'run-2'],
        watchId: null,
        viewsOpen: false,
        cursorTarget: 'run-1',
        cursorRow: { participant: 'A' },
      });
      const empty = consoleApi.consoleGates({
        sweepList: [],
        watchId: null,
        viewsOpen: false,
        cursorTarget: null,
        cursorRow: null,
      });

      // One chord's behaviour withheld, to prove the map is built from the
      // declaration and not from whatever the page hands over.
      const partial = { ...runs };
      delete partial['jump-last'];

      return {
        table: consoleApi.CONSOLE_CHORDS.map((chord) => [
          chord.id,
          chord.keys,
          chord.label,
          chord.group,
          chord.gate,
        ]),
        coldMap: Object.keys(consoleApi.liveChordMap(cold, runs)),
        emptyMap: Object.keys(consoleApi.liveChordMap(empty, runs)),
        partialMap: Object.keys(consoleApi.liveChordMap(cold, partial)),
        armedCold: consoleApi.armedChords('g', cold).map((chord) => chord.keys),
        armedEmpty: consoleApi.armedChords('g', empty).map((chord) => chord.keys),
        armedOtherPrefix: consoleApi.armedChords('x', cold).length,
        armedNoPrefix: consoleApi.armedChords('', cold).length,
        idCount: new Set(consoleApi.CONSOLE_CHORDS.map((chord) => chord.id)).size,
        prefixes: [...new Set(consoleApi.CONSOLE_CHORDS.map((chord) => chord.keys.split(' ')[0]))],
        lengths: [...new Set(consoleApi.CONSOLE_CHORDS.map((chord) => chord.keys.split(' ').length))],
        groups: [...new Set(consoleApi.CONSOLE_CHORDS.map((chord) => chord.group))].sort(),
        gateNames: [...new Set(consoleApi.CONSOLE_CHORDS.map((chord) => chord.gate))].sort(),
        sectionIds: consoleApi.CONSOLE_GROUPS.map((group) => group.id),
      };
    });

    // The declaration itself, in the order the chip offers it.
    expect(read.table).toEqual([
      ['jump-first', 'g i', 'jump to the first row', 'walk', 'walk'],
      ['jump-last', 'g n', 'jump to the last row', 'walk', 'walk'],
      ['watch-cursor', 'g w', 'watch the cursor row', 'watch', 'commit'],
      ['copy-cursor-link', 'g l', "copy the cursor row's run link", 'row', 'link'],
      ['open-views', 'g v', 'open the saved views', 'anywhere', 'always'],
    ]);

    // The map the hook mounts: every live chord, spelled as the sequence
    // hook takes it. On a cold console all five are live — a room to jump
    // around, a row to watch, a row to link, and a panel that is always
    // there — and each one runs the behaviour supplied for ITS id.
    expect(read.coldMap).toEqual(['g i', 'g n', 'g w', 'g l', 'g v']);
    // An empty room keeps only the one chord that has nothing to do with the
    // room: the gates are the single keys', so there is nowhere to jump and
    // nothing to watch or copy.
    expect(read.emptyMap).toEqual(['g v']);
    // A chord the page supplies no behaviour for contributes nothing, so the
    // sheet cannot document a chord the page would not perform.
    expect(read.partialMap).toEqual(['g i', 'g w', 'g l', 'g v']);

    // What the chip may offer while a prefix is armed: the same chords, the
    // same gates, narrowed by the prefix that is actually armed — and
    // nothing at all for a prefix no chord opens, including the empty one,
    // which must not match every chord by accident.
    expect(read.armedCold).toEqual(['g i', 'g n', 'g w', 'g l', 'g v']);
    expect(read.armedEmpty).toEqual(['g v']);
    expect(read.armedOtherPrefix).toBe(0);
    expect(read.armedNoPrefix).toBe(0);

    // Structural: the shape every reader above depends on. One prefix, one
    // key after it (which is what makes "the armed prefix" a prefix of the
    // chord at all), unique ids for the behaviour record to be keyed by, and
    // sections and gates that are the keys' own vocabulary rather than a
    // second one.
    expect(read.idCount, 'chord ids are unique').toBe(read.table.length);
    expect(read.prefixes, 'every chord shares one prefix key').toEqual(['g']);
    expect(read.lengths, 'every chord is a prefix and one key').toEqual([2]);
    expect(read.groups, 'chords are sorted into the same sections as the keys').toEqual([
      'anywhere',
      'row',
      'walk',
      'watch',
    ]);
    expect(read.sectionIds).toEqual(['walk', 'watch', 'row', 'anywhere']);
    expect(read.groups.every((id) => read.sectionIds.includes(id))).toBe(true);
    expect(read.gateNames, 'every chord gate is a gate the single keys already use').toEqual([
      'always',
      'commit',
      'link',
      'walk',
    ]);
  });

  test('no reachable state lets two bindings claim one key, and every gate is reachable', async ({
    page,
  }) => {
    // The guards above check the declaration against a handful of named
    // rooms and against tables written here. This one checks it against
    // ITSELF: the state space is enumerated, and the coherence its
    // one-declaration design promises is asserted everywhere in it, so a row
    // added to the declaration cannot quietly collide with a row already
    // there — which is the failure a single key map makes silent, since the
    // later binding simply wins and the sheet goes on documenting both.
    //
    // Two claims, the ones the sheet's own honesty rests on:
    //
    //   1. No reachable state lets two bindings claim one key. The console
    //      binds through three surfaces, and each is checked on its own
    //      terms because each fails differently: the single KEY MAP (two live
    //      rows on one key, where the second silently clobbers the first), the
    //      ordered LAYERS (two live layers on one key, where one press closes
    //      two things — the bug `under` exists to prevent), and the CHORD
    //      namespace (two live chords on one sequence, which the sequence
    //      hook's map would collapse the same way).
    //
    //      Escape is the one key that legitimately appears more than once: the
    //      sheet closes with its own Radix dismissal, and the panel and the
    //      pane each bind it as a layer. The declaration resolves that two
    //      ways and both are asserted here — the two layer rows are stacked by
    //      `under`, so they are never live together, and the third is a
    //      `primitive` row, which may share the POLICY's dismissal key with a
    //      console binding precisely because the policy hands that key to the
    //      open overlay before the page hears it. The dismissal key is read
    //      from the policy module rather than typed here, so the console's
    //      literal and the policy's constant cannot drift apart.
    //
    //   2. Every declared gate is reachable from some real console state, and
    //      read by something. A gate no state can satisfy is a documented key
    //      nobody can ever press; a gate no binding reads is a name with no
    //      meaning. Both are the same class of dead weight, and neither is
    //      visible in the sheet.
    //
    // The state space is enumerated OVER the console's real invariants rather
    // than over every combination of the five fields, because several
    // combinations cannot happen and a guard that let them count would accept
    // a gate that is only ever true somewhere the console cannot be. Two are
    // worth naming. `cursorTarget` is never null in a room that has rows —
    // the page falls back to the first visible row — so it is drawn from the
    // room rather than from all six values. And `watchId` MAY sit outside the
    // room, because a shared `?watch=` link to a run the facets have hidden is
    // a state this console explicitly supports (that is the `hiddenByFacet`
    // branch), so one run id outside the room is drawn as well.
    await page.goto('about:blank');
    await loadConsoleKeys(page);
    await loadGuards(page);

    const read = await page.evaluate(() => {
      const api = (window as unknown as { __console: ConsoleDeclarationApi }).__console;
      const guards = (window as unknown as { __guards: { OVERLAY_DISMISS_KEY: string } }).__guards;

      // ── The reachable states ──
      // Three runs is more room than any gate asks about — they turn on
      // emptiness, single-versus-multiple, and membership — and the sizes
      // below are walked anyway so the enumeration cannot be the thing that
      // decided a gate was reachable.
      const RUNS = ['r1', 'r2', 'r3'];
      const states: Array<{ label: string; state: ConsoleState }> = [];
      for (const size of [0, 1, 2, 3]) {
        const room = RUNS.slice(0, size);
        // Nothing watched, any row watched, or a run the room does not hold.
        const watchIds: Array<string | null> = [null, ...room, 'ghost'];
        // The cursor is a MEMBER whenever the room is not empty.
        const targets: Array<string | null> = room.length === 0 ? [null] : [...room];
        for (const watchId of watchIds) {
          for (const cursorTarget of targets) {
            for (const viewsOpen of [false, true]) {
              states.push({
                label: `room=[${room.join(',')}] watch=${watchId === null ? 'none' : watchId} views=${viewsOpen ? 'open' : 'shut'} cursor=${cursorTarget === null ? 'none' : cursorTarget}`,
                state: {
                  sweepList: [...room],
                  watchId,
                  viewsOpen,
                  cursorTarget,
                  // The page derives this from the target, so it is null
                  // exactly when the target is.
                  cursorRow: cursorTarget === null ? null : { participant: cursorTarget },
                },
              });
            }
          }
        }
      }

      const violations: string[] = [];
      const firstTrue: Record<string, string> = {};
      const sharedAcrossMounts = new Set<string>();

      for (const entry of states) {
        const gates = api.consoleGates(entry.state);
        const values = gates as unknown as Record<string, boolean>;
        for (const name of Object.keys(values)) {
          if (values[name] === true && firstTrue[name] === undefined) firstTrue[name] = entry.label;
        }

        const mapClaims: Record<string, string[]> = {};
        const layerClaims: Record<string, string[]> = {};
        const overlayKeys = new Set<string>();
        for (const row of api.CONSOLE_KEYS) {
          // `held` is left false — the state where a focused control yields
          // Enter — because a yield can only REMOVE a key, so the unheld map
          // is a superset of what can ever be bound and the conservative one
          // to check collisions against.
          if (row.mount === 'map' && api.rowIsLive(row, gates)) {
            for (const key of row.keys) mapClaims[key] = [...(mapClaims[key] ?? []), row.id];
          }
          if (row.mount === 'layer' && api.layerIsLive(row.id, gates)) {
            for (const key of row.keys) layerClaims[key] = [...(layerClaims[key] ?? []), row.id];
          }
          if ((row.mount === 'primitive' || row.mount === 'global') && api.rowIsLive(row, gates)) {
            for (const key of row.keys) overlayKeys.add(key);
          }
        }
        for (const key of Object.keys(mapClaims)) {
          if (mapClaims[key].length > 1) {
            violations.push(`${entry.label}: the key map binds ${key} to ${mapClaims[key].join(' and ')} at once`);
          }
        }
        for (const key of Object.keys(layerClaims)) {
          if (layerClaims[key].length > 1) {
            violations.push(`${entry.label}: two layers both answer ${key} (${layerClaims[key].join(' and ')})`);
          }
        }
        const consoleKeys = new Set([...Object.keys(mapClaims), ...Object.keys(layerClaims)]);
        for (const key of overlayKeys) if (consoleKeys.has(key)) sharedAcrossMounts.add(key);

        const chordClaims: Record<string, string[]> = {};
        for (const chord of api.CONSOLE_CHORDS) {
          if (api.gateIsLive(chord.gate, gates)) {
            chordClaims[chord.keys] = [...(chordClaims[chord.keys] ?? []), chord.id];
          }
        }
        for (const sequence of Object.keys(chordClaims)) {
          if (chordClaims[sequence].length > 1) {
            violations.push(`${entry.label}: two chords share the sequence ${sequence} (${chordClaims[sequence].join(' and ')})`);
          }
        }
      }

      const allKeys = new Set(api.CONSOLE_KEYS.flatMap((row) => [...row.keys]));
      const prefixes = [...new Set(api.CONSOLE_CHORDS.map((chord) => chord.keys.split(' ')[0]))];
      const sequences = api.CONSOLE_CHORDS.map((chord) => chord.keys);

      const gateNames = Object.keys(
        api.consoleGates({ sweepList: [], watchId: null, viewsOpen: false, cursorTarget: null, cursorRow: null }),
      ) as Array<keyof ConsoleGates>;
      const named = new Set<string>();
      for (const row of api.CONSOLE_KEYS) {
        named.add(row.gate);
        if (row.under !== undefined) named.add(row.under);
      }
      for (const chord of api.CONSOLE_CHORDS) named.add(chord.gate);

      return {
        stateCount: states.length,
        violations,
        sharedAcrossMounts: [...sharedAcrossMounts],
        dismissalKey: guards.OVERLAY_DISMISS_KEY,
        // A single key that is also a chord's prefix would be armed as a
        // namespace and fired as a command by the same press.
        prefixClashes: prefixes.filter((prefix) => allKeys.has(prefix)),
        // A chord that is a prefix of another chord would fire before the
        // longer one could ever complete.
        chordPrefixClashes: sequences.filter((sequence) =>
          sequences.some((other) => other !== sequence && other.startsWith(`${sequence} `)),
        ),
        unreachable: gateNames.filter((gate) => firstTrue[gate] === undefined),
        unread: gateNames.filter((gate) => !named.has(gate)),
        bogus: [...named].filter((gate) => gate !== 'always' && !gateNames.includes(gate as keyof ConsoleGates)),
      };
    });

    // The enumeration, pinned: 4 room sizes x (size + 2 watch ids) x (size or
    // 1 cursors) x 2 panel states = 4 + 6 + 16 + 30. Pinned rather than
    // described because an enumeration that silently shrank to nothing would
    // make every assertion below pass vacuously.
    expect(read.stateCount, 'every state of a bounded room is enumerated').toBe(56);
    expect(read.violations, 'no reachable state may let two bindings claim one key').toEqual([]);
    expect(
      read.sharedAcrossMounts,
      `an overlay's own dismissal may share only the policy's dismissal key (${read.dismissalKey}) with the console's bindings`,
    ).toEqual([read.dismissalKey]);
    expect(read.prefixClashes, 'no single key may also be a chord prefix').toEqual([]);
    expect(read.chordPrefixClashes, 'no chord may be a prefix of another').toEqual([]);
    expect(read.unreachable, 'every declared gate must be reachable from some real console state').toEqual([]);
    expect(read.unread, 'every declared gate must be read by some binding').toEqual([]);
    expect(read.bogus, 'every gate a binding names must be a real gate').toEqual([]);
  });
});

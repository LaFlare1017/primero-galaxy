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
  await loadModule(page, GUARDS_PATH, ['ownsArrowKeys', 'shortcutAllowed'], '__guards');
}

/** The console's keyboard declaration, as used by the manifest cases below. */
async function loadConsoleKeys(page: Page): Promise<void> {
  await loadModule(
    page,
    CONSOLE_PATH,
    [
      'CONSOLE_KEYS',
      'CONSOLE_GROUPS',
      'consoleGates',
      'gateIsLive',
      'rowIsLive',
      'liveKeyMap',
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
    await page.goto('about:blank');
    await page.evaluate((html) => {
      document.body.innerHTML = html;
    }, FIXTURES);
    await loadGuards(page);

    const verdicts = await page.evaluate(() => {
      const guards = (
        window as unknown as { __guards: { shortcutAllowed: (event: KeyboardEvent) => boolean } }
      ).__guards;
      type Verdicts = { open: boolean; flipped: boolean; removed: boolean; closedAndIdle: boolean };
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
      const press = (mutate: (layer: HTMLElement) => void): boolean => {
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
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        window.removeEventListener('keydown', listener);
        return seen.allowed;
      };
      const verdicts: Verdicts = {
        // Untouched: the ordinary case, the selector alone answers it.
        open: press(() => {}),
        // Dismissed: data-state flipped, node still mounted, still focused.
        flipped: press((layer) => layer.setAttribute('data-state', 'closed')),
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
});

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

/** Load the guards module itself into the page, from its source on disk. */
async function loadGuards(page: Page): Promise<void> {
  const source = readFileSync(GUARDS_PATH, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  // Hand the module's own exports to the page so nothing is re-declared
  // here: if the source renames or drops an export, this spec breaks.
  await page.addScriptTag({
    type: 'module',
    content: `${js}\nwindow.__guards = { ownsArrowKeys, shortcutAllowed };`,
  });
  await page.waitForFunction(() => Boolean((window as unknown as { __guards?: unknown }).__guards));
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
});

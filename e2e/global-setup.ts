/**
 * The suite's room, emptied before anything runs.
 *
 * Every facilitator spec reasons about "the room" — the first and last row, the
 * count in the sweep's `N of M`, the rows a status facet leaves visible. Those
 * are only meaningful answers if the room holds what this run seeded, and that
 * used to depend on something outside the specs' control: the clear lived in
 * `playwright.config.ts`'s `webServer.command`, which Playwright **skips
 * entirely** when `reuseExistingServer` finds a server already listening. So a
 * developer with a server up from a previous run got a room carrying every row
 * that run and every run before it, and the specs failed in ways that read like
 * bugs in the console:
 *
 *   - the grid renders one WINDOW of the room (`GRID_WINDOW` in
 *     app/delegate/facilitator/page.tsx, 200 rows). A room bigger than that
 *     puts a spec's own freshly seeded participant past the window, so
 *     `expect(rowFor(page, SUBMITTED_S5)).toBeVisible()` fails with "element(s)
 *     not found" for a row the spec created seconds earlier;
 *   - and the window's membership slides as rows arrive, so the walk tests that
 *     read the first and last displayed row and then assert the sweep lands on
 *     them are racing the poll — the name belongs to the room at assertion time,
 *     not to the one captured before the keypress.
 *
 * Both were measured here as nine failures with a shifting set, and both go
 * away with an empty room. So the empty room is established HERE, in a
 * `globalSetup`, which runs on every invocation whether or not Playwright is
 * the one who started the server. It is deliberately not a `beforeAll`: this is
 * a property of the run, not of a spec, and a spec that cleared it would be a
 * spec that could clear it out from under the ones that ran before it.
 *
 * What this does NOT fix, and what `reuseExistingServer` being opt-in is for: a
 * server someone started *without* this suite's `DELEGATE_DATA_DIR` is serving
 * a different store entirely — `delegate/data/`, the room a facilitator opens in
 * dev — and no amount of clearing the suite's own directory changes that. The
 * run would seed into the workshop's store. Reusing a server is therefore an
 * explicit choice (see the flag in playwright.config.ts), not a default that
 * quietly inherits whatever happens to be listening.
 */

import { mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';

/** The suite's scratch store — the same path playwright.config.ts hands the server. */
const DATA_DIR = '.next-e2e/delegate-data';

export default function globalSetup(): void {
  const dir = resolve(process.cwd(), DATA_DIR);
  rmSync(dir, { recursive: true, force: true });
  // Created empty rather than left absent: the delegate store creates it on
  // demand, and a directory that exists tells the next reader this was a reset
  // rather than a path nobody has ever written to.
  mkdirSync(dir, { recursive: true });
}

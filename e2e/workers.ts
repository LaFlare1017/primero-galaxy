/**
 * How many workers this run wants, in one place.
 *
 * `playwright.config.ts` uses it to size `workers`, and `globalSetup` uses it to
 * clear one room per worker. Those two have to agree exactly — a config that
 * starts six workers against five cleared rooms leaves the sixth seeding into
 * the first one's leftovers — and they are read by different files, which is
 * where "exactly" is easiest to lose.
 *
 * The default used to be 1, and it was not a resource limit: thirteen specs
 * shared one store and reasoned about it as a whole, so a second worker would
 * have put their rows in each other's room. `e2e/worker-server.ts` is what makes
 * the number safe — one server and one room per worker — so the default is now
 * a number above 1, and `E2E_WORKERS` is the override.
 *
 * The ceiling is deliberately lower than the core count, and the reason is
 * measured rather than assumed. Each worker is a `next start` AND a Chromium,
 * and the suite is not uniform: the facilitator specs are I/O-bound (they wait
 * on a 4s poll) while the galaxy specs are not — they raycast, animate and
 * settle frames, so they need the CPU to themselves to finish inside their
 * timeouts. Measured on a 14-core machine, three of the galaxy and keyboard
 * specs pass at 3 workers and time out at 6, and one of them needs two thirds
 * of its whole budget with nothing else running at all. A worker is not a
 * thread, and past this ceiling the suite stops getting faster and starts
 * failing.
 *
 * So this is a machine-dependent number that CI pins explicitly rather than
 * inheriting: GitHub's runner has four vCPUs, well under what the local default
 * assumes, and a green local run says nothing about a green one there.
 */
import { cpus } from 'os';

/** Above this, the galaxy specs time out rather than run in parallel. */
const CEILING = 4;

export function workerCount(): number {
  const asked = Number(process.env.E2E_WORKERS ?? '');
  if (Number.isFinite(asked) && asked >= 1) return Math.floor(asked);
  return Math.max(1, Math.min(cpus().length - 1, CEILING));
}

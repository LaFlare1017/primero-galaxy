/**
 * Point the Neon serverless driver at a plain-HTTP loopback endpoint.
 *
 * Loaded into the app with `NODE_OPTIONS=--import`, which is the whole reason
 * this file exists. `neon()` builds its endpoint as `"https://" + host + "/sql"`
 * — hardcoded, with no per-query override — so a fake console on loopback,
 * which cannot speak TLS without a certificate nobody should commit to a
 * repository, is unreachable by default. The alternative was to teach
 * `delegate/src/store/postgres-store.ts` about a test-only override, and that
 * is product code: it is the driver the deployed serverless function runs, and
 * a variable that exists only so a test can reach a fake is a variable somebody
 * eventually ships a value for. This configures the driver's own documented
 * global before the app imports it.
 *
 * ── why every copy is patched ─────────────────────────────────────────
 *
 * `neonConfig` is a per-MODULE-INSTANCE global, and this repository has three
 * copies of the driver that can each be the one the app loads:
 *
 *   1. the root package's ESM entry, imported by ESM code;
 *   2. the root package's CJS entry, loaded by `require`;
 *   3. **`delegate/node_modules`'s own copy** — the delegate workspace declares
 *      `@neondatabase/serverless` as its own dependency and installs it
 *      separately, so `delegate/dist/store/postgres-store.js` resolves
 *      `import("@neondatabase/serverless")` to THAT copy and not to the root's.
 *
 * Patching only some of them produces a failure that names nothing useful: the
 * unpatched copy ignores the override, builds its default endpoint, rewrites
 * the host for Neon (`127.` becomes `api.`), and the app reports
 *
 *     Error connecting to database: TypeError: Failed to parse URL from
 *     https://api.0.0.1/sql
 *
 * which mentions neither the preload nor the variable. That rewrite is also why
 * the message is so confusing: it looks like a malformed URL rather than a
 * configuration that did not apply.
 *
 * So: the ESM entry is patched through `import`, and the CJS entries are
 * patched through `createRequire` anchored at each package that has one. An
 * ESM preload is fully evaluated before the entry module loads, so every patch
 * is in place before the app can ask for a client — which a `--require` preload
 * cannot promise, since it cannot await.
 *
 * The env var is required rather than defaulted: a preload that guessed an
 * endpoint would point a real run at localhost, and the failure would be a
 * store that cannot connect rather than a config that was never set.
 */
import { createRequire } from 'node:module';

const endpoint = process.env.NEON_LOOPBACK_ENDPOINT;
if (typeof endpoint === 'string' && endpoint !== '') {
  const { neonConfig } = await import('@neondatabase/serverless');
  neonConfig.fetchEndpoint = endpoint;

  // Anchored per package, so each install on disk is patched. `delegate/` is not
  // optional: it is the copy the store actually resolves, which is the whole
  // reason the override appeared to be ignored.
  const roots = [new URL('../package.json', import.meta.url), new URL('../delegate/package.json', import.meta.url)];
  for (const root of roots) {
    try {
      createRequire(root)('@neondatabase/serverless').neonConfig.fetchEndpoint = endpoint;
    } catch {
      // A package with no install of its own: the copy above already covers it,
      // and a preload must not be the reason a run cannot start.
    }
  }
}
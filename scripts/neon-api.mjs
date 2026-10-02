/**
 * The one place a Neon management call is made.
 *
 * Three programs talk to the console's v2 API — the one that provisions the CI
 * project and its empty parent branch, and the one that creates the branch a
 * single run lives on — plus the fake console that stands in for it under
 * `--self-test-e2e`. They agreed on the URL, the bearer header and the shape of
 * an error because they all called the same function, which is the arrangement
 * that keeps a wrong assumption in one file instead of four.
 *
 * Split out of `neon-secrets.mjs` for a reason that is not tidiness: a test
 * server that lives inside the program it tests can only be used by that
 * program. Anything else that wants a console on localhost — the branch
 * program's checks, a spec that needs an id the hard way — had to import the
 * provisioning program to get at it, which is a dependency backwards and makes
 * the provisioning program impossible to delete without losing a fake.
 *
 * The client is here rather than in the fake module on purpose. A consumer
 * needs both, and the pairing is the point: the fake answers what this sends,
 * which is why a test against it can say something about the request shape at
 * all. It is also why the fake is strict where a real console is strict — a
 * console that accepted anything would not be testing anything.
 */
import { spawnSync } from 'node:child_process';

export const DEFAULT_API = 'https://console.neon.tech/api/v2';

/**
 * Where the management calls go. Settable because a stubbed `fetch` proves the
 * decisions but not the REQUESTS -- the URL, the method, the JSON body, the
 * status a real console answers with. The end-to-end checks point this at a
 * server on localhost, which is the only way to see those without an account.
 *
 * `NEON_API_URL` is for pointing at a different console, not for testing: those
 * checks pass their base explicitly instead, so nothing in production depends
 * on this variable being right.
 */
export function apiBase(env = process.env) {
  return (env.NEON_API_URL ?? '').trim() || DEFAULT_API;
}

/**
 * One Neon management call. `fetch` is a parameter so a check can stand a stub
 * in for it -- the endpoints are the part that cannot be checked without an
 * account, and the decisions around them are the part that can.
 *
 * A non-2xx is a thrown `Error` carrying the status and the console's own
 * message, because every caller here makes a different decision about a failure
 * and all of them need to be able to say which call failed. That is why this
 * returns the parsed body rather than the `Response`: the callers here want
 * `.branch.id` and the console's error text, not a stream.
 */
export async function neon(path, { apiKey, base = apiBase(), fetchImpl = fetch, method = 'GET', body }) {
  const response = await fetchImpl(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // A body that is not JSON is a proxy error or a captive portal, and
    // reporting its first line beats reporting a parse error.
    const first = text.split('\n').find((line) => line.trim() !== '') ?? '(empty)';
    throw new Error(`Neon ${method} ${path} answered ${response.status} with a body that is not JSON: ${first.slice(0, 120)}`);
  }
  if (!response.ok) {
    const detail = json?.error?.message ?? json?.message ?? '(no message)';
    throw new Error(`Neon ${method} ${path} answered ${response.status}: ${detail}`);
  }
  return json;
}

/**
 * `gh secret set`, with the value on stdin.
 *
 * In this module rather than in the provisioning program because the value has
 * to reach `gh` without being in an argument list -- `ps` shows it and the shell
 * history keeps it -- and a property that easy to get wrong does not belong in
 * two files.
 */
export function setSecret(repo, name, value) {
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', repo], {
    input: value,
    encoding: 'utf8',
  });
  if (result.error) throw new Error(`could not run gh: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`gh secret set ${name} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
}
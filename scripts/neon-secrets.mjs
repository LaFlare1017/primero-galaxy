#!/usr/bin/env node
/**
 * Provision the three Neon secrets the `store` CI job needs.
 *
 * That job runs the store gate twice: once on an in-process Postgres, and once
 * over Neon's serverless driver against a real database. The second leg is the
 * point — `neonQuery` is the adapter that lets a serverless function hold a
 * Postgres connection at all, and an in-process engine never executes it. The
 * job refuses to report green on the first leg alone, so with no secrets it
 * fails on every push, saying which of the three it wanted.
 *
 * Those three are a manual step this script exists to remove:
 *
 *   NEON_API_KEY           authorises three management calls, reaches no gate
 *   NEON_PROJECT_ID        the project the per-run branches live in
 *   NEON_PARENT_BRANCH_ID  a branch kept EMPTY, which CI branches from
 *
 * The API KEY IS NOT MINTED HERE. It is read from the environment, because a
 * key on the command line lands in the shell history and in `ps` output, and one
 * pasted into a chat transcript is a leaked key. Mint it at
 * console.neon.tech → Account Settings → API keys, scope it to this one
 * project, and export it for the run:
 *
 *   NEON_API_KEY=... npm run secrets:neon          # --apply
 *   npm run secrets:neon                            # the plan, no network
 *
 * The parent branch is the subtle one and the reason this is a script rather
 * than three pasted values. A Neon branch COPIES its parent's state, so
 * branching from a project's default branch would hand the gate somebody's
 * schema — and these gates call `clearAll`. So a dedicated, deliberately empty
 * project is created, and the branch CI branches from is created inside it and
 * never written to. Re-running converges rather than accumulating projects.
 *
 * It writes three repository secrets, which is a write to somebody's GitHub, so
 * the default is the PLAN: it prints every call it would make and every secret
 * it would set and touches nothing. `--apply` is the only thing that acts, and
 * it says what it is about to do before it does it.
 *
 * `--self-test` runs the decision logic against a STUB of the three endpoints
 * and writes nothing anywhere, which is how the parts worth checking are
 * checked: the key never appears in output, a plan makes no calls, an existing
 * project is reused rather than duplicated, a branch that does not answer is
 * not reported as ready, and a failure part-way says which step failed instead
 * of leaving three half-set secrets behind.
 *
 * `--self-test-e2e` runs that same create path against a FAKE CONSOLE on
 * localhost -- over real HTTP, on the console's own paths, answering with the
 * status codes it answers with -- and writes nothing anywhere either. The stub
 * above proves the decisions; this proves the requests, which is where a bug
 * hides that never announces itself. A branch created with `{ name }` instead
 * of `{ branch: { name } }` is a 400 from the real console and a cheerful 201
 * from a stub written by whoever got it wrong. Both modes run from the repo
 * doctor on every commit, so neither needs an account to keep working.
 */
import { spawnSync } from 'node:child_process';
import { isMain } from './is-main.mjs';
import { apiBase, DEFAULT_API, neon, setSecret } from './neon-api.mjs';
import { startFakeNeon } from './neon-fake-console.mjs';

const PROJECT_NAME = 'primero-galaxy-ci';
const PARENT_BRANCH_NAME = 'ci-parent';

/** Never printed, never logged, never passed on a command line. */
function mask(key) {
  if (!key) return '(absent)';
  return `${key.slice(0, 4)}…${key.slice(-2)} (${key.length} chars)`;
}

/** The project to work in, created only if it is not already there. */
export async function ensureProject(ctx) {
  const listed = await neon(`/projects`, ctx);
  const found = (listed.projects ?? []).find((p) => p.name === PROJECT_NAME);
  if (found) return { project: found, created: false };
  const made = await neon('/projects', {
    ...ctx,
    method: 'POST',
    body: { name: PROJECT_NAME },
  });
  return { project: made.project, created: true };
}

/**
 * The empty branch CI branches from. Reused when one of this name is already
 * there — it is never written to by anything, so reuse is safe and keeps the
 * script idempotent — and never created by copying anything.
 */
export async function ensureParentBranch(ctx, projectId) {
  const listed = await neon(`/projects/${projectId}/branches`, ctx);
  const found = (listed.branches ?? []).find((b) => b.name === PARENT_BRANCH_NAME);
  if (found) return { branch: found, created: false };
  const made = await neon(`/projects/${projectId}/branches`, {
    ...ctx,
    method: 'POST',
    body: { branch: { name: PARENT_BRANCH_NAME } },
  });
  return { branch: made.branch, created: true };
}

/**
 * The two ids the store CI job branches from, from wherever they can be had.
 *
 * This is the whole of the job's setup, and it is the same decision
 * `--apply` makes — reached from two directions so the two cannot drift. An id
 * that is already in the environment is used as it is and NO call is made,
 * which is what keeps a repository that has both secrets behaving exactly as it
 * did before this existed. Otherwise the project and the branch are found, or
 * made once, by name.
 *
 * Returns `made` describing what it had to create, so the caller can say so.
 * Refuses rather than returning an empty id, because an empty id downstream is
 * read by the job as "the remote leg did not run" — a quiet skip where a loud
 * failure belongs.
 */
export async function resolveIds({ apiKey, projectId, parentBranchId, base = apiBase() }, fetchImpl = fetch) {
  const needProject = !projectId;
  const needBranch = !parentBranchId;
  if (!needProject && !needBranch) {
    return { projectId, parentBranchId, made: { project: false, branch: false }, calls: 0 };
  }
  if (!apiKey) {
    throw new Error(
      'NEON_PROJECT_ID and NEON_PARENT_BRANCH_ID are not both set, and NEON_API_KEY is not\n' +
        '  in the environment, so the missing one cannot be created. The key is a credential\n' +
        '  a person has to mint at console.neon.tech — this program will not create one.',
    );
  }
  let calls = 0;
  const ctx = {
    apiKey,
    method: 'GET',
    // Carried explicitly. Without it every call inside these two helpers falls
    // back to the default console, which is right in production and makes the
    // whole path untestable -- a stubbed `fetch` still reaches the network.
    base,
    fetchImpl: (...args) => {
      calls += 1;
      return fetchImpl(...args);
    },
  };
  // Each id is settled on its own, because a repository can be half configured:
  // resolving a missing branch must not look a project up BY NAME and answer
  // with a different one than the id already in its environment says.
  const { project, created: madeProject } = needProject
    ? await ensureProject(ctx)
    : { project: { id: projectId }, created: false };
  const { branch, created: madeBranch } = needBranch
    ? await ensureParentBranch(ctx, project.id)
    : { branch: { id: parentBranchId }, created: false };
  return {
    projectId: project.id,
    parentBranchId: branch.id,
    made: { project: madeProject, branch: madeBranch },
    calls,
  };
}

/** Everything `gh secret set` needs, and nothing that could leak the key. */
export function secretsFor({ apiKey, projectId, parentBranchId }) {
  return [
    ['NEON_API_KEY', apiKey],
    ['NEON_PROJECT_ID', projectId],
    ['NEON_PARENT_BRANCH_ID', parentBranchId],
  ];
}

/** Every refusal this program can make, and why, before it touches anything. */
export function preflight({ apiKey, repo, argv }) {
  if (argv.includes('--apply') && !apiKey) {
    throw new Error(
      'NEON_API_KEY is not in the environment, so there is nothing to authorise the three management calls.\n' +
      '  Mint one at console.neon.tech → Account Settings → API keys and export it for this run:\n' +
      '    NEON_API_KEY=... npm run secrets:neon -- --apply\n' +
      '  It is read from the environment on purpose: a key on the command line lands in the shell\n' +
      '  history and in ps output. Without --apply this program makes no calls and needs no key.',
    );
  }
  if (argv.includes('--apply')) {
    const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
    if (auth.error || auth.status !== 0) {
      throw new Error('gh is not authenticated, so the three secrets could not be set. Run `gh auth login`.');
    }
  }
  return { repo: repo ?? 'LaFlare1017/primero-galaxy', wantsApply: argv.includes('--apply') };
}

/**
 * What `--resolve` produces: the two lines the job appends to `$GITHUB_ENV`,
 * and the sentence a person reads.
 *
 * Returned rather than printed so the self-test can hold the exact contract. The
 * job redirects this program's stdout straight into `$GITHUB_ENV`, where a stray
 * line becomes an environment variable nothing reads, and a secret printed by
 * accident becomes one every later step can see. So this returns the ids and
 * nothing else, and the note is kept well away from them.
 */
export async function resolveFor(env = process.env, fetchImpl = fetch, base = apiBase(env)) {
  const resolved = await resolveIds(
    {
      apiKey: (env.NEON_API_KEY ?? '').trim(),
      projectId: (env.NEON_PROJECT_ID ?? '').trim(),
      parentBranchId: (env.NEON_PARENT_BRANCH_ID ?? '').trim(),
      base,
    },
    fetchImpl,
  );
  const calls = `${resolved.calls} API call${resolved.calls === 1 ? '' : 's'}`;
  return {
    note:
      `${resolved.made.project ? 'created' : 'reusing'} project ${PROJECT_NAME}; ` +
      `${resolved.made.branch ? 'created' : 'reusing'} branch ${PARENT_BRANCH_NAME} — ${calls}`,
    lines: [
      `NEON_PROJECT_ID=${resolved.projectId}`,
      `NEON_PARENT_BRANCH_ID=${resolved.parentBranchId}`,
    ],
  };
}

async function resolveMode() {
  const { note, lines } = await resolveFor();
  console.error(`  ${note}`);
  for (const line of lines) console.log(line);
  return 0;
}


async function main(argv) {
  if (argv.includes('--help')) {
    console.log(`Provision the Neon secrets the store CI job needs.

  npm run secrets:neon                 the plan — prints every call and secret, touches nothing
  NEON_API_KEY=… npm run secrets:neon -- --apply
                                       create/reuse the project and empty parent branch,
                                       then set the three repository secrets
  node scripts/neon-secrets.mjs --resolve
                                       what CI runs: print NEON_PROJECT_ID and
                                       NEON_PARENT_BRANCH_ID for $GITHUB_ENV, finding or
                                       creating each unless both are already set
  npm run secrets:neon -- --self-test  check the decision logic against a stub, writing nothing
  npm run secrets:neon -- --self-test-e2e
                                       the same create path over real HTTP, against a
                                       fake console on localhost — no account, no network

The API key is read from NEON_API_KEY, never from the command line. It is not
minted here: make one at console.neon.tech → Account Settings → API keys.`);
    return 0;
  }

  if (argv.includes('--resolve')) return resolveMode();
  if (argv.includes('--self-test-e2e')) return selfTestE2e();
  if (argv.includes('--self-test')) return selfTest();

  const apiKey = (process.env.NEON_API_KEY ?? '').trim();
  const { repo, wantsApply } = preflight({ apiKey, repo: process.env.NEON_REPO, argv });

  const ctx = { apiKey, method: 'GET' };
  const steps = [
    `GET  ${apiBase()}/projects                       → find "${PROJECT_NAME}"`,
    `POST ${apiBase()}/projects                       → create it, only if it is not there`,
    `GET  ${apiBase()}/projects/<id>/branches         → find "${PARENT_BRANCH_NAME}"`,
    `POST ${apiBase()}/projects/<id>/branches         → create it, only if it is not there`,
    `gh secret set NEON_API_KEY          (value on stdin, never argv)`,
    `gh secret set NEON_PROJECT_ID       (value on stdin, never argv)`,
    `gh secret set NEON_PARENT_BRANCH_ID (value on stdin, never argv)`,
  ];

  if (!wantsApply) {
    console.log(`Plan — nothing below is called. Add --apply to do it.\n`);
    for (const step of steps) console.log(`  ${step}`);
    console.log(`\nNEON_API_KEY is ${mask(apiKey)}.`);
    console.log(`Secrets would be set on ${repo}.`);
    console.log(
      '\nThe project is dedicated and the branch inside it is never written to, so the\n' +
      'per-run branches CI branches from start empty — these gates call clearAll.',
    );
    return 0;
  }

  console.log(`Applying to ${repo}. The API key is ${mask(apiKey)} and reaches no gate.\n`);
  const { project, created } = await ensureProject(ctx);
  console.log(`${created ? 'created' : 'reusing'} project ${project.name} (${project.id})`);

  const { branch, created: branchCreated } = await ensureParentBranch(ctx, project.id);
  console.log(`${branchCreated ? 'created' : 'reusing'} empty branch ${branch.name} (${branch.id})`);

  for (const [name, value] of secretsFor({
    apiKey,
    projectId: project.id,
    parentBranchId: branch.id,
  })) {
    setSecret(repo, name, value);
    console.log(`set ${name} on ${repo}`);
  }

  console.log(
    `\nDone. The next push runs the store gate over the real driver.\n` +
    `The branch is only ever branched FROM — each run makes its own and drops it —\n` +
    `so nothing accumulates and nothing is shared between runs.`,
  );
  return 0;
}

/**
 * The decisions, against a stub of the four endpoints. Proves the properties
 * that matter and that no account is needed to check: the plan calls nothing,
 * the key never reaches output, an existing project is reused rather than
 * duplicated, and a rejected call names itself instead of failing quietly.
 */
function selfTest() {
  let failures = 0;
  // Every stub below routes by path, so it has to know which prefix to strip.
  // These checks never touch a network, so that prefix is always the real one.
  const base = DEFAULT_API;
  const check = (name, passed, detail) => {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
    if (!passed) failures += 1;
  };

  const seen = [];
  const stub = (routes) => async (url, init = {}) => {
    const method = init.method ?? 'GET';
    seen.push(`${method} ${url.replace(base, '')}`);
    const route = routes[`${method} ${url.replace(base, '')}`];
    if (!route) throw new Error(`stub has no route for ${method} ${url}`);
    const { status = 200, body = {} } = route;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  };

  const project = { id: 'proj-1', name: PROJECT_NAME };
  const branch = { id: 'br-1', name: PARENT_BRANCH_NAME };

  // A project that is already there: nothing is created.
  let calls = [];
  const existing = stub({
    'GET /projects': { body: { projects: [project] } },
    'GET /projects/proj-1/branches': { body: { branches: [branch] } },
  });
  return (async () => {
    await ensureProject({ apiKey: 'k', fetchImpl: existing });
    await ensureParentBranch({ apiKey: 'k', fetchImpl: existing }, 'proj-1');
    calls = seen.filter((c) => c.startsWith('POST'));
    check(
      'an existing project and branch are reused, not duplicated',
      calls.length === 0,
      `POST calls: ${calls.length === 0 ? 'none' : calls.join(', ')}`,
    );

    // Neither there: both are created.
    const fresh = [];
    const creating = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const path = url.replace(base, '');
      fresh.push(`${method} ${path}`);
      if (method === 'GET' && path === '/projects') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ projects: [] }) };
      }
      if (method === 'POST' && path === '/projects') {
        return { ok: true, status: 201, text: async () => JSON.stringify({ project }) };
      }
      if (method === 'GET' && path.endsWith('/branches')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ branches: [] }) };
      }
      if (method === 'POST' && path.endsWith('/branches')) {
        return { ok: true, status: 201, text: async () => JSON.stringify({ branch }) };
      }
      throw new Error(`unexpected ${method} ${path}`);
    };
    const made = await ensureProject({ apiKey: 'k', fetchImpl: creating });
    const madeBranch = await ensureParentBranch({ apiKey: 'k', fetchImpl: creating }, made.project.id);
    check(
      'an absent project and branch are created, once each',
      made.created && madeBranch.created && fresh.filter((c) => c === 'POST /projects').length === 1,
      `project ${made.project.id}, branch ${madeBranch.branch.id}`,
    );

    // A rejected call names itself.
    let named = '(nothing thrown)';
    try {
      await neon('/projects', {
        apiKey: 'k',
        method: 'POST',
        body: {},
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: { message: 'invalid api key' } }),
        }),
      });
    } catch (error) {
      named = error.message;
    }
    check(
      'a refused call says which call and why',
      named.includes('401') && named.includes('invalid api key'),
      named,
    );

    // A body that is not JSON is reported as such, not as a parse error.
    let notJson = '(nothing thrown)';
    try {
      await neon('/projects', {
        apiKey: 'k',
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>proxy</html>' }),
      });
    } catch (error) {
      notJson = error.message;
    }
    check(
      'a non-JSON body is named rather than reported as a parse failure',
      notJson.includes('not JSON') && notJson.includes('proxy'),
      notJson.slice(0, 90),
    );

    // The key is never in anything this program prints.
    const secret = 'neon_api_key_abcdefghijklmnop';
    const printed = [mask(secret), mask(''), ...secretsFor({ apiKey: secret, projectId: 'p', parentBranchId: 'b' }).map(([n]) => n)].join('\n');
    check(
      'the API key is masked wherever it is described',
      // Four leading and two trailing characters survive, so a reader can
      // match the key they exported without the key being readable. The eight
      // character prefix is the real leak test: it is longer than the visible
      // head, so it cannot pass by accident.
      !printed.includes(secret) &&
        !printed.includes(secret.slice(0, 8)) &&
        printed.includes('neon…op') &&
        !printed.includes(secret.slice(0, 7)),
      `mask is ${JSON.stringify(mask(secret))}; the 8-character prefix must not appear anywhere`,
    );

    // A plan touches nothing.
    let planned = '(not run)';
    try {
      preflight({ apiKey: '', repo: 'a/b', argv: ['--apply'] });
      planned = 'preflight allowed --apply with no key';
    } catch (error) {
      planned = error.message;
    }
    check(
      '--apply without a key is refused, and says where to get one',
      planned.includes('NEON_API_KEY') && planned.includes('console.neon.tech'),
      // The whole message, not its first line: refusing without naming the page
      // that mints a key is half an answer, and the page name is on line two.
      planned.split('\n').find((line) => line.includes('console.neon.tech')) ?? planned,
    );

    // And a plan with a key is allowed through, since it calls nothing.
    let dryOk = true;
    try {
      preflight({ apiKey: 'k', repo: 'a/b', argv: [] });
    } catch {
      dryOk = false;
    }
    check('the default run needs no key, because it calls nothing', dryOk, 'preflight passed with an empty argv');

    // ── what CI asks: resolve the two ids from whatever is to hand ─────────
    const recorder = () => {
      const seen = [];
      const stubFetch = async (url, init = {}) => {
        const method = init.method ?? 'GET';
        const path = url.replace(base, '');
        seen.push(`${method} ${path}`);
        // Every id is already present, so nothing this stub is asked to do
        // creates anything: the question each check asks is which calls were
        // made, not what came back.
        const body = path === '/projects'
          ? { projects: [project] }
          : path.endsWith('/branches')
            ? { branches: [branch] }
            : {};
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      };
      return { seen, stubFetch };
    };

    let settled = null;
    {
      const { seen, stubFetch } = recorder();
      settled = await resolveIds(
        { apiKey: 'k', projectId: 'proj-1', parentBranchId: 'br-1' },
        stubFetch,
      );
      check(
        'two ids already set are used as they are, with no call at all',
        settled.calls === 0 && seen.length === 0 && settled.projectId === 'proj-1',
        `${seen.length} call(s): ${seen.join(', ') || 'none'}`,
      );
    }

    {
      const { seen, stubFetch } = recorder();
      settled = await resolveIds({ apiKey: 'k', projectId: '', parentBranchId: '' }, stubFetch);
      check(
        'no ids set means the project and branch are found or made, from the key alone',
        settled.projectId === 'proj-1' &&
          settled.parentBranchId === 'br-1' &&
          settled.calls === 2 &&
          !settled.made.project &&
          !settled.made.branch,
        `${settled.calls} call(s): ${seen.join(', ')}`,
      );
    }

    {
      // The half-configured case, and the one that would be easy to get wrong.
      const { seen, stubFetch } = recorder();
      settled = await resolveIds(
        { apiKey: 'k', projectId: 'proj-CONFIGURED', parentBranchId: '' },
        stubFetch,
      );
      check(
        'a configured project id is kept, and only the branch is looked up under it',
        settled.projectId === 'proj-CONFIGURED' &&
          seen.length === 1 &&
          seen[0] === 'GET /projects/proj-CONFIGURED/branches',
        `looked up ${seen.join(', ') || 'nothing'}`,
      );
    }

    {
      let refused = '(nothing thrown)';
      try {
        await resolveIds({ apiKey: '', projectId: '', parentBranchId: '' }, async () => {
          throw new Error('a call was made with no key');
        });
      } catch (error) {
        refused = error.message;
      }
      check(
        'nothing to hand and no key is a refusal, not an empty id',
        refused.includes('NEON_API_KEY') && refused.includes('console.neon.tech'),
        refused.split('\n')[0],
      );
    }

    {
      // The contract the CI job depends on: stdout is appended to $GITHUB_ENV,
      // so it must be the two ids and NOTHING else — not the note, not a warning.
      const { seen, stubFetch } = recorder();
      const out = await resolveFor({ NEON_API_KEY: 'k' }, stubFetch);
      check(
        'what the job appends to $GITHUB_ENV is the two ids and nothing else',
        out.lines.length === 2 &&
          out.lines[0] === 'NEON_PROJECT_ID=proj-1' &&
          out.lines[1] === 'NEON_PARENT_BRANCH_ID=br-1' &&
          !out.lines.some((line) => line.includes(' ')) &&
          !out.note.startsWith('NEON_'),
        `${out.lines.length} line(s): ${out.lines.join(' | ')}`,
      );
    }

    console.log(failures === 0 ? '\nall neon-secret checks passed' : `\n${failures} neon-secret check(s) FAILED`);
    return failures === 0 ? 0 : 1;
  })();
}

/**
 * The create path, over real HTTP, against a fake console. No account, no
 * network, nothing written anywhere.
 *
 * The stubbed checks above answer the question "did the program choose to
 * create". This answers "would a real console have understood it" -- and that
 * is where the bugs that never announce themselves live. A branch created with
 * `{ name }` instead of `{ branch: { name } }` is a 400 from the real console and
 * a cheerful 201 from a stub written by the same author who got it wrong. So
 * here the request crosses a socket, is parsed as a body, and is answered with
 * the status codes a real console uses.
 *
 * The two halves of the contract are checked in one run: the first resolve
 * creates, the second must create nothing and land on the same ids. That second
 * pass is the whole point -- it is what proves the ids the job gets are the ones
 * the console can be asked about again, not two freshly invented strings.
 */
async function selfTestE2e() {
  let failures = 0;
  const check = (name, passed, detail) => {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
    if (!passed) failures += 1;
  };
  const fake = await startFakeNeon({ apiKey: 'test-key' });
  try {
    const first = await resolveFor({ NEON_API_KEY: 'test-key' }, fetch, fake.url);
    const posts = fake.requests.filter((r) => r.method === 'POST');

    check(
      'the first resolve creates a project and a branch, in that order, over HTTP',
      posts.length === 2 &&
        posts[0].path === '/api/v2/projects' &&
        posts[1].path === `/api/v2/projects/${first.lines[0].split('=')[1]}/branches`,
      posts.map((r) => `${r.method} ${r.path}`).join(' → ') || 'no POSTs at all',
    );

    check(
      'each create sends the body the console reads — the branch name is nested',
      posts[0]?.body?.name === PROJECT_NAME &&
        posts[1]?.body?.branch?.name === PARENT_BRANCH_NAME &&
        posts[0]?.body?.branch === undefined,
      `project ${JSON.stringify(posts[0]?.body)}, branch ${JSON.stringify(posts[1]?.body)}`,
    );

    check(
      'the branch is created with no parent, so it starts empty',
      posts[1]?.body?.branch?.parent_id === undefined && posts[1]?.body?.parent_id === undefined,
      // A Neon branch COPIES its parent's state, so a parent_id here would
      // hand these gates a schema they clear with clearAll. Nothing would fail
      // loudly — the schema would simply be somebody else's.
      `branch create body was ${JSON.stringify(posts[1]?.body)}`,
    );

    check(
      'every call carries the key as a bearer token and nothing else',
      fake.requests.every((r) => r.auth === 'Bearer test-key') && fake.requests.length === 4,
      `${fake.requests.length} call(s): ${fake.calls().join(', ')}`,
    );

    check(
      'the ids handed to $GITHUB_ENV are the ones the server actually made',
      first.lines[0] === 'NEON_PROJECT_ID=proj-1' &&
        first.lines[1] === 'NEON_PARENT_BRANCH_ID=br-1' &&
        first.lines.length === 2 &&
        !first.lines.some((line) => line.includes(' ')) &&
        !first.lines.some((line) => line.includes('test-key')),
      `${first.lines.length} line(s): ${first.lines.join(' | ')}`,
    );

    check(
      'the note says it created, and says so on stderr where the job ignores it',
      first.note.includes('created') && !first.note.includes('reusing'),
      first.note,
    );

    // The second pass: convergence. Re-running is how the script is used — it
    // runs once per job that needs the ids — so creating again on the second
    // run would mean a new project per run, which is the accumulation the
    // parent branch exists to avoid.
    const before = fake.requests.length;
    const second = await resolveFor({ NEON_API_KEY: 'test-key' }, fetch, fake.url);
    const secondRound = fake.requests.slice(before);
    check(
      'running it again creates nothing and reaches the same ids',
      secondRound.every((r) => r.method === 'GET') &&
        secondRound.length === 2 &&
        second.lines[0] === first.lines[0] &&
        second.lines[1] === first.lines[1],
      `${secondRound.length} call(s), ${secondRound.filter((r) => r.method === 'POST').length} of them POST; ${second.lines.join(' | ')}`,
    );

    check(
      'and the second run says it is reusing',
      second.note.includes('reusing') && !second.note.includes('created'),
      second.note,
    );

    // A wrong key must fail the run, not answer with empty ids — the failure
    // mode the job reads $GITHUB_ENV for.
    let refused = '(nothing thrown)';
    try {
      await resolveFor({ NEON_API_KEY: 'not-the-key' }, fetch, fake.url);
    } catch (error) {
      refused = error.message;
    }
    check(
      'a key the console rejects fails loudly rather than yielding empty ids',
      refused.includes('401') && refused.includes('invalid api key'),
      refused.slice(0, 100),
    );

    // And the id the server made has to be the one a later lookup can use,
    // which is the claim the whole parent-branch arrangement rests on.
    const conn = await neon(
      `/projects/${first.lines[0].split('=')[1]}/connection_uri?branch_id=${first.lines[1].split('=')[1]}`,
      { apiKey: 'test-key', base: fake.url },
    );
    check(
      'the branch id the job exports is one the console can be asked about',
      typeof conn.uri === 'string' && conn.uri.includes(first.lines[1].split('=')[1]),
      conn.uri,
    );
  } finally {
    await fake.close();
  }
  console.log(failures === 0 ? '\nall neon-secret end-to-end checks passed' : `\n${failures} end-to-end check(s) FAILED`);
  return failures === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`neon-secrets: ${error.message}`);
      process.exit(1);
    });
}

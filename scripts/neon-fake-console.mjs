/**
 * A local stand-in for the Neon console's v2 API, on the endpoints this
 * repository speaks.
 *
 * It exists because every interesting thing here is about the REQUEST, and a
 * stubbed `fetch` cannot see one. A stub proves the program chose to create; it
 * answers whatever it is written to answer, so a body shaped the way the console
 * does not read it comes back cheerful. That failure is silent and expensive:
 * a branch created with `{ name }` instead of `{ branch: { name } }` is a 400
 * from the real console and looks like a permission error, and a readiness poll
 * that never waits looks like a driver that does not work.
 *
 * So this answers over real HTTP, on the console's own paths under the same
 * `/api/v2` prefix, parses the body the client actually sent, records what it
 * was asked, and refuses a request with no bearer token the way the console
 * does. It also serves the endpoints the CI JOB uses -- connection_uri, and a
 * delete -- because those are the calls a person reads in a failed store gate
 * and would otherwise have no coverage at all.
 *
 * Deliberately strict in the ways a real console is: a duplicate project or
 * branch name is a 409 rather than a second row, a create without a nested
 * `branch.name` is a 400, and a body that is not JSON is refused rather than
 * treated as `{}`. Each of those is a mistake the fake exists to refuse, and a
 * fake that forgave them would pass the very programs it is here to catch.
 *
 * `expires_at` is validated too, and only when one is SENT. That distinction is
 * the whole rule, and getting it backwards breaks this repository: Neon's
 * reference is explicit that the create method "does not require a request
 * body", and a branch created with no expiry is an ordinary permanent branch --
 * which is exactly how `neon-secrets.mjs` creates the empty parent every run
 * branches from. A fake that refused a missing expiry would turn a correct
 * program red over a rule the console does not enforce.
 *
 * What Neon does enforce, per its branch-expiration guide, is the VALUE of an
 * expiry that is present: RFC 3339 with a time zone, in the future, and no more
 * than 30 days out. Those four are enforced here, each with its own 400, and
 * that is the window worth modelling -- an expiry computed wrongly does not
 * produce a loud failure, it produces a branch that quietly never deletes
 * itself, which is the leak `neon-branch.mjs` exists to prevent.
 *
 * It is deliberately NOT strict about anything it cannot verify. Whether Neon
 * defaults a `read_write` endpoint when a create does not name one is a claim
 * about somebody's API; the fake does not enforce it, and the checks assert the
 * REQUEST carries what we send instead, which is the part that is ours.
 *
 * `readyAfter` is the one behaviour a real console has that a stub never
 * invents: a branch is created with its compute still starting, answers
 * `current_state: init` for a while, and only later reports `ready`. Everything
 * downstream -- a poll, a gate that connects the moment it is told to -- has to
 * survive that window, and nothing but a console that actually holds the branch
 * back can test it. Zero means ready at once, which is what a test that is not
 * about readiness wants.
 *
 * Stand one up and talk to it with `neon()` from `./neon-api.mjs`:
 *
 *   const fake = await startFakeNeon({ readyAfter: 2 });
 *   try {
 *     const made = await neon('/projects', { apiKey: 'k', base: fake.url, method: 'POST', body: { name: 'p' } });
 *   } finally {
 *     await fake.close();
 *   }
 */
import { createServer } from 'node:http';

/**
 * Neon's ceiling on an expiry, from its branch-expiration guide: "maximum
 * expiration is 30 days from the current time". A create past it is a 400.
 */
const MAX_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Why an `expires_at` the console would refuse, or `null` if it is fine.
 *
 * A rule, not a guess, and the order is the order the errors are useful in.
 * The time zone is checked before the value is parsed as a date, because
 * `Date.parse` reads a zone-less string as LOCAL time: `2026-01-01T00:00:00`
 * parses cleanly on a machine west of Greenwich and lands eleven hours in the
 * past, so a check that parsed first would report a confusing "must be in the
 * future" for what is really a missing `Z` -- which is the first thing Neon's
 * own guide lists as a common mistake.
 */
export function expiryProblem(value, now = new Date()) {
  if (typeof value !== 'string') {
    return `it must be an RFC 3339 timestamp in a string, not a ${typeof value}`;
  }
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return `${value} has no time zone — use ${value}Z, or an offset like ${value}+01:00`;
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) return `${value} is not a date the console can read`;
  if (at <= now.getTime()) {
    return `${value} is not in the future — a branch created with an expiry in the past is one that never cleans itself up`;
  }
  if (at > now.getTime() + MAX_EXPIRY_MS) {
    return `${value} is more than 30 days out, which is the console's limit`;
  }
  return null;
}

/**
 * Start the console on a port the OS hands out.
 *
 * Nothing is written anywhere: the projects and branches live in this closure
 * and go when it closes, which is what lets a check create and delete without a
 * teardown step and without leaving a fixture behind for the next run to trip
 * over.
 */
export async function startFakeNeon({ apiKey = 'test-key', readyAfter = 0 } = {}) {
  const requests = [];
  const projects = [];
  const branches = new Map();
  let nextProject = 1;
  let nextBranch = 1;

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url ?? '/', 'http://localhost');
      const auth = req.headers.authorization ?? '';
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {};
      }
      requests.push({ method: req.method, path: url.pathname, query: url.searchParams, auth, body, raw });
      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (auth !== `Bearer ${apiKey}`) {
        send(401, { error: { message: 'invalid api key' } });
        return;
      }
      const parts = url.pathname.split('/').filter(Boolean); // api,v2,...
      const at = (name) => parts.indexOf(name);
      const projectId = at('projects') === 2 ? parts[3] : undefined;
      const project = projects.find((p) => p.id === projectId);
      const branchList = () => branches.get(projectId) ?? [];

      if (at('projects') === -1) {
        send(404, { error: { message: 'unknown endpoint' } });
        return;
      }
      if (parts.length === 3 && req.method === 'GET') {
        send(200, { projects: projects.map(({ id, name }) => ({ id, name })) });
        return;
      }
      if (parts.length === 3 && req.method === 'POST') {
        // Strict about the body the way the console is. A fake that accepted any
        // JSON would bless a request the real API answers 400, and the whole
        // reason this exists is to catch exactly that.
        if (typeof body.name !== 'string' || body.name === '') {
          send(400, { error: { message: 'a project needs a name' } });
          return;
        }
        if (projects.some((p) => p.name === body.name)) {
          send(409, { error: { message: `project ${body.name} already exists` } });
          return;
        }
        const made = { id: `proj-${nextProject++}`, name: body.name };
        projects.push(made);
        send(201, { project: made });
        return;
      }
      if (projectId && !project) {
        send(404, { error: { message: `no project ${projectId}` } });
        return;
      }
      if (parts.length === 5 && parts[4] === 'branches' && req.method === 'GET') {
        // The readiness clock lives here: each listing is one poll, and a branch
        // only reports `ready` once it has been seen `readyAfter` times.
        const now = branchList().map((b) => {
          b.polls = (b.polls ?? 0) + 1;
          if (b.polls >= readyAfter) b.current_state = 'ready';
          return b;
        });
        send(200, {
          branches: now.map(({ id, name, parent_id, current_state, expires_at, endpoints }) => ({
            id,
            name,
            parent_id: parent_id ?? null,
            current_state,
            expires_at: expires_at ?? null,
            endpoints: endpoints ?? [],
          })),
        });
        return;
      }
      if (parts.length === 5 && parts[4] === 'branches' && req.method === 'POST') {
        const asked = body.branch;
        if (!asked || typeof asked.name !== 'string' || asked.name === '') {
          send(400, { error: { message: 'a branch needs a nested branch.name' } });
          return;
        }
        // `endpoints` is deliberately NOT required. Whether Neon defaults one or
        // refuses without it is a claim about somebody's API that this fake
        // cannot check without an account, and a fake that enforced a guess
        // would fail the provisioning program over a rule nobody verified.
        const endpoints = Array.isArray(body.endpoints) ? body.endpoints : [{ type: 'read_write' }];
        // The expiry, when one is sent. Absent is FINE and must stay fine: see
        // the header, and `neon-secrets.mjs`, which creates the parent branch
        // with no expiry on purpose because it is meant to outlive the run.
        if (asked.expires_at !== undefined && asked.expires_at !== null) {
          const wrong = expiryProblem(asked.expires_at, new Date());
          if (wrong !== null) {
            send(400, { error: { message: `invalid expires_at: ${wrong}` } });
            return;
          }
        }
        if (branchList().some((b) => b.name === asked.name)) {
          send(409, { error: { message: `branch ${asked.name} already exists` } });
          return;
        }
        const made = {
          id: `br-${nextBranch++}`,
          name: asked.name,
          parent_id: asked.parent_id ?? null,
          expires_at: asked.expires_at ?? null,
          endpoints,
          // As the console answers it: the branch exists, and its compute has
          // not started yet. `pending_state` is where the readiness waits.
          current_state: 'init',
          pending_state: readyAfter === 0 ? undefined : 'ready',
          polls: 0,
        };
        branches.set(projectId, [...branchList(), made]);
        send(201, { branch: made });
        return;
      }
      if (parts.length === 5 && parts[4] === 'connection_uri' && req.method === 'GET') {
        const wanted = url.searchParams.get('branch_id');
        const found = branchList().find((b) => b.id === wanted);
        if (!found) {
          send(404, { error: { message: `no branch ${wanted}` } });
          return;
        }
        send(200, {
          uri: `postgres://ci:hunter2@ep-fake.neon.tech/delegate-ci?branch_id=${found.id}`,
          // What the console also reports, and what makes a name-based check
          // possible: the database this branch actually owns.
          databases: [{ name: found.name, id: `db-${found.id}` }],
        });
        return;
      }
      if (parts.length === 6 && parts[4] === 'branches' && req.method === 'DELETE') {
        branches.set(projectId, branchList().filter((b) => b.id !== parts[5]));
        send(200, { branch: { id: parts[5] } });
        return;
      }
      send(404, { error: { message: `no route for ${req.method} ${url.pathname}` } });
    });
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  return {
    /** The base to hand `neon()` as `base`. Loopback, so it is reachable from a child process too. */
    url: `http://127.0.0.1:${port}/api/v2`,
    /** Every request, in order, with the parsed body — the evidence a check asserts on. */
    requests,
    /** What was asked, as `METHOD /path`, for a check that only cares which calls happened. */
    calls: () => requests.map((r) => `${r.method} ${r.path}`),
    /** The ids this console handed out, for a check that has to name one. */
    projects: () => projects.map(({ id, name }) => ({ id, name })),
    branches: (projectId) => (branches.get(projectId) ?? []).map(({ id, name, current_state }) => ({ id, name, current_state })),
    /**
     * Stop answering. Required rather than left to the process: a console left
     * listening holds its port for the rest of the machine's afternoon, and the
     * next run fails to bind for a reason that reads like a build problem.
     */
    close: () => new Promise((done) => server.close(() => done())),
  };
}
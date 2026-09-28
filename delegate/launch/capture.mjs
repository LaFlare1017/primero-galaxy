/**
 * Capture the stills the launch video is built on, from the running product.
 *
 *   node delegate/launch/capture.mjs                  (expects a server on :3100)
 *   node delegate/launch/capture.mjs --url=http://localhost:3000
 *
 * Writes into delegate/launch/export/stills/ (git-ignored):
 *
 *   workspace.png   /delegate?run=… — a real run, briefed and answered
 *   console.png     /delegate/facilitator — the grid, one row per participant
 *   facts.js        `window.__facts` for the deck: the company, the scenario
 *                   count and the tool names, read from the repo and from the
 *                   session API's own `availableTools`
 *
 * The seeding is REAL API traffic (POST /api/delegate/session, then one chat
 * turn), so the stills are the product doing its job rather than a mock-up. The
 * runs land in whatever store the server was started with — point it at a
 * scratch one (`DELEGATE_DATA_DIR=.next-e2e/delegate-data`) and the workshop's
 * own store is never touched.
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const outDir = join(here, 'export', 'stills');
const urlArg = process.argv.find((arg) => arg.startsWith('--url='));
const base = (urlArg ? urlArg.split('=')[1] : 'http://localhost:3100').replace(/\/$/, '');

/**
 * The cohort the grid shows. The first participant is NOT seeded here: that one
 * starts its scenario through the UI, which is the flow that produces the
 * resumable run link the workspace still is taken from.
 */
const PARTICIPANTS = [
  { label: 'Priya', scenarioId: 's2' },
  { label: 'Ade', scenarioId: 's3' },
  { label: 'Marco', scenarioId: 's5' },
];
const LIVE_PARTICIPANT = 'Jordan';

/** The brief the captured run is given: one real agent turn with tool calls. */
const BRIEF = 'Reconcile the March bank feed and tell me what does not tie.';

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // 1. Seed real runs, one per participant, through the same endpoint the
  //    participant screen uses. This is what puts rows in the grid.
  const sessions = [];
  for (const participant of PARTICIPANTS) {
    const response = await page.request.post(`${base}/api/delegate/session`, {
      data: { participantLabel: participant.label, scenarioId: participant.scenarioId },
    });
    if (!response.ok()) {
      throw new Error(
        `seeding ${participant.label} failed: ${response.status()} ${await response.text()}`,
      );
    }
    sessions.push({ ...participant, ...(await response.json()) });
  }

  const first = sessions[0];
  if (!Array.isArray(first.availableTools) || first.availableTools.length === 0) {
    throw new Error('the session API returned no availableTools — nothing to put in the log');
  }

  // 2. The workspace: a scenario started the way a participant starts one, so
  //    the still is the product's own first screen with a real run behind it.
  await page.goto(`${base}/delegate`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('e.g. Jordan').fill(LIVE_PARTICIPANT);
  await page.getByRole('button', { name: /Start scenario/ }).click();
  const composer = page.locator('input[placeholder="Ask the agent or direct its work…"]');
  await composer.waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => new URL(location.href).searchParams.get('run') !== null, null, {
    timeout: 20_000,
  });
  const live = await page.evaluate(() => ({
    run: new URL(location.href).searchParams.get('run'),
    session: new URL(location.href).searchParams.get('session'),
  }));

  // One real turn, typed into the product's own composer: the brief, then the
  // agent's answer with its tool calls, exactly as a participant would get it.
  await composer.fill(BRIEF);
  await composer.press('Enter');
  await page.getByText(/tool call/).first().waitFor({ timeout: 60_000 });
  // Let the transcript, the status orb and the ledger viewer settle: a still
  // taken mid-paint is a still nobody used.
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(outDir, 'workspace.png'), animations: 'disabled' });

  // The event log the video shows is the run's OWN log, read back from the
  // state API: the prompt that went in, every tool call with its real arguments,
  // and the reply that came out. Nothing in that beat is invented.
  const state = await (await page.request.get(`${base}/api/delegate/run/${live.run}/state`)).json();
  const assistant = (state.messages ?? []).filter((message) => message.role === 'assistant').at(-1);
  const toolCalls = assistant?.toolCalls ?? [];
  if (toolCalls.length === 0) {
    throw new Error('the restored run carries no tool calls — the log beat would be empty');
  }
  const compact = (args) =>
    Object.entries(args ?? {})
      .slice(0, 2)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ')
      .slice(0, 46);
  const log = [
    { kind: 'prompt_sent', detail: BRIEF.toLowerCase().replace(/\.$/, '') },
    ...toolCalls.slice(0, 4).map((call) => ({ kind: `tool.${call.tool}`, detail: compact(call.args) })),
    {
      kind: 'agent_response',
      detail: (assistant?.content ?? '').replace(/\s+/g, ' ').slice(0, 52).toLowerCase(),
    },
  ];

  // 3. The facilitator console, with the seeded rows.
  await page.goto(`${base}/delegate/facilitator`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const rows = await page.request.get(`${base}/api/delegate/facilitator`);
  const grid = await rows.json();
  const expected = PARTICIPANTS.length + 1; // the seeded cohort plus the live run
  if (!Array.isArray(grid.rows) || grid.rows.length < expected) {
    throw new Error(`the grid has ${grid.rows?.length ?? 0} rows, expected ${expected}`);
  }
  await page.screenshot({ path: join(outDir, 'console.png'), animations: 'disabled' });

  // 4. The facts the deck quotes in words: the scenario count and the company
  //    from the repo, the tool names from the runtime that just answered.
  const scenarios = (await readdir(join(ROOT, 'delegate', 'scenarios'))).length;
  const profile = await readFile(join(ROOT, 'delegate', 'src', 'seed', 'profile.ts'), 'utf8');
  const company = profile.match(/name: "([^"]+)",/)?.[1];
  // The number the piece spends its one accent on: scenario 3's reclass, read
  // from the defect package that plants it.
  const defect = await readFile(join(ROOT, 'delegate', 'src', 'seed', 'defects', 'scenario3.ts'), 'utf8');
  const defectAmount = Number(defect.match(/reclassAmount:\s*([0-9_]+)/)?.[1]?.replace(/_/g, ''));
  if (!company || !scenarios || !Number.isFinite(defectAmount)) {
    throw new Error('could not read the company, the scenario count or the planted amount');
  }

  const tools = (first.availableTools ?? []).map((tool) => tool.name ?? tool).filter(Boolean);
  await writeFile(
    join(outDir, 'facts.js'),
    `// Generated by delegate/launch/capture.mjs — read from the repo and the runtime.\n` +
      `window.__facts = ${JSON.stringify(
        {
          company,
          scenarios,
          tools,
          participants: 'a small cohort',
          toolCallCount: toolCalls.length,
          defectAmount,
          log,
        },
        null,
        2,
      )};\n`,
  );

  await browser.close();

  // A still that captured a blank page is a few kilobytes of white; the floor is
  // low on purpose (it catches "nothing rendered") and the deck's own load check
  // catches the rest.
  for (const file of ['workspace.png', 'console.png']) {
    const { size } = await stat(join(outDir, file));
    if (size < 20_000) throw new Error(`${file} is only ${size} bytes — the capture failed quietly`);
    console.log(`${(size / 1024).toFixed(0).padStart(6)} KB  export/stills/${file}`);
  }
  const factsSource = await readFile(join(outDir, 'facts.js'), 'utf8');
  if (!factsSource.includes('window.__facts')) throw new Error('facts.js has no window.__facts');
  console.log(`${(Buffer.byteLength(factsSource) / 1024).toFixed(1).padStart(6)} KB  export/stills/facts.js`);
  console.log(      `\nseeded ${sessions.length} runs (${sessions.map((s) => `${s.label}:${s.runId}`).join(', ')})` +
      `\nlive run started in the UI: ${LIVE_PARTICIPANT}:${live.run}` +
      `\ntools available: ${tools.join(', ')} · company: ${company} · scenarios: ${scenarios}` +
      ` · planted reclass $${Math.round(defectAmount / 1000)}K` +
      `\nlog lines from the run's own events: ${log.length} (${log.map((line) => line.kind).join(', ')})`,
  );
}

await main().catch((error) => {
  console.error(error);
  process.exit(1);
});

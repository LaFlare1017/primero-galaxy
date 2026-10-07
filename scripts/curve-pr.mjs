#!/usr/bin/env node
/**
 * Commit the bench's measurement and open a PR against main, so the pin is
 * re-checked by the checks job without a human having to copy an artifact by
 * hand.
 *
 * Only opens a PR when the measurement differs from what main already carries —
 * the same knee over the same suite is not a finding, however fresh its
 * timestamp, and a pull request on every push was exactly the churn this gate
 * exists to stop. Sameness is `sameMeasurement` in scripts/e2e-pin.mjs, shared
 * with every other reader of a measurement, so there is one definition of it
 * and one place to fix. The curve job runs on main pushes, workflow_dispatch
 * and the weekly schedule; the PR it opens triggers the checks job (including
 * worker-pin) on pull_request, which is the re-check.
 *
 * Usage (from the curve job, after the bench has written e2e/worker-curve.json):
 *   node scripts/curve-pr.mjs
 *
 * Reads the same env the bench does: GITHUB_TOKEN (the default CI token), the
 * repository owner and name from GITHUB_REPOSITORY, and the SHA the checkout is
 * on from GITHUB_SHA.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sameMeasurement } from './e2e-pin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function env(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function sha() {
  return env('GITHUB_SHA', 'HEAD');
}

function ownerAndRepo() {
  const whole = env('GITHUB_REPOSITORY', '');
  const [owner, repo] = whole.split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY is not set — this only runs on CI');
  return { owner, repo };
}

function ref() {
  return env('GITHUB_REF', 'refs/heads/main');
}

/**
 * The measurement the bench wrote, or null when there is nothing to propose.
 */
function measurement() {
  const path = resolve(ROOT, 'e2e', 'worker-curve.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The measurement already on main, or null when main has none.
 */
function mainMeasurement() {
  try {
    const text = execSync('git show main:e2e/worker-curve.json', {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Configure git for the commit. The checkout already has the files; this just
 * stamps the commit and the branch.
 */
function configureGit() {
  execSync('git config user.name "github-actions[bot]"', { cwd: ROOT, stdio: 'pipe' });
  execSync('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"', {
    cwd: ROOT,
    stdio: 'pipe',
  });
}

/**
 * Commit the measurement on a fresh branch and push it.
 */
function pushBranch(branch) {
  // Start from main in case the checkout is on a different branch.
  execSync(`git checkout main`, { cwd: ROOT, stdio: 'pipe' });
  // Delete any leftover branch from a previous failed run.
  try {
    execSync(`git branch -D ${branch}`, { cwd: ROOT, stdio: 'pipe' });
  } catch {
    /* may not exist */
  }
  execSync(`git checkout -b ${branch}`, { cwd: ROOT, stdio: 'pipe' });
  execSync('git add e2e/worker-curve.json', { cwd: ROOT, stdio: 'pipe' });
  // Nothing to commit when the file did not change — bail rather than ship an
  // empty PR that the checks job would still run.
  try {
    execSync('git diff --cached --quiet', { cwd: ROOT, stdio: 'pipe' });
    // quiet exit (0) means no diff — nothing to propose
    execSync(`git checkout main`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`git branch -D ${branch}`, { cwd: ROOT, stdio: 'pipe' });
    return null;
  } catch {
    // non-zero — there is a diff
  }
  execSync(`git commit -m "worker curve: record the runner's measurement"`, {
    cwd: ROOT,
    stdio: 'pipe',
  });
  execSync(`git push origin ${branch}`, { cwd: ROOT, stdio: 'pipe' });
  return branch;
}

/**
 * Open a PR from the branch to main. Idempotent: if a PR from this branch
 * already exists, report it rather than opening a second one.
 */
function openPr({ owner, repo, branch }) {
  const title = 'worker curve: record the runner\'s measurement';
  const body =
    `The \`E2E worker curve\` job measured the suite on the runner and recorded \`e2e/worker-curve.json\`.\n\n` +
    `Run \`${env('GITHUB_RUN_ID', '?')}\`, triggered by \`${env('GITHUB_EVENT_NAME', '?')}\` on \`${ref()}\`.\n\n` +
    `This PR exists so the checks job re-runs \`worker-pin\` against the new measurement ` +
    `without a human having to copy an artifact by hand. Merge it if the numbers look right; ` +
    `the next curve run will open a fresh one when they change.`;

  // Check for an existing PR from this branch — GitHub's API lets us search.
  let existing = '';
  try {
    existing = execSync(
      `gh pr list --head ${branch} --json number --jq '.[0].number'`,
      { cwd: ROOT, encoding: 'utf8' },
    ).trim();
  } catch {
    // no pr tool, or no existing pr — fall through
  }

  if (existing) {
    return { action: 'existing', number: existing };
  }

  // `gh pr create` has no --json flag — the first run of this script died on
  // exactly that, after its branch had already been pushed. It prints the new
  // PR's URL on stdout, and the number is the last path segment of it.
  const url = execSync(
    `gh pr create --base main --head ${branch} --title ${JSON.stringify(title)} --body-file -`,
    { cwd: ROOT, input: body, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .pop()
    .trim();
  const number = (url.match(/\/pull\/(\d+)/) ?? [])[1];
  if (number === undefined) {
    throw new Error(`gh pr create did not print a pull request URL — it printed: ${url}`);
  }
  return { action: 'created', number };
}

async function main() {
  const { owner, repo } = ownerAndRepo();
  const measured = measurement();
  if (measured === null) {
    console.log('curve-pr: no measurement to propose — the bench did not write one');
    return;
  }

  const onMain = mainMeasurement();
  if (onMain !== null && sameMeasurement(measured, onMain)) {
    console.log(
      `curve-pr: the runner measured the same knee (${measured.knee}) over the same suite main already carries — nothing to propose`,
    );
    return;
  }

  configureGit();
  const branch = `worker-curve/${env('GITHUB_RUN_ID', String(Date.now()))}`;
  const pushed = pushBranch(branch);
  if (pushed === null) {
    console.log('curve-pr: the measurement did not change anything — no PR opened');
    return;
  }

  const pr = openPr({ owner, repo, branch });
  console.log(
    `curve-pr: ${pr.action === 'created' ? 'opened' : 'found existing'} ` +
      `#${pr.number} — https://github.com/${owner}/${repo}/pull/${pr.number}`,
  );
}

main().catch((error) => {
  console.error('curve-pr failed:', error.message);
  process.exit(1);
});

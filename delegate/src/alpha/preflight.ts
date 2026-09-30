/**
 * Alpha preflight (Week-6): automated environment checks to run before the
 * first dry-run and again before participant #1. The dry-run checklist
 * (docs/alpha-dry-run.md §0) references this — anything it can verify
 * mechanically, this script verifies, so the facilitator only checks the
 * human things (room, machine, briefing).
 *
 * Checks (in execution order):
 *  C1  dist/ build exists and is current (newer than src/)
 *  C2  store state: clean (0 sessions) or dirty (reset required)
 *      — read BEFORE the gate suites, which seed cohort data
 *  C3  all five gate suites pass (balance, defects, week3, smoke, readout)
 *  C4  six scenario packages present (manifest + checklist + debrief each)
 *  C5  agent mode: anthropic (key present) vs mock — either is fine for
 *      the alpha; the run-of-show says which is expected
 *  C6  server health (with --url): /delegate and /delegate/facilitator
 *      answer 200, session API creates a probe session, tool gating holds,
 *      and the page's JS/CSS chunks actually load (C6e: catches a
 *      production `next build` having clobbered the dev server's .next —
 *      pages then 200 but every button is dead because chunks 404)
 *  C7  live agent turn (with --url): one chat message through the real API
 *      on the C6c probe run, proving which provider the SERVER process is
 *      actually running (the server loads .env.local itself, so its view of
 *      the key can differ from this shell's) and that a bad key fails as a
 *      clean 502, never a raw 500 mid-scenario
 *
 * Usage:
 *   npm run alpha:preflight            # local checks only (C1-C4, C6)
 *   npm run alpha:preflight -- --url http://127.0.0.1:3000
 *       # adds server checks: C6 pages/API/gating/chunks + C7 live agent turn
 *
 * Exit code 0 = all checks passed (warnings allowed), 1 = any failure.
 */

import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { resolveDelegateRoot } from "../paths";
import { openStore } from "../store/store";
import { SCENARIO_ORDER, loadManifest, loadChecklist, loadDebrief } from "../scoring/scenario-loader";
import { spawnSync } from "child_process";

interface CheckResult {
  id: string;
  name: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
  fix?: string;
}

const results: CheckResult[] = [];

function check(id: string, name: string, ok: boolean, detail: string, fix?: string, warn = false): void {
  results.push({ id, name, ok, detail, fix, warn });
}

function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (entry !== "node_modules" && entry !== "dist") walk(p);
      } else if (st.mtimeMs > newest) {
        newest = st.mtimeMs;
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
}

function dirMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  return statSync(dir).mtimeMs;
}

async function main(): Promise<void> {
  const root = resolveDelegateRoot();
  const args = process.argv.slice(2);
  const urlArg = args.includes("--url") ? args[args.indexOf("--url") + 1] : undefined;

  // ── C1: build exists and is current ──
  const distEntry = join(root, "dist", "alpha", "preflight.js");
  const distNewest = (() => {
    const distDir = join(root, "dist");
    if (!existsSync(distDir)) return 0;
    return newestMtime(distDir);
  })();
  const srcNewest = newestMtime(join(root, "src"));
  if (!existsSync(distEntry)) {
    check("C1", "Build present", false, "dist/alpha/preflight.js not found", "cd delegate && npm run build");
  } else if (srcNewest > distNewest) {
    check("C1", "Build current", false, `src/ is newer than dist/ (stale build)`, "cd delegate && npm run build");
  } else {
    check("C1", "Build current", true, "dist/ is up to date with src/");
  }

  // ── C3: store state (checked BEFORE C2 — the gate suites seed cohort
  // data, so a post-gate check would always read dirty) ──
  // Read through the store, not off the filesystem. A `sessions.json` that is
  // not there used to mean "pristine" and still does on a laptop, but a
  // deployment keeps its rows in a database, where the file is never there —
  // so the file-reading version reported a full workshop room as pristine,
  // which is the one answer a preflight must never give about the state of the
  // room. An unreadable store is still its own answer rather than a zero.
  let sessionCount = 0;
  let storeKind = "file";
  let storeDetail = "";
  try {
    const store = await openStore();
    storeKind = store.kind;
    sessionCount = (await store.read("sessions")).length;
  } catch (error) {
    sessionCount = -1;
    storeDetail = (error as Error).message.split("\n")[0] ?? "";
  }
  if (sessionCount === 0) {
    check("C2", "Store pristine", true, `the ${storeKind} store has 0 sessions`);
  } else if (sessionCount < 0) {
    check(
      "C2",
      "Store pristine",
      false,
      `the ${storeKind} store could not be read (${storeDetail})`,
      "npm run alpha:reset -- --yes  (archives then wipes)",
    );
  } else {
    check(
      "C2",
      "Store pristine",
      false,
      `${sessionCount} session(s) in the ${storeKind} store from previous runs/smoke tests`,
      "npm run alpha:reset -- --yes",
    );
  }

  // ── C2: gate suites (run AFTER the C3 read — they seed cohort data) ──
  const gate = spawnSync("npm", ["test"], { cwd: root, encoding: "utf8", timeout: 120_000 });
  const gateOk = gate.status === 0;
  const tail = (gate.stdout ?? "").trim().split("\n").slice(-3).join(" | ");
  check("C3", "Gate suites (6)", gateOk, gateOk ? "balance, defects, week3, smoke, s5 cold-run, readout all pass (note: smoke seeds test data; run alpha:reset before participant #1)" : `gate failure: ${tail || gate.stderr?.slice(0, 200)}`, "inspect the failing suite output above; do not run the alpha on a red gate");
  // ── C4: scenario packages ──
  let c4ok = true;
  const missing: string[] = [];
  for (const slug of SCENARIO_ORDER) {
    try {
      loadManifest(slug);
      loadChecklist(slug);
      loadDebrief(slug);
    } catch (err) {
      c4ok = false;
      missing.push(`${slug}: ${(err as Error).message}`);
    }
  }
  check("C4", "Scenario packages (6)", c4ok, c4ok ? "manifest + checklist + debrief present for all six" : missing.join("; "));

  // ── C5: agent mode (with length floor + shape guard) ──
  // Two ways a set key can be a masquerading placeholder:
  //  1. shorter than 90 chars (real keys are ~100+; the .env.local stub was 10)
  //  2. missing the sk-ant- / key-character shape entirely
  // Either must FAIL here, loudly: the preflight would otherwise claim
  // "real agent" while every live call 401s. The length floor is checked
  // FIRST so even a shape-plausible 88-89 char key cannot slip through.
  const rawKey = process.env.ANTHROPIC_API_KEY ?? "";
  const keyTooShort = rawKey.length > 0 && rawKey.length < 90;
  const keyShapeOk = /^sk-ant-[A-Za-z0-9_-]{80,}$/.test(rawKey);
  if (rawKey && keyTooShort) {
    check(
      "C5",
      "Agent mode",
      false,
      `ANTHROPIC_API_KEY is set but too short to be real (${rawKey.length} chars; the floor is 90, real keys are ~100 chars, sk-ant-api03-…). This is the placeholder/stub pattern: the preflight would otherwise claim "real agent" while every live call 401s.`,
      "replace the placeholder in the server's env (.env.local, uncommented) with the real key, then restart the LaunchAgent",
    );
  } else if (rawKey && !keyShapeOk) {
    check(
      "C5",
      "Agent mode",
      false,
      `ANTHROPIC_API_KEY is set but does not look like a real key (length ${rawKey.length}; expected sk-ant- shape, ~100 chars). Placeholder/stub pattern: the preflight would otherwise claim "real agent" while every live call 401s.`,
      "replace the placeholder in the server's env (.env.local, uncommented) with the real key, then restart the LaunchAgent",
    );
  } else if (rawKey) {
    check("C5", "Agent mode", true, "ANTHROPIC_API_KEY set, ≥90 chars, sk-ant- shape → real Anthropic agent (budget guard active: 120s / 12 calls / 8k tokens per turn); C7 below proves the chat path live", undefined, true);
  } else {
    check("C5", "Agent mode", true, "no ANTHROPIC_API_KEY → deterministic mock agent (honest-average). Fine for a dry run; the alpha should use the real agent if possible.", "export ANTHROPIC_API_KEY=... before starting the server", true);
  }

  // ── C5/C7: server checks (only with --url) ──
  if (urlArg) {
    const base = urlArg.replace(/\/$/, "");
    try {
      const page = await fetch(`${base}/delegate`, { signal: AbortSignal.timeout(10_000) });
      check("C6a", "Participant page", page.ok, `GET /delegate → ${page.status}`);
    } catch (err) {
      check("C6a", "Participant page", false, `GET /delegate failed: ${(err as Error).message}`, "is the Next.js dev server running?");
    }
    try {
      const fac = await fetch(`${base}/delegate/facilitator`, { signal: AbortSignal.timeout(10_000) });
      check("C6b", "Facilitator page", fac.ok, `GET /delegate/facilitator → ${fac.status}`);
    } catch (err) {
      check("C6b", "Facilitator page", false, `GET /delegate/facilitator failed: ${(err as Error).message}`);
    }
    // Probe: create + submit a throwaway session to prove the API path.
    // probeRunId is reused by C7 below for a live agent turn.
    let probeRunId: string | undefined;
    try {
      const res = await fetch(`${base}/api/delegate/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantLabel: "PREFLIGHT-PROBE", cohortId: "preflight", scenarioId: "s1" }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json()) as { runId?: string; availableTools?: string[] };
      if (res.ok && body.runId) {
        probeRunId = body.runId;
        const toolsOk = Array.isArray(body.availableTools) && body.availableTools.includes("get_bank_feed") && !body.availableTools.includes("post_entry");
        check("C6c", "Session API + tool gating", toolsOk, `run ${body.runId} created; tools: [${(body.availableTools ?? []).join(", ")}]`);
        // Note: the probe run stays in the store as PREFLIGHT-PROBE — the
        // reset step before participant #1 clears it. Cleanup here would
        // race the EventLog's in-process cache in the dev server.
        if (!toolsOk) {
          check("C6d", "Tool gating", false, "scenario 1 exposed post_entry or missing get_bank_feed; gating is broken", "inspect delegate/src/runtime/state.ts TOOLS_BY_SCENARIO");
        }
      } else {
        check("C6c", "Session API", false, `session POST → ${res.status} ${(res.statusText || "")}`, "check server logs");
      }
    } catch (err) {        check("C6c", "Session API", false, `probe failed: ${(err as Error).message}`);
    }

    // ── C6e: chunk integrity — the clobbered-.next detector ──
    // A production `next build` run while this dev server is live overwrites
    // the shared .next directory. The server keeps answering 200 for pages
    // (it holds stale HTML) but the JS chunks referenced by that HTML 404,
    // so nothing hydrates: buttons are dead and it looks like a UI bug.
    // The honest check is empirical: fetch /delegate, take every /_next/static
    // asset it references, and verify the server can actually serve them.
    try {
      const pageRes = await fetch(`${base}/delegate`, { signal: AbortSignal.timeout(10_000) });
      const html = await pageRes.text();
      const assets = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s<>\\]+/g)].map((m) => m[0]))].slice(0, 12);
      if (assets.length === 0) {
        check("C6e", "Chunk integrity", true, "no /_next/static assets referenced by /delegate; nothing to verify (unexpected for the workshop app; investigate if the page looks unstyled)", undefined, true);
      } else {
        const broken: string[] = [];
        for (const asset of assets) {
          try {
            const r = await fetch(`${base}${asset}`, { signal: AbortSignal.timeout(10_000) });
            if (!r.ok) broken.push(`${asset} → ${r.status}`);
          } catch (err) {
            broken.push(`${asset} → ${(err as Error).message.slice(0, 60)}`);
          }
        }
        if (broken.length === 0) {
          check("C6e", "Chunk integrity", true, `all ${assets.length} /_next/static assets referenced by /delegate load (dev .next intact)`);
        } else {
          check(
            "C6e",
            "Chunk integrity",
            false,
            `${broken.length} of ${assets.length} page assets fail to load (${broken.slice(0, 3).join("; ")}). The dev server's .next has almost certainly been clobbered by a production build run while it was live: pages answer 200 but the UI is dead (unhydrated buttons, 404 chunks). This is NOT a code bug.`,
            "restart the dev server so .next is rebuilt in dev mode: launchctl bootout gui/$(id -u)/com.freebuff.delegate-preview 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.freebuff.delegate-preview.plist  (NEVER run a root-level `npm run build` / `next build` while the dev server is up)",
          );
        }
      }
    } catch (err) {
      check("C6e", "Chunk integrity", false, `could not fetch /delegate to verify assets: ${(err as Error).message}`);
    }

    // ── C7: live agent turn through the chat API ──
    // The one check that can't be inferred from env files: which agent is the
    // SERVER PROCESS actually running? The dev server loads .env.local itself,
    // so the server's view of ANTHROPIC_API_KEY can differ from this shell's.
    // The chat response carries provider: "anthropic" | "mock" — that is the
    // ground truth for what participants will get. Reuses the C6c probe run
    // (same throwaway cohort; the reset before participant #1 clears both).
    if (!probeRunId) {
      check("C7", "Live agent turn", false, "skipped: the C6c probe run was not created, so there is no runId to send a chat turn to", "fix C6c first, then re-run");
    } else {
      try {
        const res = await fetch(`${base}/api/delegate/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId: probeRunId, message: "What is the March balance of account 6100? Answer in one sentence." }),
          signal: AbortSignal.timeout(60_000),
        });
        const body = (await res.json()) as { reply?: string; provider?: string; error?: string };
        if (!res.ok) {
          check("C7", "Live agent turn", false, `chat turn → ${res.status}: ${String(body.error ?? res.statusText).slice(0, 200)}`, res.status === 502 ? "provider failure; the error text names the fix (key / network / upstream)" : "check server logs");
        } else if (body.provider === "anthropic") {
          check("C7", "Live agent turn", true, `server is running the REAL Anthropic agent: a live turn replied (${String(body.reply ?? "").length} chars). Participants get the real model.`, undefined, true);
        } else if (body.provider === "mock") {
          if (rawKey && keyShapeOk && !keyTooShort) {
            check("C7", "Live agent turn", false, "MISMATCH: this shell has a well-formed ANTHROPIC_API_KEY, but the server replied as the MOCK agent. The server process never got the key.", "restart the LaunchAgent so the dev server reloads .env.local, then re-run this preflight");
          } else {
            check("C7", "Live agent turn", true, "server is running the mock agent (consistent: no real key in this shell either). Fine for a dry run.", undefined, true);
          }
        } else {
          check("C7", "Live agent turn", false, `unexpected provider value in chat response: ${JSON.stringify(body).slice(0, 200)}`);
        }
      } catch (err) {
        check("C7", "Live agent turn", false, `chat turn failed: ${(err as Error).message.slice(0, 200)}`, "is the dev server still up? check server logs");
      }
    }
  }

  // ── Report ──
  console.log("\nAlpha preflight · " + new Date().toISOString() + "\n");
  let failures = 0;
  for (const r of results) {
    const mark = r.ok ? (r.warn ? "WARN" : "PASS") : "FAIL";
    if (!r.ok) failures += 1;
    console.log(`  [${mark}] ${r.id}  ${r.name}`);
    console.log(`         ${r.detail}`);
    if (r.fix) console.log(`         fix → ${r.fix}`);
  }
  console.log("");
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED. Fix before running the dry run.\n`);
    process.exit(1);
  }
  console.log("All checks passed (warnings noted). Clear to proceed with the dry-run checklist §1.\n");
}

main().catch((err) => {
  console.error("preflight crashed:", err);
  process.exit(1);
});

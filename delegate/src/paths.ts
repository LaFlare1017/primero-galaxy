/**
 * Path resolution that works in two hosts:
 *  - delegate's own build (node dist/..., cwd = delegate/)
 *  - the Next.js dev server (cwd = repo root, files bundled)
 *
 * The anchor is delegate/package.json: under Next the cwd is the repo root
 * (so delegate/ is directly below), under delegate scripts the cwd is
 * delegate/ itself (so the anchor is the cwd).
 */

import { existsSync } from "fs";
import { join, resolve } from "path";

export function resolveDelegateRoot(): string {
  const cwd = resolve(process.cwd());
  if (existsSync(join(cwd, "delegate", "package.json"))) return join(cwd, "delegate");
  if (existsSync(join(cwd, "package.json")) && existsSync(join(cwd, "src", "seed"))) return cwd;
  // Fallback: relative to this file (src/paths.ts → delegate root).
  return resolve(__dirname, "..");
}

export function dataDir(): string {
  // Test isolation: the live-run harness sets DELEGATE_DATA_DIR so E2E runs
  // never write into the workshop's real event/score store.
  const override = process.env.DELEGATE_DATA_DIR;
  if (override) return override;
  return join(resolveDelegateRoot(), "data");
}

export function scenariosDir(): string {
  return join(resolveDelegateRoot(), "scenarios");
}

/**
 * Entry point: build the clean base and run the balance gate.
 * Usage: node dist/seed/build-base.js [--seed N]
 */

import { verifyCleanBase, printReport } from "./verify";

const argv = process.argv.slice(2);
const seedIdx = argv.indexOf("--seed");
const seed = seedIdx >= 0 ? Number(argv[seedIdx + 1]) : undefined;

const report = verifyCleanBase(seed);
printReport(report);
process.exit(report.passed ? 0 : 1);

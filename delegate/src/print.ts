/**
 * Survive a reader who closed the pipe.
 *
 * Every gate in this workspace prints a table, and the first thing anybody does
 * with a table is `npm run test:store | head`. That closes stdout after a few
 * lines, and an EPIPE on a socket is an *error event*, not a return value: with
 * no listener, Node throws it as unhandled and the process dies on the spot —
 * before the `finally` that removes the gate's temporary directory. The result
 * is a leaked directory in the system temp for every truncated read, and a
 * gate that leaves state behind is a gate whose cleanup nobody can trust.
 *
 * So the error is swallowed where it happens and the run finishes: the tables
 * stop appearing, the checks all complete, the temp directory goes, and the exit
 * code is still the real one. Anything that is not EPIPE is a different
 * problem and is written to stderr, which is not what gets piped to `head`.
 *
 * Called once, at the top of a gate, before it prints anything.
 */

export function ignoreClosedPipe(): void {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") return;
    process.stderr.write(`[gate] stdout failed: ${error.message}\n`);
  });
}

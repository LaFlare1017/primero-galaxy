/**
 * The four things a check may report, and the one place a finding is validated.
 *
 * Two callers need this and they have to agree about it: the runner, which
 * prints and counts, and `prove.mjs`, which asserts that a check reports the
 * level it claims to. A proof that read a finding differently from the report
 * would be proving something nobody runs.
 */
export const MARKS = { pass: '✓', warn: '!', fail: '✗', skip: '·' };

/**
 * Accepts a bare string as a passing detail. A check that came back with nothing
 * to say is thrown rather than rendered as a pass — "no problems found" and "the
 * check returned undefined" print identically otherwise, which is the one way
 * this script could lie.
 */
export function normalize(result) {
  if (typeof result === 'string') return { level: 'pass', detail: result };
  const finding = { level: 'pass', ...result };
  if (typeof finding.detail !== 'string' || finding.detail.trim() === '') {
    throw new Error('the check returned no finding — a check with nothing to say has to say so');
  }
  if (!(finding.level in MARKS)) throw new Error(`unknown level \`${finding.level}\``);
  return finding;
}

/**
 * One check's finding, with a check that could not run reading as a failure:
 * "no problems found" and "never looked" are the same output otherwise. Exported
 * so the proof measures a check through the same door the report does.
 */
export function findingFrom(check, root, context) {
  try {
    return normalize(check.run(root, context));
  } catch (error) {
    return { level: 'fail', detail: `could not run: ${error.message}` };
  }
}

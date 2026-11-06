/**
 * Writes to the GitHub summary page of the run (does nothing on the Mac):
 * - the tests that passed only on a retry ("flaky"), so weak tests can be found and fixed;
 * - after a merge (AFTER_MERGE=1), one plain line for each picture test that failed, with its width.
 */
import fs from 'node:fs';
import type { Reporter, TestCase } from '@playwright/test/reporter';

const isPicture = (t: TestCase) => /visual\.spec\.ts$/.test(t.location.file);
/** Picture tests sit in a group named after their width, e.g. "1366px". */
const widthOf = (t: TestCase) => t.titlePath().find((s) => /^\d+px$/.test(s))?.replace('px', ' px') ?? 'an unknown width';
const nameOf = (t: TestCase) => t.titlePath().filter(Boolean).join(' › ');

export default class SummaryReporter implements Reporter {
  private tests = new Set<TestCase>();

  onTestEnd(test: TestCase) {
    this.tests.add(test);
  }

  onEnd() {
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (!file) return;
    const tests = [...this.tests];
    const lines: string[] = [];
    const flaky = tests.filter((t) => t.outcome() === 'flaky');
    lines.push(`Flaky tests (passed only after a retry): ${flaky.length ? flaky.length : 'none'}`);
    for (const t of flaky) lines.push(`- ${nameOf(t)}`);
    if (process.env.AFTER_MERGE) {
      for (const t of tests.filter((t) => isPicture(t) && t.outcome() === 'unexpected')) {
        lines.push(`Picture test failed after merge at ${widthOf(t)} – start a fix PR (${nameOf(t)})`);
      }
    }
    fs.appendFileSync(file, lines.join('\n') + '\n');
  }
}

// Test-runner strategies for the admin panel's /admin/run endpoint (ADR-026).
//
// Each test tool emits a different terminal format, so reconstructing pass/fail
// counts from streamed text is fragile (and broke for Playwright). Instead, each
// strategy runs its tool with that tool's NATIVE machine-readable reporter, then
// parses the resulting JSON into one normalized contract. The controller streams
// human-readable logs for the console AND emits the parsed summary as a dedicated
// SSE `summary` event, so the frontend never parses text.
//
// Adding a new test type = one new strategy here; nothing else changes.
import * as path from 'path';

/** Normalized result contract emitted as the SSE `summary` event. */
export interface NormalizedTestSummary {
  tool: 'vitest' | 'playwright' | 'all';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: Array<{ title: string; reason?: string }>;
}

export interface TestRunStrategy {
  tool: 'vitest' | 'playwright';
  /** npm args to spawn, including the reporter flags that write JSON to `outputFile`. */
  npmArgs: string[];
  /** Extra env merged over process.env (e.g. Playwright's JSON output path). */
  env?: Record<string, string>;
  /** Absolute path to the JSON results file the run produces. */
  outputFile: string;
  /** Parse the raw JSON file contents into the normalized contract. */
  parse(raw: string): NormalizedTestSummary;
}

/** First non-empty line of a (possibly multi-line) message, trimmed. */
function firstLine(s?: string): string | undefined {
  if (!s) return undefined;
  return s.split('\n').map((l) => l.trim()).find(Boolean);
}

/** Shorten an absolute test file path to the portion from `test/` onward. */
function shortFile(file?: string): string {
  if (!file) return '';
  const norm = file.replace(/\\/g, '/');
  const idx = norm.indexOf('/test/');
  if (idx !== -1) return norm.slice(idx + 1);
  return norm.split('/').pop() ?? norm;
}

/**
 * Vitest runs unit and integration suites. The `default` reporter streams human
 * output to stdout (captured as logs); the `json` reporter writes the structured
 * file we parse. Its shape follows the Jest schema (numTotalTests, testResults[]).
 */
function vitestStrategy(npmScript: string, outFile: string): TestRunStrategy {
  return {
    tool: 'vitest',
    npmArgs: ['run', npmScript, '--', '--reporter=default', '--reporter=json', `--outputFile=${outFile}`],
    outputFile: outFile,
    parse(raw) {
      const j = JSON.parse(raw);
      const failures: NormalizedTestSummary['failures'] = [];
      const start = typeof j.startTime === 'number' ? j.startTime : 0;
      let maxEnd = 0;
      for (const file of j.testResults ?? []) {
        if (typeof file.endTime === 'number') maxEnd = Math.max(maxEnd, file.endTime);
        for (const a of file.assertionResults ?? []) {
          if (a.status === 'failed') {
            const name = (a.fullName || a.title || '').trim();
            failures.push({
              title: `${shortFile(file.name)} > ${name}`,
              reason: firstLine(a.failureMessages?.[0]),
            });
          }
        }
      }
      const durationMs = start && maxEnd ? Math.max(0, maxEnd - start) : 0;
      return {
        tool: 'vitest',
        total: j.numTotalTests ?? 0,
        passed: j.numPassedTests ?? 0,
        failed: j.numFailedTests ?? 0,
        skipped: (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0),
        durationMs,
        failures,
      };
    },
  };
}

/**
 * Playwright runs the E2E suite. The `line` reporter streams progress to stdout
 * (captured as logs); the `json` reporter writes the structured file. Playwright's
 * JSON reporter writes to a file only when PLAYWRIGHT_JSON_OUTPUT_NAME is set,
 * which we pass via env. The shape is { stats, suites[] }.
 */
function playwrightStrategy(outFile: string): TestRunStrategy {
  return {
    tool: 'playwright',
    npmArgs: ['run', 'test:e2e', '--', '--reporter=line,json'],
    env: { PLAYWRIGHT_JSON_OUTPUT_NAME: outFile },
    outputFile: outFile,
    parse(raw) {
      const j = JSON.parse(raw);
      const stats = j.stats ?? {};
      const failures: NormalizedTestSummary['failures'] = [];

      // suites nest arbitrarily deep; a spec carries `ok` and its tests' results.
      const walk = (suites: unknown[] | undefined, file?: string) => {
        for (const s of (suites ?? []) as Array<Record<string, unknown>>) {
          const suiteFile = (s.file as string) || file;
          for (const spec of (s.specs ?? []) as Array<Record<string, unknown>>) {
            if (spec.ok === false) {
              const tests = (spec.tests ?? []) as Array<Record<string, unknown>>;
              const results = (tests[0]?.results ?? []) as Array<Record<string, unknown>>;
              const err = results.find((r) => r.error)?.error as { message?: string } | undefined;
              failures.push({
                title: `${shortFile(suiteFile)} > ${spec.title as string}`,
                reason: firstLine(err?.message),
              });
            }
          }
          if (s.suites) walk(s.suites as unknown[], suiteFile);
        }
      };
      walk(j.suites);

      const passed = stats.expected ?? 0;
      const failed = stats.unexpected ?? 0;
      const skipped = stats.skipped ?? 0;
      const flaky = stats.flaky ?? 0;
      return {
        tool: 'playwright',
        total: passed + failed + skipped + flaky,
        passed,
        failed,
        skipped,
        durationMs: Math.round(stats.duration ?? 0),
        failures,
      };
    },
  };
}

/**
 * Resolve a command id to its single-tool test-runner strategy, or null when the
 * command is not a single-tool test run (setup/seed/type-check stream logs only;
 * the `test` aggregate is handled separately via `resolveTestSequence`).
 */
export function resolveTestStrategy(command: string, projectRoot: string): TestRunStrategy | null {
  const dir = path.join(projectRoot, 'test-results');
  switch (command) {
    case 'test:unit':        return vitestStrategy('test:unit', path.join(dir, 'unit.json'));
    case 'test:integration': return vitestStrategy('test:integration', path.join(dir, 'integration.json'));
    case 'test:e2e':         return playwrightStrategy(path.join(dir, 'e2e.json'));
    default:                 return null;
  }
}

/**
 * The `test` aggregate ("All Tests") chains unit, integration, and E2E. Rather than
 * stream logs only, we run each suite with its native JSON reporter and combine the
 * parsed results into one summary (see `aggregateSummaries`), so the panel shows the
 * same pass/fail/skip breakdown it shows for a single suite. Returns null for any
 * command that is not the aggregate.
 */
export function resolveTestSequence(command: string, projectRoot: string): TestRunStrategy[] | null {
  if (command !== 'test') return null;
  const dir = path.join(projectRoot, 'test-results');
  return [
    vitestStrategy('test:unit', path.join(dir, 'unit.json')),
    vitestStrategy('test:integration', path.join(dir, 'integration.json')),
    playwrightStrategy(path.join(dir, 'e2e.json')),
  ];
}

/** Combines per-suite summaries into one totalized `all` summary for the aggregate run. */
export function aggregateSummaries(parts: NormalizedTestSummary[]): NormalizedTestSummary {
  return parts.reduce<NormalizedTestSummary>((acc, p) => ({
    tool: 'all',
    total: acc.total + p.total,
    passed: acc.passed + p.passed,
    failed: acc.failed + p.failed,
    skipped: acc.skipped + p.skipped,
    durationMs: acc.durationMs + p.durationMs,
    failures: [...acc.failures, ...p.failures],
  }), { tool: 'all', total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0, failures: [] });
}

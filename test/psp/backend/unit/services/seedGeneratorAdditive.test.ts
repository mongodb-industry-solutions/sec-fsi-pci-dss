/**
 * Unit test: v33 F6, the data generator must never destroy the curated population.
 * Source: backend/bin/seed-generate.ts
 *
 * Before v33 the generator rebuilt every fixture from scratch at its own target sizes (50 customers,
 * 3 employees, 5 logins) while the fixtures had been hand-extended to 57 / 11 / 20. So
 * `npm run generate:data` silently deleted 8 employees and most of the curated login roster. It went
 * unnoticed because the seeder only runs the generator when the files are ABSENT.
 *
 * This test runs the real generator against a copy of the real fixtures in a temporary directory and
 * asserts the additive contract: no collection shrinks, no curated record disappears, and the
 * deprecated government-ID field never comes back. It shells out on purpose: the guarantee that
 * matters is the one the npm script actually gives.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BACKEND = join(process.cwd(), 'psp', 'backend');
const DATA = join(BACKEND, 'data');
const FIXTURES = [
  'parties.json',
  'customerAgreements.json',
  'paymentCards.json',
  'payoutAccounts.json',
  'cardTransactions.json',
  'fraudCases.json',
  'fraudCaseEvents.json',
];

let workDir: string;
let before: Record<string, Array<Record<string, unknown>>> = {};
let after: Record<string, Array<Record<string, unknown>>> = {};

const read = (dir: string, file: string) =>
  JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Array<Record<string, unknown>>;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'v33-seed-generate-'));
  cpSync(DATA, workDir, { recursive: true });
  for (const f of FIXTURES) before[f] = read(workDir, f);

  execFileSync('npx', ['ts-node', join('bin', 'seed-generate.ts')], {
    cwd: BACKEND,
    env: { ...process.env, PSP_SEED_DATA_DIR: workDir },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  for (const f of FIXTURES) after[f] = read(workDir, f);
  // A run that wrote nothing would make every assertion below vacuously true.
  expect(Object.keys(after)).toHaveLength(FIXTURES.length);
}, 300_000);

afterAll(() => {
  if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
});

// The natural primary key per fixture, so "no curated record was deleted" is checkable by identity
// rather than by count alone.
const PRIMARY_KEY: Record<string, string> = {
  'parties.json': 'partyInstanceReference',
  'customerAgreements.json': 'customerAgreementInstanceReference',
  'paymentCards.json': 'paymentCardInstanceReference',
  'payoutAccounts.json': 'payoutAccountInstanceReference',
  'cardTransactions.json': 'cardTransactionInstanceReference',
  'fraudCases.json': 'fraudDiagnosisInstanceReference',
};

describe('v33 F6: the generator is additive and refuses to clobber', () => {
  it.each(FIXTURES)('%s does not shrink', (file) => {
    expect(after[file].length).toBeGreaterThanOrEqual(before[file].length);
  });

  it.each(Object.keys(PRIMARY_KEY))('%s keeps every record it already had', (file) => {
    const key = PRIMARY_KEY[file];
    const kept = new Set(after[file].map((r) => r[key] as string));
    const deleted = before[file].map((r) => r[key] as string).filter((ref) => !kept.has(ref));
    expect(deleted).toEqual([]);
  });

  it('keeps the curated demo cast that the generator used to overwrite', () => {
    const names = new Set(after['parties.json'].map((p) => p.partyName as string));
    // The three merchant owners plus the staff roster the generator only knew three of.
    for (const name of ['Luis Fernandez', 'David Chen', 'Amara Okafor']) expect(names).toContain(name);
    expect(after['parties.json'].filter((p) => p.partyType === 'employee').length).toBeGreaterThanOrEqual(
      before['parties.json'].filter((p) => p.partyType === 'employee').length,
    );
  });

  it('is idempotent: a second run over its own output changes nothing', () => {
    const snapshot = FIXTURES.map((f) => readFileSync(join(workDir, f), 'utf-8'));
    execFileSync('npx', ['ts-node', join('bin', 'seed-generate.ts')], {
      cwd: BACKEND,
      env: { ...process.env, PSP_SEED_DATA_DIR: workDir },
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    FIXTURES.forEach((f, i) => expect(readFileSync(join(workDir, f), 'utf-8'), f).toBe(snapshot[i]));
  }, 300_000);

  it.each(FIXTURES)('%s carries neither governmentIdentificationReference nor a SYNTH- value (F5)', (file) => {
    const raw = readFileSync(join(workDir, file), 'utf-8');
    expect(raw).not.toContain('governmentIdentificationReference');
    expect(raw).not.toContain('SYNTH-');
  });

  it('leaves every transaction on a real card', () => {
    // The login half of this assertion moved with the logins: the authority seeds a principal for
    // every customer, and its own reconciliation test checks that against these very parties.

    const tokens = new Set(after['paymentCards.json'].map((c) => c.paymentCardReference as string));
    expect(after['cardTransactions.json'].filter((t) => !tokens.has(t.paymentCardReference as string))).toEqual([]);
  });
});

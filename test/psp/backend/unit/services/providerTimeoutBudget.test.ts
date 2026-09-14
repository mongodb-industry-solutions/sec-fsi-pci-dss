/**
 * Unit tests: a bank-facing provider is given a budget the bank can actually meet.
 * Source: psp/backend/data/externalProviderArrangement.json
 *         psp/backend/src/modules/provider/services/integrationDispatch.service.ts
 *
 * The dispatcher applies a 1500 ms floor to INTERNAL providers, because their loopback round trip is
 * more than a function call, and deliberately leaves EXTERNAL ones at whatever they declare. That is
 * the right split, and it means an external record's number is the whole story.
 *
 * Two of them were set below what the bank has ever been able to answer in: account information at
 * 500 ms and card authorisation at 200 ms, against a measured 0.7-2.1 s for a read that decrypts an
 * IBAN through Queryable Encryption. Both aborted every time, and the abort surfaced as `timeout`
 * with the declared budget nowhere in the message, so it read like an unreachable bank. Payment
 * initiation had already been given 10 s, which is why transfers were the one path that worked.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExternalProviderArrangement } from '../../../../../psp/backend/src/modules/provider/models/externalProviderArrangement.model';

const FIXTURE = join(process.cwd(), 'psp', 'backend', 'data', 'externalProviderArrangement.json');
const records = JSON.parse(readFileSync(FIXTURE, 'utf8')) as ExternalProviderArrangement[];

/** The floor `integrationDispatch` applies to internal providers, and does not apply to external ones. */
const INTERNAL_FLOOR_MS = 1500;

const external = records.filter((r) => r.externalProviderIsInternal === false);

describe('provider timeout budgets', () => {
  it('finds the external providers, so the checks below are not vacuous', () => {
    expect(external.length).toBeGreaterThan(0);
  });

  it('gives every external provider at least the floor the internal ones are granted', () => {
    const tooTight = external
      .filter((r) => r.externalProviderTimeoutMs < INTERNAL_FLOOR_MS)
      .map((r) => `${r.externalProviderArrangementInstanceReference}=${r.externalProviderTimeoutMs}ms`);
    expect(tooTight, 'an external provider gets no floor, so its declared budget is the whole story').toEqual([]);
  });

  it('declares a budget on every external provider rather than leaving it to a default', () => {
    for (const record of external) {
      expect(typeof record.externalProviderTimeoutMs, record.externalProviderArrangementInstanceReference).toBe('number');
      expect(record.externalProviderTimeoutMs).toBeGreaterThan(0);
    }
  });

  it('keeps the bank-facing reads within the budget the slowest bank-facing write already has', () => {
    // Payment initiation is the heaviest call the PSP makes at the bank and carries 10 s. Nothing
    // lighter should be asking for more than that, or the number stopped meaning anything.
    const heaviest = Math.max(...external.map((r) => r.externalProviderTimeoutMs));
    for (const record of external) {
      expect(record.externalProviderTimeoutMs, record.externalProviderArrangementInstanceReference)
        .toBeLessThanOrEqual(heaviest);
    }
  });
});

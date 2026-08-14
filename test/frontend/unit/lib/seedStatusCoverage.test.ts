/**
 * Data contract: every status the seeder writes must be renderable by the movement views.
 * A freshly seeded environment showed this the hard way: `disputed` (72 seeded card transactions,
 * present on the first page of 56 of the 57 customers) had no presentation entry, the fallback
 * carried no Icon, and the payment history died with React #130. Staging escaped only because demo
 * activity had pushed those rows off the first page, so the seed data is what must be asserted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAYMENT_STATUS, paymentStatusMeta } from '../../../../frontend/src/lib/paymentStatus';

const DATA_DIR = join(__dirname, '../../../../backend/data');

function statusesIn(file: string, field: string): string[] {
  const docs = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8')) as Record<string, unknown>[];
  return [...new Set(docs.map((d) => d[field]).filter((v): v is string => typeof v === 'string'))];
}

describe('seeded statuses are renderable', () => {
  it('maps every card transaction status in the fixtures explicitly', () => {
    const seeded = statusesIn('cardTransactions.json', 'cardTransactionStatus');
    expect(seeded.length).toBeGreaterThan(0);
    for (const status of seeded) {
      expect(PAYMENT_STATUS[status], `seeded status "${status}" has no presentation entry`).toBeDefined();
    }
  });

  it('resolves an Icon for every seeded status, mapped or not', () => {
    for (const status of statusesIn('cardTransactions.json', 'cardTransactionStatus')) {
      expect(paymentStatusMeta(status).Icon).toBeTruthy();
    }
  });
});

/**
 * Unit tests: merchant transaction-history data isolation (SD-89, v18)
 * Source: backend/src/modules/transaction/services/cardTransaction.service.ts (getPartyCardTransactions)
 *
 * Requirement: the merchant /history endpoint must return ONLY the activity the user performed IN THIS
 * specific merchant. For card purchases (SD-254) that means filtering by merchantAgreementInstanceReference.
 * These tests assert the query built by getPartyCardTransactions is merchant-scoped when a merchant id is
 * supplied and account-only when it is not (PSP-direct callers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const toArray = vi.fn().mockResolvedValue([]);
  const limit = vi.fn(() => ({ toArray }));
  const sort = vi.fn(() => ({ limit }));
  const find = vi.fn(() => ({ sort }));
  const qeDb = { collection: vi.fn(() => ({ find })) };
  return { find, qeDb, getDbForRole: vi.fn().mockResolvedValue(qeDb) };
});

vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
}));

import { getPartyCardTransactions } from '../../../../backend/src/modules/transaction/services/cardTransaction.service';

const ACCOUNT = 'ACCT-REF-1';
const MERCHANT = 'MERCH-AGREEMENT-1';

describe('getPartyCardTransactions — merchant data isolation (SD-89)', () => {
  beforeEach(() => {
    h.find.mockClear();
  });

  it('scopes the card query to the merchant when a merchant id is supplied', async () => {
    await getPartyCardTransactions({} as never, ACCOUNT, 200, MERCHANT);
    expect(h.find).toHaveBeenCalledTimes(1);
    expect(h.find.mock.calls[0][0]).toEqual({
      cardTransactionAccountReference: ACCOUNT,
      merchantAgreementInstanceReference: MERCHANT,
    });
  });

  it('does not add a merchant filter when no merchant id is supplied (PSP-direct)', async () => {
    await getPartyCardTransactions({} as never, ACCOUNT);
    expect(h.find).toHaveBeenCalledTimes(1);
    const query = h.find.mock.calls[0][0] as Record<string, unknown>;
    expect(query).toEqual({ cardTransactionAccountReference: ACCOUNT });
    expect(query).not.toHaveProperty('merchantAgreementInstanceReference');
  });

  it('returns empty (no query) when the account reference is missing', async () => {
    const rows = await getPartyCardTransactions({} as never, '', 200, MERCHANT);
    expect(rows).toEqual([]);
    expect(h.find).not.toHaveBeenCalled();
  });
});

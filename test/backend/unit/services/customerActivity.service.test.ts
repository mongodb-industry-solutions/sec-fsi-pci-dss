/**
 * Unit tests: v27 staff customer-transactions view (getCustomerTransactions)
 * Source: backend/src/modules/customer/services/customerActivity.service.ts
 *
 * The QE client and the delegated transaction/gateway services are mocked, so we assert the
 * role gate (PCI DSS Req 7 least privilege), the customerId -> party resolution, and the
 * display-safe merge/pagination of SD-65 executions + SD-254 card transactions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getDbForRole: vi.fn(),
  listPartyExecutions: vi.fn().mockResolvedValue([]),
  getPartyCardTransactions: vi.fn().mockResolvedValue([]),
  resolveAccountReferenceForParty: vi.fn().mockResolvedValue(undefined),
  getExecution: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
  // v32 C6: the sensitive-tier / encryption-write clients are the same double here.
  getSensitiveTierDb: h.getDbForRole,
  getEncryptionWriteDb: h.getDbForRole,
}));
vi.mock('../../../../backend/src/modules/gateway/services/paymentExecution.service', () => ({
  listPartyExecutions: h.listPartyExecutions,
  getExecution: h.getExecution,
}));
vi.mock('../../../../backend/src/modules/transaction/services/cardTransaction.service', () => ({
  getPartyCardTransactions: h.getPartyCardTransactions,
  resolveAccountReferenceForParty: h.resolveAccountReferenceForParty,
}));

import { getCustomerTransactions, getCustomerTransactionDetail } from '../../../../backend/src/modules/customer/services/customerActivity.service';

const agreement = {
  customerAgreementInstanceReference: 'ca-001',
  partyInstanceReference: 'party-001',
  customerAgreementReference: 'ACC-001',
};

function makeDb(agreementDoc: unknown = agreement) {
  return {
    collection: vi.fn(() => ({
      findOne: async () => agreementDoc,
    })),
  } as any;
}

beforeEach(() => {
  h.getDbForRole.mockReset().mockResolvedValue(makeDb());
  h.listPartyExecutions.mockReset().mockResolvedValue([]);
  h.getPartyCardTransactions.mockReset().mockResolvedValue([]);
  h.resolveAccountReferenceForParty.mockReset().mockResolvedValue(undefined);
  h.getExecution.mockReset().mockResolvedValue(null);
});

describe('getCustomerTransactions role gate (least-privilege, PCI DSS Req 7)', () => {
  it('forbids level1_analyst with 403', async () => {
    await expect(getCustomerTransactions(makeDb(), 'ca-001', 'level1_analyst'))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('forbids customer with 403', async () => {
    await expect(getCustomerTransactions(makeDb(), 'ca-001', 'customer'))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows level2_investigator and security_auditor', async () => {
    await expect(getCustomerTransactions(makeDb(), 'ca-001', 'level2_investigator')).resolves.toBeDefined();
    await expect(getCustomerTransactions(makeDb(), 'ca-001', 'security_auditor')).resolves.toBeDefined();
  });
});

describe('getCustomerTransactions resolution + merge', () => {
  it('returns empty result when the agreement is not found', async () => {
    h.getDbForRole.mockResolvedValue(makeDb(null));
    const res = await getCustomerTransactions(makeDb(), 'missing', 'security_auditor');
    expect(res).toEqual({ results: [], total: 0, page: 1, limit: 20 });
  });

  it('merges executions + card transactions display-safe, sorted most-recent first', async () => {
    h.listPartyExecutions.mockResolvedValue([
      {
        paymentExecutionInstanceReference: 'pe-1',
        initiatorPartyReference: 'party-001',
        grossAmount: 100, netAmount: 98, feeAmount: 2, currency: 'EUR',
        paymentExecutionRail: 'sepa', paymentExecutionStatus: 'settled',
        paymentExecutionRemittanceInformation: 'rent',
        beneficiaryName: 'Landlord', destinationAccountMasked: 'ES12••••5477',
        initiatedAt: new Date('2026-01-01'), completedAt: new Date('2026-01-02'),
      },
    ]);
    h.getPartyCardTransactions.mockResolvedValue([
      {
        cardTransactionInstanceReference: 'ct-1',
        grossAmount: 50, currency: 'EUR', status: 'authorized',
        merchantName: 'Coffee', maskedPan: '****-****-****-4242', channel: 'pos',
        cardTransactionDescription: 'COFFEE', initiatedAt: new Date('2026-02-01').toISOString(),
      },
    ]);

    const res = await getCustomerTransactions(makeDb(), 'ca-001', 'level2_investigator');
    expect(res.total).toBe(2);
    // Most recent (card txn, Feb) first.
    expect(res.results[0].kind).toBe('card');
    expect(res.results[0].direction).toBe('sent');
    expect(res.results[1].kind).toBe('transfer');
    expect(res.results[1].direction).toBe('sent');
    // Display-safe: no raw PAN / IBAN, only masked forms.
    expect(res.results[0].destinationAccountMasked).toBe('****-****-****-4242');
  });

  it('marks a received execution direction when the party is the beneficiary', async () => {
    h.listPartyExecutions.mockResolvedValue([
      {
        paymentExecutionInstanceReference: 'pe-2',
        initiatorPartyReference: 'party-999',
        beneficiaryPartyReference: 'party-001',
        grossAmount: 10, currency: 'EUR', paymentExecutionStatus: 'settled',
        initiatedAt: new Date('2026-01-01'),
      },
    ]);
    const res = await getCustomerTransactions(makeDb(), 'ca-001', 'security_auditor');
    expect(res.results[0].direction).toBe('received');
  });
});

describe('getCustomerTransactionDetail (SD-65 staff drill-down)', () => {
  const exec = {
    paymentExecutionInstanceReference: 'pe-1',
    beneficiaryType: 'user',
    initiatorPartyReference: 'party-001',
    beneficiaryPartyReference: 'party-999',
    grossAmount: 100, netAmount: 98, feeAmount: 2, currency: 'EUR',
    paymentExecutionRail: 'sepa', paymentExecutionStatus: 'completed',
    paymentExecutionRemittanceInformation: 'rent',
    beneficiaryName: 'Landlord', destinationAccountMasked: 'ES12••••5477',
    destinationIban: 'ES1234567890123456785477', // must NOT leak
    resolutionLog: [{ stepName: 'resolve', stepOutcome: 'found', stepDateTime: new Date() }],
  };

  it('forbids level1_analyst and customer with 403', async () => {
    await expect(getCustomerTransactionDetail(makeDb(), 'ca-001', 'pe-1', 'level1_analyst'))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(getCustomerTransactionDetail(makeDb(), 'ca-001', 'pe-1', 'customer'))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('404s when the agreement is not found', async () => {
    h.getDbForRole.mockResolvedValue(makeDb(null));
    await expect(getCustomerTransactionDetail(makeDb(), 'missing', 'pe-1', 'level2_investigator'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s on a foreign execution not belonging to the party', async () => {
    h.getExecution.mockResolvedValue({
      ...exec, initiatorPartyReference: 'party-aaa', beneficiaryPartyReference: 'party-bbb',
    });
    await expect(getCustomerTransactionDetail(makeDb(), 'ca-001', 'pe-1', 'security_auditor'))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns display-safe detail for an owned execution (no raw IBAN)', async () => {
    h.getExecution.mockResolvedValue(exec);
    const d = await getCustomerTransactionDetail(makeDb(), 'ca-001', 'pe-1', 'level2_investigator');
    expect(d.kind).toBe('transfer');
    expect(d.direction).toBe('sent'); // party-001 is the initiator
    expect(d.destinationAccountMasked).toBe('ES12••••5477');
    expect(d.concept).toBe('rent');
    expect(d.resolutionLog).toHaveLength(1);
    expect((d as Record<string, unknown>).destinationIban).toBeUndefined();
  });
});

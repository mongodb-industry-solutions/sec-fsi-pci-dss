/**
 * Unit tests: the investigation read-model supports every movement type, not only card payments.
 * A transfer / RTP case must resolve its own operation and its counterparty (beneficiary, external
 * account or payee) instead of falling back to an empty merchant panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getCaseById: vi.fn(),
  getTransactionById: vi.fn(async () => null),
  getByInstanceReference: vi.fn(async () => null),
  getMerchantById: vi.fn(async () => null),
  listProcessEvents: vi.fn(async () => ({ events: [], total: 0 })),
}));
vi.mock('../../../../../psp/backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({ getCaseById: h.getCaseById }));
vi.mock('../../../../../psp/backend/src/modules/transaction/services/cardTransaction.service', () => ({ getTransactionById: h.getTransactionById }));
vi.mock('../../../../../psp/backend/src/modules/customer/services/customerAgreement.service', () => ({ getByInstanceReference: h.getByInstanceReference }));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/merchant.service', () => ({ getMerchantById: h.getMerchantById }));
vi.mock('../../../../../psp/backend/src/modules/provider/services/businessProcessEvent.service', () => ({ listProcessEvents: h.listProcessEvents }));

import type { Db } from 'mongodb';
import { getCaseEnrichment } from '../../../../../psp/backend/src/modules/fraud/services/caseEnrichment.service';

const EXEC = 'exec-1';
const REQ = 'req-1';

const heldExecution = {
  paymentExecutionInstanceReference: EXEC,
  paymentExecutionStatus: 'pending',
  paymentExecutionRail: 'sepa',
  grossAmount: 1450, netAmount: 1450, currency: 'EUR',
  sourcePayoutAccountReference: 'acc-sender',
  resolvedPayoutAccountReference: 'acc-dest',
  beneficiaryPartyReference: 'party-2',
  beneficiaryArrangementReference: 'cab-1',
  paymentExecutionRemittanceInformation: 'Car deposit',
  initiatedAt: new Date('2026-07-08T09:20:00Z'),
  resolutionLog: [{ stepName: 'risk.hold', stepOutcome: 'fallback', stepDateTime: new Date() }],
};

// Only the collections the read-model reads for a non-card case. `account` answers for every account
// lookup (source and destination), which is enough to assert the shape.
function db(docs: { execution?: unknown; request?: unknown; arrangement?: unknown; party?: unknown; agreement?: unknown; account?: unknown }): Db {
  return {
    collection: (name: string) => ({
      findOne: vi.fn(async () => {
        if (name === 'paymentExecutionProcedure') return docs.execution ?? null;
        if (name === 'paymentRequestProcedure') return docs.request ?? null;
        if (name === 'counterpartyArrangement') return docs.arrangement ?? null;
        if (name === 'party') return docs.party ?? null;
        if (name === 'customerAgreementProcedure') return docs.agreement ?? null;
        if (name === 'payoutAccountArrangement') return docs.account ?? null;
        return null;
      }),
    }),
  } as unknown as Db;
}

const ARRANGEMENT = {
  counterpartyArrangementReference: 'cab-1', counterpartyLabel: 'Carlos (savings)',
  counterpartyLookupHint: '+34 6** *** 789', counterpartyLookupType: 'phone',
  counterpartyPartyReference: 'party-2', counterpartyArrangementStatus: 'active',
  recordCreatedDateTime: new Date('2026-05-01T00:00:00Z'),
};
const PARTY = { partyInstanceReference: 'party-2', partyName: 'Carlos Ruiz', partyType: 'individual' };
const AGREEMENT = { customerAgreementInstanceReference: 'agr-2' };
const ACCOUNT = {
  payoutAccountInstanceReference: 'acc-dest', payoutAccountAlias: 'Main',
  payoutAccountBankName: 'Banco Uno', payoutAccountHolderName: 'Carlos Ruiz',
  payoutAccountCurrency: 'EUR', payoutAccountCountryCode: 'ES',
  payoutAccountType: 'internal_ledger', payoutAccountStatus: 'active',
  partyInstanceReference: 'party-2',
  payoutAccountBalance: { availableAmount: 300, pendingAmount: 1450 },
  payoutAccountIban: 'ES9121000418450200051332',
};

const caseDoc = (over: Record<string, unknown>) => ({
  fraudDiagnosisInstanceReference: 'case-1',
  cardTransactionInstanceReference: EXEC,
  customerAgreementInstanceReference: 'cust-1',
  fraudDiagnosisAssessment: { riskIndicators: ['fds.high.risk'], fraudDiagnosisScore: 78 },
  ...over,
});

describe('a P2P case resolves the beneficiary, not a merchant', () => {
  beforeEach(() => { h.getTransactionById.mockResolvedValue(null); });

  it('builds the operation from the execution and flags the hold', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ transactionKind: 'p2p', paymentExecutionInstanceReference: EXEC }));
    const out = await getCaseEnrichment(db({ execution: heldExecution, arrangement: { counterpartyArrangementReference: 'cab-1', counterpartyLabel: 'Carlos (savings)', counterpartyLookupHint: '+34 6** *** 789' } }), 'case-1', 'level1_analyst');
    const op = out!.operation as Record<string, unknown>;
    expect(out!.transactionKind).toBe('p2p');
    expect(op).toMatchObject({ kind: 'p2p', type: 'transfer', status: 'pending', rail: 'sepa', heldForReview: true });
    expect(op.amount).toEqual({ amount: 1450, currency: 'EUR' });
    expect(op.description).toBe('Car deposit');
  });

  it('exposes the registered beneficiary to L1, masked, and no merchant panel', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ transactionKind: 'p2p', paymentExecutionInstanceReference: EXEC }));
    const out = await getCaseEnrichment(db({ execution: heldExecution, arrangement: { counterpartyArrangementReference: 'cab-1', counterpartyLabel: 'Carlos (savings)', counterpartyLookupHint: '+34 6** *** 789' } }), 'case-1', 'level1_analyst');
    expect(out!.counterparty).toMatchObject({
      kind: 'beneficiary', label: 'Carlos (savings)', accountMasked: '+34 6** *** 789',
      arrangementReference: 'cab-1', accountReference: 'acc-dest',
    });
    expect(out!.kyb).toBeNull();
  });

  it('never leaks a full account number for an unregistered destination', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ transactionKind: 'bank_transfer', paymentExecutionInstanceReference: EXEC }));
    const exec = {
      ...heldExecution, beneficiaryArrangementReference: undefined,
      beneficiaryName: 'ACME GmbH', destinationAccountMasked: 'DE89••••3000',
      destinationIban: 'DE89370400440532013000', destinationCountry: 'DE',
    };
    const out = await getCaseEnrichment(db({ execution: exec }), 'case-1', 'level1_analyst');
    const cp = out!.counterparty as Record<string, unknown>;
    expect(cp).toMatchObject({ kind: 'external_account', label: 'ACME GmbH', accountMasked: 'DE89••••3000', countryCode: 'DE' });
    expect(JSON.stringify(out)).not.toContain('DE89370400440532013000');
  });
});

describe('an RTP case resolves the payee from the request', () => {
  beforeEach(() => { h.getTransactionById.mockResolvedValue(null); });

  it('builds the operation from the payment request', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ transactionKind: 'rtp', cardTransactionInstanceReference: REQ, paymentRequestInstanceReference: REQ }));
    const request = {
      paymentRequestInstanceReference: REQ, status: 'accepted', amount: 90, currency: 'EUR',
      payeeName: 'Ana Ruiz', payeeReceivingAccountReference: 'acc-payee', requesterPartyReference: 'party-3',
      purpose: 'Shared rent', recordCreatedDateTime: new Date('2026-07-09T10:00:00Z'),
    };
    // The payee name is L2-only (QE:none), so read it as L2 here; L1's redaction is asserted below.
    const out = await getCaseEnrichment(db({ request }), 'case-1', 'level2_investigator');
    expect(out!.operation).toMatchObject({ kind: 'rtp', type: 'request_to_pay', status: 'accepted', heldForReview: true });
    expect(out!.counterparty).toMatchObject({ kind: 'payee', label: 'Ana Ruiz', accountReference: 'acc-payee' });
  });
});

describe('a card case keeps its existing shape', () => {
  it('reports kind card, no counterparty, and the merchant fields', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ cardTransactionInstanceReference: 'txn-1' }));
    h.getTransactionById.mockResolvedValue({
      cardTransactionInstanceReference: 'txn-1', cardTransactionStatus: 'authorized',
      cardTransactionMerchantName: 'Coffee Ltd', cardTransactionMerchantCategoryCode: '5812',
      cardTransactionMaskedPanDisplay: '****-****-****-4242',
      cardTransactionAmount: { amount: 30, currency: 'EUR' }, cardTransactionDateTime: new Date(),
    } as never);
    const out = await getCaseEnrichment(db({}), 'case-1', 'level1_analyst');
    expect(out!.transactionKind).toBe('card');
    expect(out!.counterparty).toBeNull();
    expect(out!.operation).toMatchObject({ kind: 'card', merchantName: 'Coffee Ltd', merchantCategoryCode: '5812' });
  });
});

// Cases opened before ADR-062 carry no discriminator: the read-model must still resolve them, or the
// UI keeps rendering a merchant that does not exist.
describe('an unstamped (legacy) case is resolved by lookup', () => {
  beforeEach(() => { h.getTransactionById.mockResolvedValue(null); });

  it('infers p2p from an execution with a beneficiary arrangement', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({}));  // no transactionKind, no execution link
    const out = await getCaseEnrichment(db({ execution: heldExecution, arrangement: { counterpartyArrangementReference: 'cab-1', counterpartyLabel: 'Carlos', counterpartyLookupHint: '+34 6** *** 789' } }), 'case-1', 'level1_analyst');
    expect(out!.transactionKind).toBe('p2p');
    expect(out!.counterparty).toMatchObject({ kind: 'beneficiary', label: 'Carlos' });
    expect(out!.kyb).toBeNull();
  });

  it('infers bank_transfer from an execution with no arrangement', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({}));
    const exec = { ...heldExecution, beneficiaryArrangementReference: undefined, beneficiaryName: 'ACME GmbH' };
    const out = await getCaseEnrichment(db({ execution: exec }), 'case-1', 'level1_analyst');
    expect(out!.transactionKind).toBe('bank_transfer');
    expect(out!.counterparty).toMatchObject({ kind: 'external_account', label: 'ACME GmbH' });
  });

  it('stays a card case when neither an execution nor a request exists', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({}));
    const out = await getCaseEnrichment(db({}), 'case-1', 'level1_analyst');
    expect(out!.transactionKind).toBe('card');
    expect(out!.operation).toBeNull();
    expect(out!.counterparty).toBeNull();
  });
});

// A real investigation needs the identity behind the beneficiary and both accounts, not just a label.
describe('the counterparty carries the owner and the accounts', () => {
  beforeEach(() => { h.getTransactionById.mockResolvedValue(null); });

  it('resolves the owner party and the agreement id for the drill-down', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ transactionKind: 'p2p', paymentExecutionInstanceReference: EXEC }));
    const out = await getCaseEnrichment(db({ execution: heldExecution, arrangement: ARRANGEMENT, party: PARTY, agreement: AGREEMENT, account: ACCOUNT }), 'case-1', 'level1_analyst');
    const cp = out!.counterparty as Record<string, unknown>;
    expect(cp.ownerParty).toMatchObject({ reference: 'party-2', name: 'Carlos Ruiz', type: 'individual', customerAgreementInstanceReference: 'agr-2' });
    expect(cp.lookupType).toBe('phone');
    expect(cp.status).toBe('active');
  });

  it('summarises the receiving account and the payer account, with the held amount', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ transactionKind: 'p2p', paymentExecutionInstanceReference: EXEC }));
    const out = await getCaseEnrichment(db({ execution: heldExecution, arrangement: ARRANGEMENT, party: PARTY, agreement: AGREEMENT, account: ACCOUNT }), 'case-1', 'level1_analyst');
    const cp = out!.counterparty as { account?: Record<string, unknown> };
    expect(cp.account).toMatchObject({ reference: 'acc-dest', holderName: 'Carlos Ruiz', bankName: 'Banco Uno', currency: 'EUR', status: 'active' });
    expect(out!.sourceAccount).toMatchObject({ balance: { available: 300, pending: 1450 } });
  });

  it('never exposes the account IBAN on this surface (it is QE:none)', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ transactionKind: 'p2p', paymentExecutionInstanceReference: EXEC }));
    const out = await getCaseEnrichment(db({ execution: heldExecution, arrangement: ARRANGEMENT, party: PARTY, agreement: AGREEMENT, account: ACCOUNT }), 'case-1', 'level1_analyst');
    expect(JSON.stringify(out)).not.toContain('ES9121000418450200051332');
    expect(JSON.stringify(out)).not.toContain('payoutAccountIban');
  });

  it('a card case gets no source account block', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ cardTransactionInstanceReference: 'txn-1' }));
    h.getTransactionById.mockResolvedValue({
      cardTransactionInstanceReference: 'txn-1', cardTransactionStatus: 'authorized',
      cardTransactionMerchantName: 'Coffee Ltd', cardTransactionAmount: { amount: 30, currency: 'EUR' },
      cardTransactionDateTime: new Date(),
    } as never);
    const out = await getCaseEnrichment(db({ account: ACCOUNT }), 'case-1', 'level1_analyst');
    expect(out!.sourceAccount).toBeNull();
  });
});

// paymentRequestProcedure.payeeName is QE:none and L2-only. The read client decrypts it, so the
// read-model must withhold it, not merely leave it unrendered.
describe('the RTP payee name stays restricted to L2 / auditor', () => {
  const request = {
    paymentRequestInstanceReference: REQ, status: 'accepted', amount: 90, currency: 'EUR',
    payeeName: 'Ana Ruiz', payeeReceivingAccountReference: 'acc-payee', requesterPartyReference: 'party-3',
    recordCreatedDateTime: new Date(),
  };
  const rtpCase = () => caseDoc({ transactionKind: 'rtp', cardTransactionInstanceReference: REQ, paymentRequestInstanceReference: REQ });

  beforeEach(() => { h.getTransactionById.mockResolvedValue(null); });

  it('withholds the payee name (and the account holder) from L1', async () => {
    h.getCaseById.mockResolvedValue(rtpCase());
    const out = await getCaseEnrichment(db({ request, party: PARTY, agreement: AGREEMENT, account: ACCOUNT }), 'case-1', 'level1_analyst');
    const cp = out!.counterparty as Record<string, unknown>;
    expect(cp.label).toBeNull();
    expect(cp.labelRestricted).toBe(true);
    expect(JSON.stringify(out)).not.toContain('Ana Ruiz');
    expect((cp.account as { holderName?: string }).holderName).toBeNull();
  });

  it('returns it to L2 and to the auditor', async () => {
    for (const role of ['level2_investigator', 'security_auditor'] as const) {
      h.getCaseById.mockResolvedValue(rtpCase());
      const out = await getCaseEnrichment(db({ request, party: PARTY, agreement: AGREEMENT, account: ACCOUNT }), 'case-1', role);
      expect((out!.counterparty as Record<string, unknown>).label, role).toBe('Ana Ruiz');
      expect((out!.counterparty as Record<string, unknown>).labelRestricted, role).toBe(false);
    }
  });

  it('a beneficiary label is plaintext by design and stays visible to L1', async () => {
    h.getCaseById.mockResolvedValue(caseDoc({ transactionKind: 'p2p', paymentExecutionInstanceReference: EXEC }));
    const out = await getCaseEnrichment(db({ execution: heldExecution, arrangement: ARRANGEMENT, party: PARTY, agreement: AGREEMENT, account: ACCOUNT }), 'case-1', 'level1_analyst');
    expect((out!.counterparty as Record<string, unknown>).label).toBe('Carlos (savings)');
    expect((out!.counterparty as Record<string, unknown>).labelRestricted).toBe(false);
  });
});

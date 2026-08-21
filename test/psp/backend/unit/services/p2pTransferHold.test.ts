/**
 * Unit tests (PR #116 review): the P2P risk-hold path holds the sender funds before persisting the
 * `pending` execution, so a persistence failure must release them. Otherwise the account is left with
 * money reserved and no execution the resolution could ever release.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  screenTransfer: vi.fn(),
  openTransferFraudCase: vi.fn(async () => {}),
  getPayoutAccount: vi.fn(),
  getDefaultPayoutAccount: vi.fn(async () => null),
  holdAvailableFunds: vi.fn(async () => true),
  releaseReservation: vi.fn(async () => true),
  dispatchProvider: vi.fn(async () => ({ provider: 'internal', status: 'received', responseBody: {} })),
  emitProcessEvent: vi.fn(),
  emitComplianceEvent: vi.fn(),
  insertOne: vi.fn(async () => ({ insertedId: 'x' })),
}));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/transferRiskGate', () => ({
  screenTransfer: h.screenTransfer, openTransferFraudCase: h.openTransferFraudCase,
}));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/payoutAccount.service', () => ({
  getPayoutAccount: h.getPayoutAccount, getDefaultPayoutAccount: h.getDefaultPayoutAccount,
}));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/payoutAccountBalance.service', () => ({
  holdAvailableFunds: h.holdAvailableFunds, releaseReservation: h.releaseReservation,
}));
vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationDispatch.service', () => ({ dispatchProvider: h.dispatchProvider }));
vi.mock('../../../../../psp/backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: h.emitProcessEvent, emitComplianceEvent: h.emitComplianceEvent,
}));

import type { Db } from 'mongodb';
import { executeP2PTransfer } from '../../../../../psp/backend/src/modules/gateway/services/p2pTransfer.service';

const PARTY = 'p-1';
const FROM = 'acc-sender';
const AMOUNT = 800;

const ARRANGEMENT = {
  counterpartyArrangementReference: 'cab-1', ownerPartyReference: PARTY,
  counterpartyPartyReference: 'p-2', counterpartyLabel: 'Carlos',
  counterpartyArrangementStatus: 'active',
};
const SENDER = {
  payoutAccountInstanceReference: FROM, partyInstanceReference: PARTY,
  payoutAccountStatus: 'active', payoutAccountCurrency: 'EUR', payoutAccountPreferredRail: 'sepa',
};
const RECIPIENT = {
  payoutAccountInstanceReference: 'acc-dest', partyInstanceReference: 'p-2',
  payoutAccountStatus: 'active', payoutAccountCurrency: 'EUR', payoutAccountPreferredRail: 'sepa',
  payoutAccountCountryCode: 'ES',
};

// The service reads the arrangement, then the accounts, then inserts the execution.
const db = () => ({
  collection: (name: string) => ({
    findOne: vi.fn(async () => (name === 'counterpartyArrangement' ? ARRANGEMENT : RECIPIENT)),
    insertOne: h.insertOne,
    updateOne: vi.fn(async () => ({ matchedCount: 1 })),
  }),
} as unknown as Db);

const input = { initiatorPartyRef: PARTY, counterpartyArrangementRef: 'cab-1', fromAccountRef: FROM, amount: AMOUNT };

describe('the P2P risk hold compensates a persistence failure', () => {
  beforeEach(() => {
    for (const fn of Object.values(h)) (fn as { mockClear?: () => void }).mockClear?.();
    h.holdAvailableFunds.mockResolvedValue(true);
    h.getPayoutAccount.mockResolvedValue(SENDER);
    h.screenTransfer.mockResolvedValue({ hold: true, indicators: ['fds.high.risk'], score: 78 });
  });

  it('holds the funds and parks the execution on the happy path', async () => {
    const res = await executeP2PTransfer(db(), input);
    expect(h.holdAvailableFunds).toHaveBeenCalledWith(expect.anything(), FROM, AMOUNT);
    expect(h.insertOne).toHaveBeenCalled();
    expect(res.status).toBe('pending');
    expect(h.releaseReservation).not.toHaveBeenCalled();
  });

  it('releases the hold when the held execution cannot be persisted', async () => {
    h.insertOne.mockRejectedValueOnce(new Error('write failed'));
    const res = await executeP2PTransfer(db(), input);
    expect(h.releaseReservation).toHaveBeenCalledWith(expect.anything(), FROM, AMOUNT);
    expect(res.status).toBe('failed');
    expect(res.failureReason).toMatch(/no funds were moved/i);
  });

  it('never dispatches to the rail while the movement is held', async () => {
    await executeP2PTransfer(db(), input);
    expect(h.dispatchProvider).not.toHaveBeenCalled();
  });
});

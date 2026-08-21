/**
 * Unit tests (PR #116 review): a held bank transfer must immobilise the money it parks.
 *
 * `reverseHeldTransfer` releases the sender hold (pending -> available) for any execution carrying a
 * `sourcePayoutAccountReference`, and the bank-transfer path sets that reference whenever the caller
 * chose a source account. Parking the execution WITHOUT holding therefore made the later reversal
 * release a reservation that never existed, i.e. it would have credited available funds out of thin
 * air. The hold is now taken before the execution is persisted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  screenTransfer: vi.fn(),
  openTransferFraudCase: vi.fn(async () => {}),
  getPayoutAccount: vi.fn(),
  holdAvailableFunds: vi.fn(async () => true),
  releaseReservation: vi.fn(async () => true),
  dispatchProvider: vi.fn(async () => ({ provider: 'internal', status: 'received', responseBody: {} })),
  emitProcessEvent: vi.fn(),
  emitComplianceEvent: vi.fn(),
  insertOne: vi.fn(async () => ({ insertedId: 'x' })),
  updateOne: vi.fn(async () => ({ matchedCount: 1 })),
}));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/transferRiskGate', () => ({
  screenTransfer: h.screenTransfer, openTransferFraudCase: h.openTransferFraudCase,
}));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/payoutAccount.service', () => ({ getPayoutAccount: h.getPayoutAccount }));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/payoutAccountBalance.service', () => ({
  holdAvailableFunds: h.holdAvailableFunds, releaseReservation: h.releaseReservation, settleReservedDebit: vi.fn(),
  creditAvailable: vi.fn(), creditDirect: vi.fn(), debitPending: vi.fn(), releasePendingCredit: vi.fn(),
}));
vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationDispatch.service', () => ({ dispatchProvider: h.dispatchProvider }));
vi.mock('../../../../../psp/backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: h.emitProcessEvent, emitComplianceEvent: h.emitComplianceEvent,
}));

import type { Db } from 'mongodb';
import { executeBankTransfer } from '../../../../../psp/backend/src/modules/gateway/services/bankTransfer.service';

const FROM = 'acc-sender';
const PARTY = 'p-1';
const AMOUNT = 900;

// A valid SEPA destination so the rail engine resolves and the flow reaches the risk gate.
const input = (over: Record<string, unknown> = {}) => ({
  initiatorPartyRef: PARTY,
  amount: AMOUNT,
  currency: 'EUR',
  destination: {
    countryCode: 'ES', currency: 'EUR',
    iban: 'ES9121000418450200051332', beneficiaryName: 'Carlos Ruiz',
  },
  fromAccountRef: FROM,
  ...over,
} as Parameters<typeof executeBankTransfer>[1]);

const db = () => ({
  collection: () => ({ insertOne: h.insertOne, updateOne: h.updateOne, findOne: vi.fn(async () => null) }),
} as unknown as Db);

const heldExecution = () => (h.insertOne.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;

describe('a held bank transfer reserves the money it parks', () => {
  beforeEach(() => {
    for (const fn of Object.values(h)) (fn as { mockClear?: () => void }).mockClear?.();
    h.holdAvailableFunds.mockResolvedValue(true);
    // Source account owned by the initiator and active, so the ownership check passes.
    h.getPayoutAccount.mockResolvedValue({
      payoutAccountInstanceReference: FROM, partyInstanceReference: PARTY, payoutAccountStatus: 'active',
    });
    h.screenTransfer.mockResolvedValue({ hold: true, indicators: ['fds.high.risk'], score: 78, reason: 'Fraud risk (FDS).' });
  });

  it('holds the sender funds for the exact amount the reversal would release', async () => {
    const res = await executeBankTransfer(db(), input());
    expect(h.holdAvailableFunds).toHaveBeenCalledWith(expect.anything(), FROM, AMOUNT);
    // Same account + amount the execution records, which is what reverseHeldTransfer reads back.
    const exec = heldExecution();
    expect(exec.sourcePayoutAccountReference).toBe(FROM);
    expect(exec.grossAmount).toBe(AMOUNT);
    expect(res.status).toBe('pending');
  });

  it('parks the execution only after the hold succeeded', async () => {
    await executeBankTransfer(db(), input());
    const holdOrder = h.holdAvailableFunds.mock.invocationCallOrder[0];
    const insertOrder = h.insertOne.mock.invocationCallOrder[0];
    expect(holdOrder).toBeLessThan(insertOrder);
  });

  it('refuses the movement when the balance cannot cover the hold', async () => {
    h.holdAvailableFunds.mockResolvedValue(false);
    const res = await executeBankTransfer(db(), input());
    expect(res.status).toBe('exception');
    expect(res.errors?.[0]).toMatch(/insufficient available balance/i);
    // No held execution was created: nothing is parked that the reversal could act on.
    const exec = heldExecution();
    expect(exec.paymentExecutionStatus).not.toBe('pending');
  });

  it('holds nothing when the transfer is not drawn from a PSP account', async () => {
    const res = await executeBankTransfer(db(), input({ fromAccountRef: undefined }));
    expect(h.holdAvailableFunds).not.toHaveBeenCalled();
    expect(res.status).toBe('pending');
    // With no source reference, the reversal has nothing to release either: coherent.
    expect(heldExecution().sourcePayoutAccountReference).toBeUndefined();
  });

  it('still dispatches to the rail when the gate does not hold', async () => {
    h.screenTransfer.mockResolvedValue({ hold: false, indicators: [], score: 10 });
    const res = await executeBankTransfer(db(), input());
    expect(h.holdAvailableFunds).not.toHaveBeenCalled();
    expect(h.dispatchProvider).toHaveBeenCalled();
    expect(res.status).toBe('submitted');
  });
});

/**
 * PR #116 review: the hold is taken before the execution is persisted, so a failure in between would
 * leave the sender's funds reserved with no execution to release them. That is the same invariant the
 * payout process states for its own reservation ("a failure must never leave the merchant holding an
 * amount that will not settle"), applied to the payer side.
 */
describe('a failure past the reservation releases the hold', () => {
  beforeEach(() => {
    for (const fn of Object.values(h)) (fn as { mockClear?: () => void }).mockClear?.();
    h.holdAvailableFunds.mockResolvedValue(true);
    h.getPayoutAccount.mockResolvedValue({
      payoutAccountInstanceReference: FROM, partyInstanceReference: PARTY, payoutAccountStatus: 'active',
    });
    h.screenTransfer.mockResolvedValue({ hold: true, indicators: ['fds.high.risk'], score: 78 });
  });

  it('releases the funds when the held execution cannot be persisted', async () => {
    h.insertOne.mockRejectedValueOnce(new Error('write failed'));
    const res = await executeBankTransfer(db(), input());
    expect(h.releaseReservation).toHaveBeenCalledWith(expect.anything(), FROM, AMOUNT);
    expect(res.status).toBe('exception');
    expect(res.errors?.[0]).toMatch(/no funds were moved/i);
  });

  it('has nothing to release when no hold was taken', async () => {
    h.insertOne.mockRejectedValueOnce(new Error('write failed'));
    const res = await executeBankTransfer(db(), input({ fromAccountRef: undefined }));
    expect(h.releaseReservation).not.toHaveBeenCalled();
    expect(res.status).toBe('exception');
  });
});

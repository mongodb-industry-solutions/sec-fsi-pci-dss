/**
 * Unit tests (v17): funds-availability gate correctness.
 *  - checkFunds (pure): interprets the ledger balance into a funds verdict.
 *  - PaymentAuthorizationSaga: compensation, a hold made by the funds gate is released (pending ->
 *    available) whenever the journey is declined by ANY gate, including the ordering race where the
 *    hold lands AFTER an earlier decline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  completeAuthorized: vi.fn(async () => ({ fraudCaseCreated: false })),
  declineTransaction: vi.fn(async () => {}),
  releaseCardHold: vi.fn(async () => true),
}));
vi.mock('../../../../backend/src/modules/transaction/services/cardTransaction.service', () => ({
  completeAuthorized: h.completeAuthorized,
  declineTransaction: h.declineTransaction,
}));
vi.mock('../../../../backend/src/modules/gateway/services/payoutAccountBalance.service', () => ({
  releaseCardHold: h.releaseCardHold,
}));

import { EventBusInProcess } from '@leafypay/eventbus';
import { makeEvent } from '../../../../backend/src/vendors/eventbus';
import type { Db } from 'mongodb';
import { PaymentAuthorizationSaga } from '../../../../backend/src/modules/transaction/services/paymentAuthorization.saga';
import {
  checkFunds,
  DEFAULT_ACCOUNT_INFORMATION_CONFIG,
} from '../../../../backend/src/providers/account-information/services/accountInformation.service';
import type { PayoutAccountArrangement } from '../../../../backend/src/modules/gateway/models/payoutAccount.model';

const flush = () => new Promise((r) => setTimeout(r, 15));
const GATES = ['card.issuer', 'fds', 'hrp', 'funds'];

function account(available: number): PayoutAccountArrangement {
  return {
    payoutAccountInstanceReference: 'acc-1', partyInstanceReference: 'p-1',
    payoutAccountType: 'internal_ledger', payoutAccountStatus: 'active', payoutAccountIsDefault: true,
    payoutAccountCurrency: 'EUR', payoutAccountCountryCode: 'ES', payoutAccountPreferredRail: 'internal_ledger',
    payoutAccountBalance: { pendingAmount: 0, availableAmount: available, reservedAmount: 0, currency: 'EUR', lastUpdatedDateTime: new Date() },
    bianServiceDomain: 'Payment Initiation', bianControlRecordType: 'PayoutAccountArrangement',
    recordCreatedDateTime: new Date(), recordUpdatedDateTime: new Date(), schemaVersion: 1,
  };
}

describe('checkFunds (SD-36 AIS)', () => {
  it('is sufficient when available >= amount on an active account', () => {
    const v = checkFunds(account(500), 200, DEFAULT_ACCOUNT_INFORMATION_CONFIG);
    expect(v).toMatchObject({ accountVerified: true, accountStatus: 'active', sufficient: true, available: 500, currency: 'EUR' });
  });
  it('is insufficient when available < amount', () => {
    expect(checkFunds(account(100), 200, DEFAULT_ACCOUNT_INFORMATION_CONFIG).sufficient).toBe(false);
  });
  it('rejects a missing account', () => {
    const v = checkFunds(null, 10, DEFAULT_ACCOUNT_INFORMATION_CONFIG);
    expect(v.accountVerified).toBe(false);
    expect(v.sufficient).toBe(false);
  });
});

describe('PaymentAuthorizationSaga: funds hold compensation', () => {
  let bus: EventBusInProcess;
  beforeEach(() => {
    h.completeAuthorized.mockClear(); h.declineTransaction.mockClear(); h.releaseCardHold.mockClear();
    bus = new EventBusInProcess();
    new PaymentAuthorizationSaga({} as Db, bus).register();
  });

  const gate = (t: string, id: string, approved: boolean, extra: Record<string, unknown> = {}) =>
    makeEvent({ eventType: t, correlationId: id, businessProcess: 'card_payment' as const, payload: { outcome: approved ? 'approved' : 'declined', approved, ...extra } });
  const start = (id: string) => makeEvent({ eventType: 'card.payment.authorization.requested', correlationId: id, businessProcess: 'card_payment' as const, payload: { gatesExpected: GATES } });

  it('does NOT release the hold when all gates approve (funds stays as pending until settlement)', async () => {
    await bus.publish(start('a'));
    await bus.publish(gate('funds.check.completed', 'a', true, { held: 50, fundingPayoutAccountReference: 'acc-1' }));
    await bus.publish(gate('card.issuer.validation.completed', 'a', true));
    await bus.publish(gate('fds.scoring.completed', 'a', true));
    await bus.publish(gate('hrp.screening.completed', 'a', true));
    await flush();
    expect(h.completeAuthorized).toHaveBeenCalledOnce();
    expect(h.releaseCardHold).not.toHaveBeenCalled();
  });

  it('releases the hold when a later gate declines the journey', async () => {
    await bus.publish(start('b'));
    await bus.publish(gate('funds.check.completed', 'b', true, { held: 75, fundingPayoutAccountReference: 'acc-1' }));
    await bus.publish(gate('hrp.screening.completed', 'b', false, { reason: 'sanctions_match' })); // hard decline
    await flush();
    expect(h.declineTransaction).toHaveBeenCalledOnce();
    expect(h.releaseCardHold).toHaveBeenCalledWith({}, 'acc-1', 75);
  });

  it('releases the hold in the ordering race (decline BEFORE the hold lands)', async () => {
    await bus.publish(start('c'));
    await bus.publish(gate('hrp.screening.completed', 'c', false, { reason: 'sanctions_match' })); // decline first
    await bus.publish(gate('funds.check.completed', 'c', true, { held: 30, fundingPayoutAccountReference: 'acc-1' })); // late hold
    await flush();
    expect(h.releaseCardHold).toHaveBeenCalledWith({}, 'acc-1', 30);
  });

  it('does not release when the funds gate itself declines (no hold was made)', async () => {
    await bus.publish(start('d'));
    await bus.publish(gate('funds.check.completed', 'd', false, { responseCode: '51', reason: 'insufficient_funds' }));
    await flush();
    expect(h.declineTransaction).toHaveBeenCalledOnce();
    expect(h.releaseCardHold).not.toHaveBeenCalled();
  });
});

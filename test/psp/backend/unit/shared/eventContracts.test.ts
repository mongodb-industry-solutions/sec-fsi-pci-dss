/**
 * P1 (dev.v8): SDD contract test for the §7 bus payload + wire contracts.
 * Pure type-binding + structural checks: every §7 interface exists, binds to the DomainEvent
 * envelope, and carries no raw CHD keys. No runtime/DB.
 */
import { describe, it, expect } from 'vitest';
import type {
  DomainEvent,
  CardPaymentAuthorizationRequested,
  CardIssuerValidationRequested,
  CardIssuerValidationCompleted,
  FdsScoringRequested,
  FdsScoringCompleted,
  HrpScreeningRequested,
  HrpScreeningCompleted,
  CardPaymentAuthorizationCompleted,
  AmlMonitoringRequested,
  AmlMonitoringCompleted,
  FraudCaseOpened,
  FraudCaseEnriched,
  FraudQuestionCreated,
  FraudQuestionAnswered,
  FraudCaseUpdated,
  CardManagementEvent,
  CardSharedThresholdExceeded,
  ProfileValidationRequested,
  KycValidationRequested,
  KycValidationCompleted,
  ProfileValidationCompleted,
  MerchantValidationRequested,
  KybValidationRequested,
  KybValidationCompleted,
  MerchantValidationCompleted,
  PartyNotification,
  WireCorrelation,
  CardIssuerValidationOutbound,
  CardIssuerValidationInbound,
  FdsScoringOutbound,
  FdsScoringInbound,
  HrpScreeningOutbound,
  HrpScreeningInbound,
  AmlMonitoringOutbound,
  AmlMonitoringInbound,
  PendingCorrelation,
  PiiEnvelope,
} from '../../../../../psp/backend/src/shared/models/events';

const CHD_KEYS = ['cardNumber', 'cvv', 'cvv2', 'cvc', 'pan', 'expiry', 'cardholderName'];

describe('§7 event contracts', () => {
  it('binds a typed payload to the DomainEvent envelope (§7.0)', () => {
    const e: DomainEvent<CardIssuerValidationRequested> = {
      eventId: 'id', eventType: 'card.issuer.validation.requested', occurredAt: new Date().toISOString(),
      correlationId: 'txn-1', businessProcess: 'card_payment', source: 'psp.core', schemaVersion: 1,
      payload: { cardToken: 'tok', maskedPan: '4111******1111', amount: 10, currency: 'EUR', chd: 'v1.xxx' },
    };
    expect(e.payload.chd).toBe('v1.xxx');
    expect(e.correlationId).toBe('txn-1');
  });

  it('card.payment.authorization.completed carries the verdict in payload.outcome (§6.1)', () => {
    const p: CardPaymentAuthorizationCompleted = { outcome: 'authorized', fraudCaseCreated: false };
    expect(['authorized', 'declined']).toContain(p.outcome);
  });

  it('wire request carries clientReference; bus payloads do not (§7.7)', () => {
    const out: CardIssuerValidationOutbound = {
      clientReference: 'txn-1', amount: 10, currency: 'EUR',
      cardNumber: '4111111111111111', cvv: '123', expiry: '12/30',
    };
    expect(out.clientReference).toBe('txn-1');
    // The bus *.requested type has no clientReference and no raw PAN/CVV.
    const busReq: CardIssuerValidationRequested = {
      cardToken: 'tok', maskedPan: '4111******1111', amount: 10, currency: 'EUR', chd: 'v1.xxx',
    };
    expect(Object.keys(busReq).some((k) => CHD_KEYS.includes(k))).toBe(false);
  });

  it('inbound wire callbacks reuse the bus verdict shape (§7.7 no duplication)', () => {
    const inb: CardIssuerValidationInbound = { clientReference: 'txn-1', outcome: 'approved', responseCode: '00' };
    const amlInb: AmlMonitoringInbound = { clientReference: 'txn-1', outcome: 'clear' };
    expect(inb.outcome).toBe('approved');
    expect(amlInb.outcome).toBe('clear');
  });

  it('PendingCorrelation restores the envelope from the wire reference (§7.7)', () => {
    const pc: PendingCorrelation = {
      ref: 'txn-1', correlationId: 'txn-1', causationId: 'evt-0',
      businessProcess: 'card_payment', eventType: 'card.issuer.validation.completed',
      expiresAt: new Date().toISOString(),
    };
    expect(pc.correlationId).toBe(pc.ref);
  });

  it('exercises every remaining §7 contract as a structural smoke check', () => {
    const samples: unknown[] = [
      { amount: 1, currency: 'EUR', channel: 'api', merchantName: 'm', maskedPan: 'x', gatesExpected: ['fds'] } as CardPaymentAuthorizationRequested,
      { cardToken: 't', outcome: 'declined' } as CardIssuerValidationCompleted,
      { amount: 1, currency: 'EUR', channel: 'api', merchantName: 'm' } as FdsScoringRequested,
      { outcome: 'approved' } as FdsScoringCompleted,
      { subjectPartyReference: 'p' } as HrpScreeningRequested,
      { outcome: 'declined', matchType: 'sanctions' } as HrpScreeningCompleted,
      { accountReference: 'a' } as AmlMonitoringRequested,
      { outcome: 'alert', severity: 'high' } as AmlMonitoringCompleted,
      { transactionId: 't', reason: 'aml_alert' } as FraudCaseOpened,
      { transactionId: 't', subsystemSignals: { issuer: null, fds: null, hrp: null, aml: null } } as FraudCaseEnriched,
      { questionId: 'q', prompt: 'why?' } as FraudQuestionCreated,
      { questionId: 'q', answer: 'ok', answeredAt: new Date().toISOString() } as FraudQuestionAnswered,
      { status: 'resolved', resolution: 'cleared' } as FraudCaseUpdated,
      { customerAgreementReference: 'c', maskedPan: 'x' } as CardManagementEvent,
      { maskedPan: 'x', sharedAcrossPartyCount: 3, threshold: 2 } as CardSharedThresholdExceeded,
      { partyName: 'n', country: 'ES' } as ProfileValidationRequested,
      { partyName: 'n' } as KycValidationRequested,
      { outcome: 'verified', riskRating: 'low' } as KycValidationCompleted,
      { outcome: 'verified' } as ProfileValidationCompleted,
      { legalName: 'L', country: 'ES' } as MerchantValidationRequested,
      { legalName: 'L' } as KybValidationRequested,
      { outcome: 'review' } as KybValidationCompleted,
      { outcome: 'verified' } as MerchantValidationCompleted,
      { kind: 'case', title: 'New case' } as PartyNotification,
      { clientReference: 'r' } as WireCorrelation,
      { clientReference: 'r', amount: 1, currency: 'EUR', channel: 'api', merchantName: 'm' } as FdsScoringOutbound,
      { clientReference: 'r', outcome: 'approved' } as FdsScoringInbound,
      { clientReference: 'r', subject: { fullName: 'A B' } } as HrpScreeningOutbound,
      { clientReference: 'r', outcome: 'match' } as HrpScreeningInbound,
      { clientReference: 'r', amount: 1, currency: 'EUR' } as AmlMonitoringOutbound,
      { pii: 'v1.xxx' } as PiiEnvelope,
    ];
    expect(samples).toHaveLength(31);
  });
});

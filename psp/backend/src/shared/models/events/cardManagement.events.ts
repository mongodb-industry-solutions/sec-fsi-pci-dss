// Bus payload contracts for the `card_management` process (architecture §7.3).
// correlationId = cardToken (tokenized, never the PAN).

/**
 * @event    card.registered, card.accessed, card.updated, card.removed
 * @producer psp.core  @consumer Audit ledger, notifications, risk monitoring
 */
export interface CardManagementEvent {
  customerAgreementReference: string;
  maskedPan: string;
  cardNetwork?: string;
  performedByPartyReference?: string;
}

/**
 * @event    card.shared.threshold.exceeded
 * @producer psp.core  @consumer Risk monitoring, case view
 */
export interface CardSharedThresholdExceeded {
  maskedPan: string;
  sharedAcrossPartyCount: number;
  threshold: number;
}

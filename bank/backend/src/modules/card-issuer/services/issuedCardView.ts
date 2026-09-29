import {
  IssuedCardRegistryRecord, IssuedCardKind, IssuedCardLimits, IssuedCardStatus,
} from '../models/cardIssuerVault.model';

// What a card looks like when it leaves this bank, defined ONCE.
//
// There were two of these: the lifecycle service had its own view for what it returned after issuing or
// changing a card, and the administration search had another for what it put in a list. They disagreed, and the
// disagreement was invisible until a screen showed a card with no owner and no funding account after a status
// change, because the second shape simply had no such fields. The same class of bug had already emptied every
// cell of a card list once.
//
// So there is one shape and one mapper, and every path answers in it: the list, the single read, the issue, the
// status change, the renewal, the replacement, the limit change. A caller cannot tell which endpoint produced a
// card, which is the property that makes the screens simple.
//
// It carries NO card number, by construction rather than by omission. The number lives encrypted in the vault
// and is read as a disclosure, one card at a time.

export interface IssuedCardView {
  cardToken: string;
  network: string;
  /** Debit for every card this bank issues today. Defaulted on read so an older record is not a blank cell. */
  kind: IssuedCardKind;
  bin: string;
  lastFour: string;
  maskedDisplay: string;
  status: IssuedCardStatus;
  expiryMonth?: string;
  expiryYear?: string;
  limits?: IssuedCardLimits;
  /** The party the card belongs to, and the account it draws on. A debit card always has both. */
  holderReference?: string;
  fundingAccountReference?: string;
}

export function toIssuedCardView(record: IssuedCardRegistryRecord): IssuedCardView {
  return {
    cardToken: record.paymentCardReference,
    network: record.paymentCardNetwork,
    kind: record.paymentCardKind ?? 'debit',
    bin: record.paymentCardBin,
    lastFour: record.paymentCardLastFour,
    maskedDisplay: record.paymentCardMaskedDisplay,
    status: record.issuedCardStatus,
    expiryMonth: record.paymentCardExpiryMonth,
    expiryYear: record.paymentCardExpiryYear,
    limits: record.issuedCardLimits,
    holderReference: record.accountHolderInstanceReference,
    fundingAccountReference: record.accountArrangementInstanceReference,
  };
}

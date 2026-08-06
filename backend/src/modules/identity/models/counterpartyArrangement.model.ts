// BIAN SD-54: Counterparty Administration, beneficiary registry
// Each entry is a saved contact (beneficiary) in a user's personal list.
// counterpartyArrangementReference is the opaque "beneficiary token" shared with merchants.
// Raw phone/email is NEVER stored here, only the resolved partyInstanceReference and a masked hint.

import { config } from '../../../config';

export const COUNTERPARTY_COLLECTION = 'counterpartyArrangement';

// Business rule enforced at service level (422 if exceeded).
// Override via PSP_BENEFICIARY_MAX_PER_USER.
export const COUNTERPARTY_MAX_PER_USER = config.payout.beneficiaryMaxPerUser;

export type CounterpartyArrangementStatus = 'active' | 'removed';

export type CounterpartyLookupType = 'phone' | 'email';

export interface CounterpartyArrangement {
  counterpartyArrangementReference: string;  // UUID v4, the opaque beneficiary token
  ownerPartyReference: string;               // FK → party: who owns this contact entry
  counterpartyPartyReference: string;        // FK → party: the resolved beneficiary (PSP internal)

  // Display: privacy-first
  counterpartyLabel: string;                 // owner-defined label or masked hint if blank at creation
  counterpartyLookupType: CounterpartyLookupType;
  counterpartyLookupHint: string;            // masked at store time: "+34 6** *** 789" or "j***@example.com"
                                             // NEVER stores raw phone/email.
  // Masked by maskLookupValue before it is written: the plaintext is never persisted, so no role
  // can recover it and there is no reveal endpoint for it (GDPR Art. 5(1)(c), Art. 25(2)).

  counterpartyArrangementStatus: CounterpartyArrangementStatus;

  bianServiceDomain: 'Counterparty Administration';
  bianControlRecordType: 'CounterpartyArrangement';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

/**
 * Mask a phone number or email for display storage.
 * phone: "+34612345678"  → "+34 6** *** 678"
 * email: "john@example.com" → "j***@example.com"
 */
export function maskLookupValue(type: CounterpartyLookupType, raw: string): string {
  if (type === 'email') {
    const [local, domain] = raw.split('@');
    if (!domain) return '***';
    return `${local.charAt(0)}***@${domain}`;
  }
  // phone: keep first 3 chars + last 3 chars
  const digits = raw.replace(/\D/g, '');
  const prefix = raw.slice(0, raw.length - digits.length + 3); // country code area
  const last3 = digits.slice(-3);
  return `${prefix} *** ${last3}`;
}

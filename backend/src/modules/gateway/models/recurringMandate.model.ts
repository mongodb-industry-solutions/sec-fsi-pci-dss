// v17.1 Recurring payment mandate (ACH Direct Debit / SEPA SDD).
// A stored authorization to run a bank transfer on a schedule. Each due run reuses the
// shared bank-transfer flow (rail engine + provider dispatch), so no logic is duplicated.
// PCI DSS: destination banking coordinates are stored for the mandate the same way as a
// registered account (IBAN/routing QE-encrypted at rest); BIC is plaintext.

import type { RailDestination, RecurringScheme } from '../../../shared/services/bankTransfer';

export const RECURRING_MANDATE_COLLECTION = 'recurringMandateProcedure';

export type MandateFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type MandateStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export interface RecurringMandateProcedure {
  recurringMandateInstanceReference: string;   // UUID, PK
  mandateReference: string;                     // human/scheme mandate id (ISO 20022 MndtId)
  scheme: RecurringScheme;                      // ach_direct_debit | sepa_sdd
  ownerPartyReference: string;                  // the party who authorized the mandate

  amount: number;
  currency: string;
  destination: RailDestination;                 // banking coordinates (IBAN/routing QE at rest in prod)
  reference?: string;                           // remittance info

  frequency: MandateFrequency;
  mandateStatus: MandateStatus;
  nextRunAt: Date;                              // when the next collection is due
  lastRunAt?: Date;
  runCount: number;
  maxRuns?: number;                             // optional cap; when reached -> completed

  bianServiceDomain: 'Payment Initiation';
  bianControlRecordType: 'RecurringMandateProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

/** Advance a date by one frequency period. Pure helper (reused by create + run).
 *  Uses UTC setters so scheduling is deterministic and TZ/DST-independent. */
export function nextRunDate(from: Date, frequency: MandateFrequency): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'weekly':    d.setUTCDate(d.getUTCDate() + 7); break;
    case 'monthly':   d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'yearly':    d.setUTCFullYear(d.getUTCFullYear() + 1); break;
  }
  return d;
}

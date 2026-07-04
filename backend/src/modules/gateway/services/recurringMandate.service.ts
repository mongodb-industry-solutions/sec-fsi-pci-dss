// v17.1 BIAN SD-66: Recurring mandate service (ACH Direct Debit / SEPA SDD).
// Create/list/cancel mandates and run the ones that are due. Each due run reuses
// executeBankTransfer (rail engine + provider dispatch + risk gate), so no duplication.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  RECURRING_MANDATE_COLLECTION, RecurringMandateProcedure, MandateFrequency, nextRunDate,
} from '../models/recurringMandate.model';
import { railResolver, type RailDestination, type RecurringScheme } from '../../../shared/services/bankTransfer';
import { executeBankTransfer } from './bankTransfer.service';
import { emitProcessEvent } from '../../provider/services/businessProcessEvent.service';

export interface CreateMandateInput {
  ownerPartyReference: string;
  scheme: RecurringScheme;
  amount: number;
  currency: string;
  destination: RailDestination;
  frequency: MandateFrequency;
  reference?: string;
  firstRunAt?: Date;
  maxRuns?: number;
}

export async function createMandate(db: Db, input: CreateMandateInput): Promise<RecurringMandateProcedure> {
  // Validate the destination against the derived rail before storing the mandate.
  const rail = railResolver.resolve(input.destination);
  const validation = railResolver.validate(rail, input.destination);
  if (!validation.ok) {
    throw Object.assign(new Error(`Invalid mandate destination: ${validation.errors.join('; ')}`), { code: 400 });
  }

  const now = new Date();
  const mandate: RecurringMandateProcedure = {
    recurringMandateInstanceReference: uuidv4(),
    mandateReference: `MNDT-${uuidv4().slice(0, 8).toUpperCase()}`,
    scheme: input.scheme,
    ownerPartyReference: input.ownerPartyReference,
    amount: input.amount,
    currency: input.currency,
    destination: input.destination,
    reference: input.reference,
    frequency: input.frequency,
    mandateStatus: 'active',
    nextRunAt: input.firstRunAt ?? now,
    runCount: 0,
    maxRuns: input.maxRuns,
    bianServiceDomain: 'Payment Initiation',
    bianControlRecordType: 'RecurringMandateProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };
  await db.collection<RecurringMandateProcedure>(RECURRING_MANDATE_COLLECTION).insertOne(mandate);

  emitProcessEvent(db, {
    entityType: 'execution', entityId: mandate.recurringMandateInstanceReference,
    processType: 'payment_processing', processAction: 'mandate.created', processOutcome: 'approved',
    performedByPartyReference: input.ownerPartyReference, performedByRole: 'customer',
    eventSummary: { scheme: input.scheme, rail, amount: input.amount, currency: input.currency, frequency: input.frequency },
    bianServiceDomain: 'Payment Initiation', bianControlRecordType: 'RecurringMandateProcedure',
  });
  return mandate;
}

export async function listMandates(db: Db, ownerPartyReference: string): Promise<RecurringMandateProcedure[]> {
  return db.collection<RecurringMandateProcedure>(RECURRING_MANDATE_COLLECTION)
    .find({ ownerPartyReference }, { projection: { _id: 0 } })
    .sort({ recordCreatedDateTime: -1 })
    .toArray();
}

export async function cancelMandate(db: Db, ref: string, ownerPartyReference: string): Promise<boolean> {
  const res = await db.collection<RecurringMandateProcedure>(RECURRING_MANDATE_COLLECTION).updateOne(
    { recurringMandateInstanceReference: ref, ownerPartyReference, mandateStatus: { $in: ['active', 'paused'] } },
    { $set: { mandateStatus: 'cancelled', recordUpdatedDateTime: new Date() } },
  );
  return res.modifiedCount === 1;
}

export interface RunDueResult { processed: number; submitted: number; failed: number }

/**
 * Run all mandates whose nextRunAt is due. Each collection reuses executeBankTransfer (rail engine +
 * provider dispatch + risk gate). Advances nextRunAt and marks the mandate completed at maxRuns.
 * Intended to be invoked by a scheduler (cron/worker) or the admin endpoint. Idempotent per due window.
 */
export async function runDueMandates(db: Db, now: Date = new Date()): Promise<RunDueResult> {
  const col = db.collection<RecurringMandateProcedure>(RECURRING_MANDATE_COLLECTION);
  const due = await col.find({ mandateStatus: 'active', nextRunAt: { $lte: now } }).toArray();

  let submitted = 0, failed = 0;
  for (const m of due) {
    const result = await executeBankTransfer(db, {
      initiatorPartyRef: m.ownerPartyReference,
      amount: m.amount,
      currency: m.currency,
      destination: m.destination,
      reference: m.reference ?? `Recurring ${m.scheme} ${m.mandateReference}`,
      recurring: { scheme: m.scheme, mandateRef: m.mandateReference, frequency: m.frequency },
      settlementSchedule: 'T+1',
    });
    if (result.status === 'submitted') submitted++; else failed++;

    const runCount = m.runCount + 1;
    const reachedCap = m.maxRuns !== undefined && runCount >= m.maxRuns;
    await col.updateOne(
      { recurringMandateInstanceReference: m.recurringMandateInstanceReference },
      {
        $set: {
          lastRunAt: now,
          nextRunAt: nextRunDate(m.nextRunAt, m.frequency),
          runCount,
          mandateStatus: reachedCap ? 'completed' : 'active',
          recordUpdatedDateTime: now,
        },
      },
    );

    emitProcessEvent(db, {
      entityType: 'execution', entityId: m.recurringMandateInstanceReference,
      processType: 'payment_processing', processAction: 'mandate.run', processOutcome: result.status === 'submitted' ? 'approved' : 'rejected',
      performedByPartyReference: m.ownerPartyReference, performedByRole: 'customer',
      eventSummary: { mandateRef: m.mandateReference, executionRef: result.executionReference, status: result.status, runCount },
      bianServiceDomain: 'Payment Initiation', bianControlRecordType: 'RecurringMandateProcedure',
    });
  }
  return { processed: due.length, submitted, failed };
}

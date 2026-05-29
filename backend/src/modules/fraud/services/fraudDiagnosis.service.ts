import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  FRAUD_DIAGNOSIS_COLLECTION,
  FRAUD_DIAGNOSIS_EVENTS_COLLECTION,
  FraudDiagnosisControlRecord,
  FraudDiagnosisCaseEventRecord,
} from '../models/fraudDiagnosis.model';
import { RiskSeverity } from '../../../shared/models/risk.model';
import { TransactionSnapshot } from '../../../shared/models/transaction.model';

let caseCounter = 1000;

function nextCaseRef(): string {
  return `FD-2026-${String(++caseCounter).padStart(6, '0')}`;
}

export async function createFraudCase(
  db: Db,
  txnId: string,
  customerRef: string,
  riskIndicators: string[],
  severity: RiskSeverity,
  transactionSnapshot: TransactionSnapshot
) {
  const caseId = uuidv4();
  const now = new Date();

  const fraudCase: Omit<FraudDiagnosisControlRecord, never> = {
    fraudDiagnosisInstanceReference: caseId,
    fraudDiagnosisCaseReference: nextCaseRef(),
    linkedCardTransactionReference: txnId,
    linkedCustomerAgreementReference: customerRef,
    transactionSnapshot,
    fraudDiagnosisCaseStatus: 'open',
    fraudDiagnosisCaseSeverity: severity,
    fraudDiagnosisRequestDateTime: now,
    fraudDiagnosisAssessment: {
      riskIndicators,
      fraudDiagnosisScore: Math.min(100, riskIndicators.length * 40),
    },
    bianServiceDomain: 'FraudDiagnosis',
    bianControlRecordType: 'FraudDiagnosis',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  const openEvent: FraudDiagnosisCaseEventRecord = {
    fraudDiagnosisInstanceReference: caseId,
    actionDateTime: now,
    actionType: 'case_opened',
    performedByInstanceReference: 'system',
    performedByRole: 'payment_service',
    actionDetails: { trigger: riskIndicators[0] ?? 'manual' },
    schemaVersion: 1,
  };

  await db.collection(FRAUD_DIAGNOSIS_COLLECTION).insertOne(fraudCase as object);
  await db.collection(FRAUD_DIAGNOSIS_EVENTS_COLLECTION).insertOne(openEvent as object);

  return { fraudDiagnosisInstanceReference: caseId };
}

export async function getCases(
  db: Db,
  filters: { status?: string; severity?: string },
  page: number,
  limit: number
) {
  const query: Record<string, unknown> = {};
  if (filters.status) query['fraudDiagnosisCaseStatus'] = filters.status;
  if (filters.severity) query['fraudDiagnosisCaseSeverity'] = filters.severity;

  const skip = (page - 1) * limit;
  const [results, total] = await Promise.all([
    db.collection<FraudDiagnosisControlRecord>(FRAUD_DIAGNOSIS_COLLECTION)
      .find(query)
      .sort({ fraudDiagnosisRequestDateTime: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection(FRAUD_DIAGNOSIS_COLLECTION).countDocuments(query),
  ]);

  return { results, total, page, limit };
}

export async function getCaseById(db: Db, id: string) {
  return db.collection<FraudDiagnosisControlRecord>(FRAUD_DIAGNOSIS_COLLECTION)
    .findOne({ fraudDiagnosisInstanceReference: id });
}

export async function updateCase(
  db: Db,
  id: string,
  patch: {
    fraudDiagnosisCaseStatus?: FraudDiagnosisControlRecord['fraudDiagnosisCaseStatus'];
    caseNotes?: string;
    fraudDiagnosisAnalystInstanceReference?: string;
  }
) {
  const now = new Date();
  const result = await db.collection(FRAUD_DIAGNOSIS_COLLECTION).findOneAndUpdate(
    { fraudDiagnosisInstanceReference: id },
    { $set: { ...patch, recordUpdatedDateTime: now } },
    { returnDocument: 'after' }
  );
  return result ?? null;
}

export async function getCaseEvents(db: Db, caseId: string) {
  const events = await db.collection<FraudDiagnosisCaseEventRecord>(FRAUD_DIAGNOSIS_EVENTS_COLLECTION)
    .find({ fraudDiagnosisInstanceReference: caseId })
    .sort({ actionDateTime: 1 })
    .toArray();
  return { caseId, events };
}

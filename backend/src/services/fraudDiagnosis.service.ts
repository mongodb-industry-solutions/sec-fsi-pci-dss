import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  FRAUD_DIAGNOSIS_COLLECTION,
  FraudDiagnosisControlRecord,
  RiskSeverity,
} from '../models';

let caseCounter = 1000;

function nextCaseRef(): string {
  return `FD-2026-${String(++caseCounter).padStart(6, '0')}`;
}

export async function createFraudCase(
  db: Db,
  txnId: string,
  customerRef: string,
  riskIndicators: string[],
  severity: RiskSeverity
) {
  const caseId = uuidv4();
  const now = new Date();

  const fraudCase: Omit<FraudDiagnosisControlRecord, never> = {
    fraudDiagnosisInstanceReference: caseId,
    fraudDiagnosisCaseReference: nextCaseRef(),
    linkedCardTransactionReference: txnId,
    linkedCustomerAgreementReference: customerRef,
    fraudDiagnosisCaseStatus: 'open',
    fraudDiagnosisCaseSeverity: severity,
    fraudDiagnosisRequestDateTime: now,
    fraudDiagnosisAssessment: {
      riskIndicators,
      fraudDiagnosisScore: Math.min(100, riskIndicators.length * 40),
    },
    diagnosisActionLog: [
      {
        actionDateTime: now,
        actionType: 'case_opened',
        performedByInstanceReference: 'system',
        performedByRole: 'payment_service',
        actionDetails: { trigger: riskIndicators[0] ?? 'manual' },
      },
    ],
    bianServiceDomain: 'FraudDiagnosis',
    bianControlRecordType: 'FraudDiagnosis',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
  };

  await db.collection(FRAUD_DIAGNOSIS_COLLECTION).insertOne(fraudCase as object);
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

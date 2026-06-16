import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { CUSTOMER_QUESTION_COLLECTION, CustomerQuestionRecord } from '../../modules/fraud/models/customerQuestion.model';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../modules/fraud/models/fraudDiagnosis.model';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../modules/customer/models/customerAgreement.model';

// ADR-031: seed one demo customer question on an open case so the flow is visible out of the box.
// Defensive: skips if questions already exist or no open case is available.
export async function seedCustomerQuestions(db: Db) {
  const col = db.collection<CustomerQuestionRecord>(CUSTOMER_QUESTION_COLLECTION);
  if (await col.countDocuments() > 0) { console.log('  customerQuestions: skip (already present)'); return; }

  const fraudCase = await db.collection(FRAUD_DIAGNOSIS_COLLECTION).findOne<{
    fraudDiagnosisInstanceReference: string;
    fraudDiagnosisCaseReference: string;
    cardTransactionInstanceReference: string;
    customerAgreementInstanceReference: string;
  }>(
    { fraudDiagnosisCaseStatus: { $in: ['open', 'under_review', 'escalated'] } },
    { sort: { recordCreatedDateTime: -1 } },
  );
  if (!fraudCase) { console.log('  customerQuestions: skip (no open case)'); return; }

  const agreement = await db.collection(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne<{ partyInstanceReference?: string }>({ customerAgreementInstanceReference: fraudCase.customerAgreementInstanceReference });

  const now = new Date();
  await col.insertOne({
    customerQuestionInstanceReference: uuidv4(),
    fraudDiagnosisInstanceReference: fraudCase.fraudDiagnosisInstanceReference,
    fraudDiagnosisCaseReference: fraudCase.fraudDiagnosisCaseReference,
    cardTransactionInstanceReference: fraudCase.cardTransactionInstanceReference,
    customerAgreementInstanceReference: fraudCase.customerAgreementInstanceReference,
    partyInstanceReference: agreement?.partyInstanceReference ?? '',
    questionText: 'Did you perform this operation?',
    questionOptions: ['Yes', 'No'],
    allowOther: true,
    questionStatus: 'pending',
    askedByInstanceReference: 'seed',
    askedByName: 'Security Team',
    askedByRole: 'level1_analyst',
    askedDateTime: now,
    bianServiceDomain: 'Fraud Diagnosis',
    bianControlRecordType: 'FraudDiagnosisCase',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  });
  console.log('  customerQuestions: 1 demo question seeded');
}

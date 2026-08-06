import { Db } from 'mongodb';
import { createNotification } from '../../modules/notification/notifications.service';
import { CUSTOMER_QUESTION_COLLECTION, CustomerQuestionRecord } from '../../modules/fraud/models/customerQuestion.model';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../modules/fraud/models/fraudDiagnosis.model';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../modules/customer/models/customerAgreement.model';

// ADR-031: notifications are a DERIVED read-model, there is no static dataset to load. This seeder
// materializes notifications from the authoritative records so the bell/page are populated out of the
// box. `createNotification` de-dupes by (party, type, relatedReference), so this is idempotent and
// safe to re-run. No CHD is written (PCI DSS Req 3); each notification is scoped to a recipient party.
export async function seedNotifications(db: Db) {
  let seeded = 0;

  // Pending customer questions -> actionable notifications.
  const pending = await db.collection<CustomerQuestionRecord>(CUSTOMER_QUESTION_COLLECTION)
    .find({ questionStatus: 'pending' }).toArray();
  for (const q of pending) {
    await createNotification(db, {
      recipientPartyReference: q.partyInstanceReference,
      notificationType: 'fraud_question',
      title: 'A security question needs your response',
      detail: q.questionText,
      href: `/system/payment/history/${q.cardTransactionInstanceReference}`,
      relatedReference: q.customerQuestionInstanceReference,
      transactionId: q.cardTransactionInstanceReference,
      caseReference: q.fraudDiagnosisCaseReference,
      actionable: true,
    });
    seeded++;
  }

  // Resolved cases -> informational transaction-status notifications.
  const resolved = await db.collection(FRAUD_DIAGNOSIS_COLLECTION).find<{
    fraudDiagnosisInstanceReference: string;
    fraudDiagnosisCaseReference: string;
    cardTransactionInstanceReference: string;
    customerAgreementInstanceReference: string;
    fraudDiagnosisCaseStatus: string;
  }>({ fraudDiagnosisCaseStatus: { $in: ['resolved_cleared', 'resolved_fraud'] } }).toArray();
  for (const c of resolved) {
    const agreement = await db.collection(CUSTOMER_AGREEMENT_COLLECTION)
      .findOne<{ partyInstanceReference?: string }>({ customerAgreementInstanceReference: c.customerAgreementInstanceReference });
    const cleared = c.fraudDiagnosisCaseStatus === 'resolved_cleared';
    await createNotification(db, {
      recipientPartyReference: agreement?.partyInstanceReference ?? '',
      notificationType: 'transaction_status',
      title: cleared ? 'A transaction review was completed' : 'A transaction was confirmed as fraud',
      detail: cleared
        ? 'Your transaction was reviewed and confirmed as legitimate. No action is needed.'
        : 'An unauthorized transaction was confirmed. A refund has been initiated and your card secured.',
      href: `/system/payment/history/${c.cardTransactionInstanceReference}`,
      relatedReference: `status-${c.fraudDiagnosisInstanceReference}`,
      transactionId: c.cardTransactionInstanceReference,
      caseReference: c.fraudDiagnosisCaseReference,
      actionable: false,
    });
    seeded++;
  }

  console.log(`  notifications: ${seeded} materialized from questions + resolved cases`);
}

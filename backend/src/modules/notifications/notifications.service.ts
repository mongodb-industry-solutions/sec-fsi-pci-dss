import { Db } from 'mongodb';
import { listPendingForParty } from '../fraud/services/customerQuestion.service';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../customer/models/customerAgreement.model';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../fraud/models/fraudDiagnosis.model';

export type NotificationType = 'fraud_question' | 'transaction_status';

export interface NotificationItem {
  type: NotificationType;
  id: string;
  transactionId: string;
  caseReference: string;
  title: string;
  detail: string;
  href: string;
  createdAt: string;
  actionable: boolean; // true = needs the customer to act (drives the unread badge count)
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date().toISOString();
}

// Derived notifications for a customer (by party). No stored notification collection: the feed is
// computed from authoritative records (pending questions + resolved cases), so it cannot drift and
// carries no CHD (PCI DSS Req 3/7). Scoped strictly to the caller's own party (Req 7).
export async function getNotificationsForParty(db: Db, partyRef: string): Promise<NotificationItem[]> {
  if (!partyRef) return [];
  const items: NotificationItem[] = [];

  // 1) Pending security questions; actionable.
  const pending = await listPendingForParty(db, partyRef);
  for (const q of pending) {
    items.push({
      type: 'fraud_question',
      id: q.questionId,
      transactionId: q.transactionId,
      caseReference: q.caseReference,
      title: 'A security question needs your response',
      detail: q.questionText,
      href: `/system/payment/history/${q.transactionId}`,
      createdAt: q.askedDateTime,
      actionable: true,
    });
  }

  // 2) Resolved-case status updates; informational; link to the related transaction.
  const agreements = await db.collection(CUSTOMER_AGREEMENT_COLLECTION)
    .find<{ customerAgreementInstanceReference: string }>({ partyInstanceReference: partyRef })
    .toArray();
  const agreementRefs = agreements.map((a) => a.customerAgreementInstanceReference).filter(Boolean);
  if (agreementRefs.length) {
    const cases = await db.collection(FRAUD_DIAGNOSIS_COLLECTION)
      .find<{
        fraudDiagnosisInstanceReference: string;
        fraudDiagnosisCaseReference: string;
        cardTransactionInstanceReference: string;
        fraudDiagnosisCaseStatus: string;
        fraudDiagnosisResolutionRecord?: { resolutionOutcome?: string; resolutionDateTime?: unknown };
        recordUpdatedDateTime?: unknown;
        recordCreatedDateTime?: unknown;
      }>({
        customerAgreementInstanceReference: { $in: agreementRefs },
        fraudDiagnosisCaseStatus: { $in: ['resolved_cleared', 'resolved_fraud'] },
      })
      .toArray();
    for (const c of cases) {
      const cleared = c.fraudDiagnosisCaseStatus === 'resolved_cleared'
        || c.fraudDiagnosisResolutionRecord?.resolutionOutcome === 'cleared';
      items.push({
        type: 'transaction_status',
        id: `status-${c.fraudDiagnosisInstanceReference}`,
        transactionId: c.cardTransactionInstanceReference,
        caseReference: c.fraudDiagnosisCaseReference,
        title: cleared ? 'A transaction review was completed' : 'A transaction was confirmed as fraud',
        detail: cleared
          ? 'Your transaction was reviewed and confirmed as legitimate. No action is needed.'
          : 'An unauthorized transaction was confirmed. A refund has been initiated and your card secured.',
        href: `/system/payment/history/${c.cardTransactionInstanceReference}`,
        createdAt: toIso(c.fraudDiagnosisResolutionRecord?.resolutionDateTime ?? c.recordUpdatedDateTime ?? c.recordCreatedDateTime),
        actionable: false,
      });
    }
  }

  // Newest first.
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items;
}

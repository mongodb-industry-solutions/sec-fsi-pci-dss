// Persisted notifications (ADR-031). A record per delivered notification so we can track read/unread
// state and show history (read + unread) on the notifications page. No CHD/PII is stored here, only a
// short title/detail and opaque references (PCI DSS Req 3); scoped to a recipient party (Req 7).
export const NOTIFICATION_COLLECTION = 'notification';

// The type doubles as the UI category (Question / Message / Transaction / KYC / KYB / Response).
export type NotificationType =
  | 'fraud_question'      // customer: an investigator asked a question (actionable)
  | 'security_message'    // customer: a customer-visible note from the security team
  | 'transaction_status'  // customer: a transaction/case status change (flagged, escalated, resolved)
  | 'kyc_status'          // customer: KYC verification approved
  | 'kyb_status'          // merchant owner: KYB verification approved
  | 'question_response';  // staff: the customer answered the analyst's question
export type NotificationStatus = 'unread' | 'read';

export interface NotificationRecord {
  notificationInstanceReference: string;     // PK, UUID
  recipientPartyReference: string;           // FK → party (SD-13); the customer it is for
  notificationType: NotificationType;
  title: string;
  detail: string;
  href: string;
  relatedReference?: string;                 // questionId or caseId this notification is about
  transactionId?: string;
  caseReference?: string;
  actionable: boolean;                       // true = needs the customer to act (drives unread weight)
  notificationStatus: NotificationStatus;
  readDateTime?: Date;
  bianServiceDomain: string;
  bianControlRecordType: string;
  recordCreatedDateTime: Date;
  schemaVersion: number;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  detail: string;
  href: string;
  transactionId: string | null;
  caseReference: string | null;
  status: NotificationStatus;
  actionable: boolean;
  createdAt: string;
  readAt: string | null;
}

export function toNotificationDTO(n: NotificationRecord): NotificationDTO {
  return {
    id: n.notificationInstanceReference,
    type: n.notificationType,
    title: n.title,
    detail: n.detail,
    href: n.href,
    transactionId: n.transactionId ?? null,
    caseReference: n.caseReference ?? null,
    status: n.notificationStatus,
    actionable: n.actionable,
    createdAt: n.recordCreatedDateTime instanceof Date ? n.recordCreatedDateTime.toISOString() : String(n.recordCreatedDateTime),
    readAt: n.readDateTime ? (n.readDateTime instanceof Date ? n.readDateTime.toISOString() : String(n.readDateTime)) : null,
  };
}

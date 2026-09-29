import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  NOTIFICATION_COLLECTION, NotificationRecord, NotificationDTO, NotificationType, toNotificationDTO,
} from './notification.model';
import { publishPartyNotification } from '../../vendors/eventbus';

const col = (db: Db) => db.collection<NotificationRecord>(NOTIFICATION_COLLECTION);

export interface CreateNotificationInput {
  recipientPartyReference: string;
  notificationType: NotificationType;
  title: string;
  detail: string;
  href: string;
  relatedReference?: string;
  transactionId?: string;
  caseReference?: string;
  actionable?: boolean;
}

// Create a notification (no-op without a recipient). Fires the per-party SSE signal so the bell
// updates live. De-dupes by (party, type, relatedReference) so re-runs / retries don't pile up.
export async function createNotification(db: Db, input: CreateNotificationInput): Promise<void> {
  if (!input.recipientPartyReference) return;
  if (input.relatedReference) {
    const existing = await col(db).findOne({
      recipientPartyReference: input.recipientPartyReference,
      notificationType: input.notificationType,
      relatedReference: input.relatedReference,
    });
    if (existing) return;
  }
  const record: NotificationRecord = {
    notificationInstanceReference: uuidv4(),
    recipientPartyReference: input.recipientPartyReference,
    notificationType: input.notificationType,
    title: input.title,
    detail: input.detail,
    href: input.href,
    relatedReference: input.relatedReference,
    transactionId: input.transactionId,
    caseReference: input.caseReference,
    actionable: input.actionable ?? false,
    notificationStatus: 'unread',
    // Auxiliary alert read-model (not a core control record): BIAN Customer Case Management.
    bianServiceDomain: 'Customer Case Management',
    bianControlRecordType: 'CustomerNotification',
    recordCreatedDateTime: new Date(),
    schemaVersion: 1,
  };
  await col(db).insertOne(record);
  publishPartyNotification(input.recipientPartyReference);
}

export async function listForParty(db: Db, partyRef: string): Promise<NotificationDTO[]> {
  if (!partyRef) return [];
  const rows = await col(db).find({ recipientPartyReference: partyRef }).sort({ recordCreatedDateTime: -1 }).limit(200).toArray();
  return rows.map(toNotificationDTO);
}

export async function unreadCount(db: Db, partyRef: string): Promise<number> {
  if (!partyRef) return 0;
  return col(db).countDocuments({ recipientPartyReference: partyRef, notificationStatus: 'unread' });
}

// Mark one notification read (ownership-scoped by party, PCI DSS). Returns false if not found.
export async function markRead(db: Db, id: string, partyRef: string): Promise<boolean> {
  const res = await col(db).updateOne(
    { notificationInstanceReference: id, recipientPartyReference: partyRef, notificationStatus: 'unread' },
    { $set: { notificationStatus: 'read', readDateTime: new Date() } },
  );
  if (res.matchedCount > 0) publishPartyNotification(partyRef);
  // matchedCount 0 may mean already-read (idempotent) or not owned; report success if it exists for the party.
  return res.matchedCount > 0 || !!(await col(db).findOne({ notificationInstanceReference: id, recipientPartyReference: partyRef }));
}

export async function markAllRead(db: Db, partyRef: string): Promise<number> {
  if (!partyRef) return 0;
  const res = await col(db).updateMany(
    { recipientPartyReference: partyRef, notificationStatus: 'unread' },
    { $set: { notificationStatus: 'read', readDateTime: new Date() } },
  );
  if (res.modifiedCount > 0) publishPartyNotification(partyRef);
  return res.modifiedCount;
}

// Mark the notification tied to a related entity read (e.g. when the customer answers the question).
export async function markReadByRelated(db: Db, partyRef: string | undefined, relatedReference: string): Promise<void> {
  if (!partyRef) return;
  const res = await col(db).updateMany(
    { recipientPartyReference: partyRef, relatedReference, notificationStatus: 'unread' },
    { $set: { notificationStatus: 'read', readDateTime: new Date() } },
  );
  if (res.modifiedCount > 0) publishPartyNotification(partyRef);
}

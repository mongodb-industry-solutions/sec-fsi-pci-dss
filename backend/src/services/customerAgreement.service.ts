import { Db } from 'mongodb';
import {
  CUSTOMER_AGREEMENT_COLLECTION,
  CustomerAgreementControlRecord,
} from '../models';

function stripQEFields(agreement: CustomerAgreementControlRecord) {
  // Encrypted fields are used only as search predicates; never echoed back
  const { customerEmailAddress, customerMobilePhoneNumber, customerAgreementReference, ...safe } = agreement;
  void customerEmailAddress;
  void customerMobilePhoneNumber;
  void customerAgreementReference;
  return safe;
}

export async function getByEmail(db: Db, email: string) {
  const doc = await db.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerEmailAddress: email } as Partial<CustomerAgreementControlRecord>);
  if (!doc) return null;
  return stripQEFields(doc);
}

export async function getByPhone(db: Db, phone: string) {
  const doc = await db.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerMobilePhoneNumber: phone } as Partial<CustomerAgreementControlRecord>);
  if (!doc) return null;
  return stripQEFields(doc);
}

export async function getByAccountRef(db: Db, ref: string) {
  const doc = await db.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementReference: ref } as Partial<CustomerAgreementControlRecord>);
  if (!doc) return null;
  return stripQEFields(doc);
}

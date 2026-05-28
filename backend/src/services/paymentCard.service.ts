import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  PAYMENT_CARD_COLLECTION,
  PaymentCardManagementControlRecord,
} from '../models';

export interface CreateCardInput {
  customerAgreementInstanceReference: string;
  cardToken: string;
  paymentCardExpirationDate: string;
  paymentCardMaskedPanDisplay: string;
  paymentCardNetwork: PaymentCardManagementControlRecord['paymentCardNetwork'];
  paymentCardIsPreferred: boolean;
}

export async function createCard(db: Db, input: CreateCardInput) {
  const cardId = uuidv4();
  const now = new Date();

  const card: Omit<PaymentCardManagementControlRecord, never> = {
    paymentCardInstanceReference: cardId,
    customerAgreementInstanceReference: input.customerAgreementInstanceReference,
    paymentCardReference: input.cardToken,
    paymentCardExpirationDate: input.paymentCardExpirationDate,
    paymentCardMaskedPanDisplay: input.paymentCardMaskedPanDisplay,
    paymentCardNetwork: input.paymentCardNetwork,
    paymentCardStatus: 'active',
    paymentCardIssuanceDateTime: now,
    paymentCardIsPreferred: input.paymentCardIsPreferred,
    bianServiceDomain: 'PaymentCard',
    bianControlRecordType: 'PaymentCardManagement',
    recordCreatedDateTime: now,
  };

  await db.collection(PAYMENT_CARD_COLLECTION).insertOne(card as object);

  return {
    paymentCardInstanceReference: cardId,
    paymentCardStatus: 'active',
  };
}

export async function getCardsByCustomer(db: Db, customerRef: string) {
  const results = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION)
    .find({ customerAgreementInstanceReference: customerRef })
    .project({
      paymentCardInstanceReference: 1,
      paymentCardMaskedPanDisplay: 1,
      paymentCardNetwork: 1,
      paymentCardStatus: 1,
      paymentCardIsPreferred: 1,
    })
    .toArray();

  return { results };
}

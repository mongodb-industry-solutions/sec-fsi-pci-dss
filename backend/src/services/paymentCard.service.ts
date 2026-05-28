import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  PAYMENT_CARD_COLLECTION,
  PaymentCardManagementControlRecord,
} from '../models';

export interface CreateCardInput {
  customerAgreementInstanceReference: string;
  cardToken: string;
  cardExpirationDate: string;
  maskedPanDisplay: string;
  cardNetwork: PaymentCardManagementControlRecord['cardNetwork'];
  isPreferredCard: boolean;
}

export async function createCard(db: Db, input: CreateCardInput) {
  const cardId = uuidv4();
  const now = new Date();

  const card: Omit<PaymentCardManagementControlRecord, never> = {
    paymentCardInstanceReference: cardId,
    customerAgreementInstanceReference: input.customerAgreementInstanceReference,
    paymentCardReference: input.cardToken,
    cardExpirationDate: input.cardExpirationDate,
    maskedPanDisplay: input.maskedPanDisplay,
    cardNetwork: input.cardNetwork,
    cardStatus: 'active',
    cardIssuanceDateTime: now,
    isPreferredCard: input.isPreferredCard,
    bianServiceDomain: 'PaymentCard',
    bianControlRecordType: 'PaymentCardManagement',
    recordCreatedDateTime: now,
  };

  await db.collection(PAYMENT_CARD_COLLECTION).insertOne(card as object);

  return {
    paymentCardInstanceReference: cardId,
    cardStatus: 'active',
  };
}

export async function getCardsByCustomer(db: Db, customerRef: string) {
  const results = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION)
    .find({ customerAgreementInstanceReference: customerRef })
    .project({
      paymentCardInstanceReference: 1,
      maskedPanDisplay: 1,
      cardNetwork: 1,
      cardStatus: 1,
      isPreferredCard: 1,
    })
    .toArray();

  return { results };
}

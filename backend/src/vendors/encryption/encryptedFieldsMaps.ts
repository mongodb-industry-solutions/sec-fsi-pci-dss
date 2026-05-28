import { Binary } from 'mongodb';

export function buildEncryptedFieldsMaps(
  dekLookupId: Binary,
  dekSensitiveId: Binary
) {
  return {
    // NOTE: paymentCardReference is NOT in QE. A payment token is a card
    // surrogate, not CHD under PCI DSS v4.0. Stored plaintext, standard index.
    cardTransaction: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'cardTransactionAccountReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        // v2: add cardTransactionAmount.amount with queryType: 'range'
      ],
    },

    cardTransactionSensitive: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'rawGatewayPayload',
          bsonType: 'object',
          // QE:none; encrypted, not searchable
        },
        {
          keyId: dekSensitiveId,
          path: 'processorTransactionMetadata',
          bsonType: 'object',
        },
      ],
    },

    customerAgreement: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'customerEmailAddress',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        {
          keyId: dekLookupId,
          path: 'customerMobilePhoneNumber',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        {
          keyId: dekLookupId,
          path: 'customerAgreementReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        // v2: customerName
      ],
    },

    customerAgreementSensitive: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'customerAgreementResidentialAddress',
          bsonType: 'object',
          // QE:none
        },
        {
          keyId: dekSensitiveId,
          path: 'governmentIdentificationReference',
          bsonType: 'string',
        },
        {
          keyId: dekSensitiveId,
          path: 'customerAgreementRiskNotes',
          bsonType: 'string',
        },
      ],
    },

    // NOTE: paymentCardReference is NOT in QE (same reason as cardTransaction).
    // paymentCardExpirationDate IS protected: expiry date is CHD when co-located with card ref.
    paymentCard: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'paymentCardExpirationDate',
          bsonType: 'string',
          // QE:none; non-searchable, retrieval only
        },
      ],
    },

    partyAuthentication: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'partyAuthenticationUserEmailAddress',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
      ],
    },

    // fraudDiagnosisCase: no QE, standard collection
  };
}

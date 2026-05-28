import { Binary } from 'mongodb';

export function buildEncryptedFieldsMaps(
  dekLookupId: Binary,
  dekSensitiveId: Binary
) {
  return {
    // NOTE: paymentCardReference is NOT in QE. A payment token is a card
    // surrogate, not CHD under PCI DSS v4.0. Stored plaintext, standard index.
    cardTransactionQE: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'cardTransactionAccountReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        // v2: add transactionAmount.amount with queryType: 'range'
      ],
    },

    cardTransactionSensitiveQE: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'rawGatewayPayload',
          bsonType: 'object',
          // QE:none — encrypted, not searchable
        },
        {
          keyId: dekSensitiveId,
          path: 'processorTransactionMetadata',
          bsonType: 'object',
        },
      ],
    },

    customerAgreementQE: {
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

    customerAgreementSensitiveQE: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'residentialAddressFull',
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
          path: 'internalRiskProfileNotes',
          bsonType: 'string',
        },
      ],
    },

    // NOTE: paymentCardReference is NOT in QE (same reason as cardTransactionQE).
    // cardExpirationDate IS protected: expiry date is CHD when co-located with card ref.
    paymentCardQE: {
      fields: [
        {
          keyId: dekSensitiveId,
          path: 'cardExpirationDate',
          bsonType: 'string',
          // QE:none — non-searchable, retrieval only
        },
      ],
    },

    partyAuthenticationQE: {
      fields: [
        {
          keyId: dekLookupId,
          path: 'authenticationUserEmailAddress',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
      ],
    },

    // fraudDiagnosisCase: no QE, standard collection
  };
}

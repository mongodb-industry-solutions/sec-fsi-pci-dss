import { DEKs } from './keyVault';

/**
 * Each encrypted field gets its own unique keyId (DEK).
 *
 * MongoDB QE requires uniqueness of keyId within the encryptedFields.fields array
 * of the same collection (error 6338401 otherwise). Fields across different
 * collections may share a DEK  -  but for clarity each field has its own named DEK.
 */
export function buildEncryptedFieldsMaps(deks: DEKs) {
  return {
    // ── SD-254: Card Transaction ─────────────────────────────────────────────
    // NOTE: paymentCardReference is NOT in QE. Card token is a surrogate, not
    // CHD under PCI DSS v4.0. Stored in plaintext with a standard index.
    cardTransaction: {
      fields: [
        {
          keyId: deks.txAccountRef,
          path: 'cardTransactionAccountReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        // v2 addition:
        // { keyId: deks.txAmount, path: 'cardTransactionAmount.amount', bsonType: 'double',
        //   queries: { queryType: 'range', min: 0, max: 999999, precision: 2 } },
      ],
    },

    // ── SD-254: Card Transaction Sensitive ───────────────────────────────────
    cardTransactionSensitive: {
      fields: [
        {
          keyId: deks.txRawPayload,           // unique keyId  -  required by QE
          path: 'rawGatewayPayload',
          bsonType: 'object',
          // QE:none  -  encrypted, not searchable
        },
        {
          keyId: deks.txProcessorMeta,        // unique keyId  -  required by QE
          path: 'processorTransactionMetadata',
          bsonType: 'object',
        },
      ],
    },

    // ── SD-53: Customer Agreement ─────────────────────────────────────────────
    customerAgreement: {
      fields: [
        {
          keyId: deks.customerEmail,          // unique keyId  -  required by QE
          path: 'customerEmailAddress',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        {
          keyId: deks.customerPhone,          // unique keyId  -  required by QE
          path: 'customerMobilePhoneNumber',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        {
          keyId: deks.customerAccountRef,     // unique keyId  -  required by QE
          path: 'customerAgreementReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        // v2: customerName with equality
      ],
    },

    // ── SD-53: Customer Agreement Sensitive ──────────────────────────────────
    customerAgreementSensitive: {
      fields: [
        {
          keyId: deks.customerAddress,        // unique keyId  -  required by QE
          path: 'customerAgreementResidentialAddress',
          bsonType: 'object',
          // QE:none
        },
        {
          keyId: deks.customerGovId,          // unique keyId  -  required by QE
          path: 'governmentIdentificationReference',
          bsonType: 'string',
        },
        {
          keyId: deks.customerRiskNotes,      // unique keyId  -  required by QE
          path: 'customerAgreementRiskNotes',
          bsonType: 'string',
        },
      ],
    },

    // ── SD-88: Payment Card ───────────────────────────────────────────────────
    // NOTE: paymentCardReference (token) is NOT in QE  -  same rule as cardTransaction.
    // paymentCardExpirationDate IS protected: CHD when co-located with a card reference.
    paymentCard: {
      fields: [
        {
          keyId: deks.cardExpiry,
          path: 'paymentCardExpirationDate',
          bsonType: 'string',
          // QE:none  -  not searchable, retrieval only
        },
      ],
    },

    // ── SD-16: Party Authentication ───────────────────────────────────────────
    partyAuthentication: {
      fields: [
        {
          keyId: deks.authEmail,
          path: 'partyAuthenticationUserEmailAddress',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
      ],
    },

    // fraudDiagnosisCase: no QE  -  operational metadata only, no CHD
  };
}

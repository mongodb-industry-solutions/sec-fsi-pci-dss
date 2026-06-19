import { DEKs } from './keyVault';

/**
 * Access tier for QE client pools (v2).
 *
 * level1 - Lookup DEKs only (QE:equality fields). Sensitive QE:none fields are NOT
 *           included in this map, so the MongoDB driver returns them as Binary ciphertext.
 *           The service layer strips any Binary values from the response automatically.
 *
 * level2 - All DEKs (lookup + sensitive). Both equality and QE:none fields are fully
 *           auto-decrypted by the driver before the service even sees the document.
 *
 * This means the QE client itself enforces field-level access control - no application
 * code needs to manually project out sensitive fields. The binary ciphertext returned
 * to a Level 1 client is unreadable without the DEK managed by AWS KMS.
 */
export type QETier = 'level1' | 'level2';

export function buildEncryptedFieldsMaps(deks: DEKs, tier: QETier = 'level2') {
  const includeSensitive = tier === 'level2';

  return {
    // -- SD-13: Party Data Management ----------------------------------------─
    party: {
      fields: [
        {
          keyId: deks.partyEmail,
          path: 'partyEmailAddress',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        {
          keyId: deks.partyPhone,
          path: 'partyMobilePhoneNumber',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
      ],
    },

    // -- SD-254: Card Transaction Log ----------------------------------------─
    // paymentCardReference is NOT in QE - card token is not CHD under PCI DSS v4.0.
    cardTransactionLog: {
      fields: [
        {
          keyId: deks.txAccountRef,
          path: 'cardTransactionAccountReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
        // v2 range query on amount (equality comment kept for reference):
        // { keyId: deks.txAmount, path: 'cardTransactionAmount.amount', bsonType: 'double',
        //   queries: { queryType: 'range', min: 0, max: 999999, precision: 2 } },

        // DEK-sensitive tier: gateway payload - Level 2 only
        ...(includeSensitive ? [
          {
            keyId: deks.txRawPayload,
            path: 'rawGatewayPayload',
            bsonType: 'object',
            // QE:none - non-searchable, retrieval only
          },
          {
            keyId: deks.txProcessorMeta,
            path: 'processorTransactionMetadata',
            bsonType: 'object',
          },
        ] : []),
      ],
    },

    // -- SD-53: Customer Agreement Procedure ----------------------------------
    // PII (email, phone, name) lives in SD-13 party. customerAgreementReference is
    // a business key (not PII) so it stays here as QE:equality.
    customerAgreementProcedure: {
      fields: [
        {
          keyId: deks.customerAccountRef,
          path: 'customerAgreementReference',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },

        // DEK-sensitive tier: address, govId, riskNotes - Level 2 only
        ...(includeSensitive ? [
          {
            keyId: deks.customerAddress,
            path: 'customerAgreementResidentialAddress',
            bsonType: 'object',
            // QE:none
          },
          {
            keyId: deks.customerGovId,
            path: 'governmentIdentificationReference',
            bsonType: 'string',
          },
          {
            keyId: deks.customerRiskNotes,
            path: 'customerAgreementRiskNotes',
            bsonType: 'string',
          },
        ] : []),
      ],
    },

    // -- SD-88: Payment Card Management --------------------------------------─
    // paymentCardReference (token) is NOT in QE - same rule as cardTransactionLog.
    // paymentCardExpirationDate IS protected: CHD when co-located with a card reference.
    paymentCardManagement: {
      fields: [
        {
          keyId: deks.cardExpiry,
          path: 'paymentCardExpirationDate',
          bsonType: 'string',
          // QE:none - not searchable, retrieval only (same for both tiers: expiry is not
          // a sensitive-escalation field; it is always returned to Level 1 as ciphertext
          // since QE:none fields without equality queries are never searchable anyway)
        },
      ],
    },

    // -- SD-91: Customer Authentication --------------------------------------─
    customerAuthenticationAssessment: {
      fields: [
        {
          keyId: deks.authEmail,
          path: 'customerAuthenticationEmailAddress',
          bsonType: 'string',
          queries: { queryType: 'equality' },
        },
      ],
    },
  };
}

export type EncryptedFieldsMaps = ReturnType<typeof buildEncryptedFieldsMaps>;

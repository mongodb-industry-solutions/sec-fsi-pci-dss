import { DEKs } from './keyVault';
import { config } from '../../config';

// QE text-search preview query types (MongoDB 8.2 preview / mongodb-client-encryption 7.2).
// If a spike shows different identifiers, change ONLY these three constants.
const QT_SUBSTRING = 'substringPreview';
const QT_PREFIX = 'prefixPreview';
const QT_SUFFIX = 'suffixPreview';

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

export function buildEncryptedFieldsMaps(
  deks: DEKs,
  tier: QETier = 'level2',
  textSearch: boolean = config.qe.textSearch,
) {
  const includeSensitive = tier === 'level2';

  // Text-search query object, gated by textSearch. On pre-8.2 clusters the field degrades
  // to QE:equality (still encrypted, still lookup-tier, exact-match searchable).
  const textQuery = (
    qt: string,
    params: Record<string, unknown>,
  ): Record<string, unknown> =>
    textSearch ? { queryType: qt, ...params } : { queryType: 'equality', contention: 8 };

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
        // v27 searchable KYC (lookup tier, both L1 + L2). Encrypted at rest, searchable over ciphertext.
        {
          keyId: deks.partyName,
          path: 'partyName',
          bsonType: 'string',
          queries: textQuery(QT_SUBSTRING, {
            // Params kept within the cluster default substringPreview limits (strMaxQueryLength
            // capped) so setup needs no fleDisableSubstringPreviewParameterLimits override.
            strMaxLength: 30, strMinQueryLength: 3, strMaxQueryLength: 10,
            caseSensitive: false, diacriticSensitive: false,
          }),
        },
        {
          keyId: deks.partyDob,
          path: 'partyDateOfBirth',
          bsonType: 'date',
          queries: {
            queryType: 'range',
            min: new Date('1900-01-01'), max: new Date('2020-01-01'),
            sparsity: 1, trimFactor: 4,
          },
        },
        {
          keyId: deks.partyNationality,
          path: 'partyNationality',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 8 },
        },
        {
          keyId: deks.partyPlaceOfBirth,
          path: 'partyPlaceOfBirth',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 8 },
        },
        {
          keyId: deks.partySex,
          path: 'partySex',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 8 },
        },
        // GDPR PII — QE:none (L2 only). Postal address is sensitive personal data;
        // encrypted at rest, decrypted only for the L2 client (or the party themselves).
        ...(includeSensitive ? [
          { keyId: deks.partyAddress, path: 'partyPostalAddress', bsonType: 'object' },
        ] : []),
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

        // v27 searchable KYC (lookup tier, both L1 + L2). Nested scalar leaves are allowed
        // because the parent sub-doc (customerAgreementGovernmentID) is plaintext.
        {
          keyId: deks.caGovIdNumber,
          path: 'customerAgreementGovernmentID.number',
          bsonType: 'string',
          queries: textQuery(QT_SUFFIX, {
            strMaxLength: 20, strMinQueryLength: 3, strMaxQueryLength: 10,
            caseSensitive: true, diacriticSensitive: true,
          }),
        },
        {
          keyId: deks.caGovIdType,
          path: 'customerAgreementGovernmentID.type',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 6 },
        },
        {
          keyId: deks.caGovIdIssuingCountry,
          path: 'customerAgreementGovernmentID.issuingCountry',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 6 },
        },
        {
          keyId: deks.caGovIdExpiry,
          path: 'customerAgreementGovernmentID.expiryDate',
          bsonType: 'date',
          queries: {
            queryType: 'range',
            min: new Date('2000-01-01'), max: new Date('2040-01-01'),
            sparsity: 1, trimFactor: 4,
          },
        },
        {
          keyId: deks.caTaxId,
          path: 'customerAgreementTaxIDNumber',
          bsonType: 'string',
          queries: textQuery(QT_PREFIX, {
            strMaxLength: 20, strMinQueryLength: 2, strMaxQueryLength: 10,
            caseSensitive: true, diacriticSensitive: true,
          }),
        },
        {
          keyId: deks.caOccupation,
          path: 'customerAgreementOccupation',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 6 },
        },
        {
          keyId: deks.kycRiskScore,
          path: 'customerAgreementKycCheck.customerAgreementKycCheckRiskScore',
          bsonType: 'int',
          queries: { queryType: 'range', min: 0, max: 100, sparsity: 1, trimFactor: 4 },
        },
        {
          keyId: deks.kycRiskRating,
          path: 'customerAgreementKycCheck.customerAgreementKycCheckRiskRating',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 8 },
        },
        {
          keyId: deks.kycPepStatus,
          path: 'customerAgreementKycCheck.customerAgreementKycCheckPepStatus',
          bsonType: 'bool',
          queries: { queryType: 'equality', contention: 8 },
        },
        {
          keyId: deks.kycSanctionsResult,
          path: 'customerAgreementKycCheck.customerAgreementKycCheckSanctionsResult',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 8 },
        },

        // DEK-sensitive tier: QE:none - Level 2 only
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
            // QE:none (deprecated v27)
          },
          {
            keyId: deks.customerRiskNotes,
            path: 'customerAgreementRiskNotes',
            bsonType: 'string',
            // QE:none (deprecated v27)
          },
          {
            keyId: deks.caSourceOfFunds,
            path: 'customerAgreementSourceOfFunds',
            bsonType: 'string',
            // QE:none (v27)
          },
          {
            keyId: deks.caPurpose,
            path: 'customerAgreementPurposeOfRelationship',
            bsonType: 'string',
            // QE:none (v27)
          },
          {
            keyId: deks.kycScreeningRef,
            path: 'customerAgreementKycCheck.customerAgreementKycCheckScreeningProviderRef',
            bsonType: 'string',
            // QE:none (v27)
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

    // -- Card Administration (issuer CDE): cardIssuerVault -------------------─
    // Module-owned issuer vault (v30). Holds the FULL PAN (CHD) and the card service code, which
    // never exist in the PSP core (core stays descoped: token + BIN + last4 only). QE:equality lets
    // MongoDB locate/dedup a card by its exact PAN over ciphertext without client-side decryption
    // (the differentiator). Lookup tier so setup succeeds on 8.0 (no substring/suffix showcase).
    cardIssuerVault: {
      fields: [
        {
          keyId: deks.vaultPan,
          path: 'paymentCardNumber',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 8 },
        },
        {
          keyId: deks.vaultServiceCode,
          path: 'cardServiceCode',
          bsonType: 'string',
          queries: { queryType: 'equality', contention: 8 },
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

    // -- SD-66: Payout Account Arrangement -----------------------------------─
    // IBAN and routing number are GDPR Art. 32 / PSD2 sensitive bank data — QE:none, L2 only.
    // (Not PCI DSS: PCI scope is card data / PAN, not bank accounts.)
    // No QE:equality needed (accounts are looked up by payoutAccountInstanceReference).
    ...(includeSensitive ? {
      payoutAccountArrangement: {
        fields: [
          {
            keyId: deks.payoutIban,
            path: 'payoutAccountIban',
            bsonType: 'string',
            // QE:none — non-searchable, retrieval only
          },
          {
            keyId: deks.payoutRouting,
            path: 'payoutAccountRoutingNumber',
            bsonType: 'string',
          },
        ],
      },
    } : {}),

    // -- SD-65: Payment Execution Procedure ----------------------------------─
    // destinationIban holds the full IBAN of an UNREGISTERED external destination the user typed
    // for a one-off bank transfer. GDPR Art. 32 / PSD2 sensitive bank data — QE:none, L2 only.
    // (Not PCI DSS.) The masked form (destinationAccountMasked) stays plaintext for list views.
    ...(includeSensitive ? {
      paymentExecutionProcedure: {
        fields: [
          {
            keyId: deks.execDestIban,
            path: 'destinationIban',
            bsonType: 'string',
            // QE:none — non-searchable, retrieval only
          },
        ],
      },
    } : {}),

    // -- SD-65 (v28): Request to Pay canonical record ------------------------─
    // RTP is account/alias-based → OUTSIDE PCI scope (no PAN/CHD). Sensitive request PII is
    // GDPR-minimized: aliases are indexed by a non-reversible SHA-256 hash (payeeAliasHash/
    // payerAliasHash, plaintext) while the plaintext alias, free-text remittance, structured
    // address and payee name are QE:none (L2 only). All retrieval-only, no searchable QE index
    // (avoids QE index blow-up; directory lookups use the hash).
    ...(includeSensitive ? {
      paymentRequestProcedure: {
        fields: [
          { keyId: deks.rtpPayeeAlias, path: 'payeeAlias', bsonType: 'string' },
          { keyId: deks.rtpPayerAlias, path: 'payerAlias', bsonType: 'string' },
          { keyId: deks.rtpRemittance, path: 'unstructuredRemittance', bsonType: 'string' },
          { keyId: deks.rtpAddress, path: 'structuredAddress', bsonType: 'object' },
          { keyId: deks.rtpPayeeName, path: 'payeeName', bsonType: 'string' },
        ],
      },
    } : {}),
  };
}

export type EncryptedFieldsMaps = ReturnType<typeof buildEncryptedFieldsMaps>;

import { MongoClient, ClientEncryption, Binary } from 'mongodb';
import { buildKmsProviders, buildCmkOptions, getKmsConfig } from './kms';

const kmsConfig = getKmsConfig();

/**
 * One DEK per encrypted field.
 *
 * MongoDB QE constraint: each field in encryptedFields.fields within the SAME
 * collection must have a unique keyId. Sharing a DEK across fields in the same
 * collection is not allowed (error 6338401).
 *
 * Design note: fields are still grouped into two access tiers for RBAC:
 *   - Lookup DEKs  → QE:equality fields accessible to Level 1 Analyst
 *   - Sensitive DEKs → QE:none fields accessible only to Level 2 Investigator
 */
export interface DEKs {
  // -- Lookup tier (QE:equality, Level 1+) --------------------------------─
  txAccountRef: Binary;           // cardTransactionLog.cardTransactionAccountReference
  partyEmail: Binary;             // party.partyEmailAddress (SD-13)
  partyPhone: Binary;             // party.partyMobilePhoneNumber (SD-13)
  customerAccountRef: Binary;     // customerAgreementProcedure.customerAgreementReference
  authEmail: Binary;              // customerAuthenticationAssessment.customerAuthenticationEmailAddress
  // v27 searchable KYC fields (QE:equality/range/text) - lookup tier, L1+
  partyName: Binary;              // party.partyName (SD-13) - QE:substring
  partyNationality: Binary;       // party.partyNationality (SD-13) - QE:equality
  partyPlaceOfBirth: Binary;      // party.partyPlaceOfBirth (SD-13) - QE:equality
  caGovIdType: Binary;            // customerAgreementGovernmentID.type - QE:equality
  caGovIdNumber: Binary;          // customerAgreementGovernmentID.number - QE:suffix
  caGovIdIssuingCountry: Binary;  // customerAgreementGovernmentID.issuingCountry - QE:equality
  caGovIdExpiry: Binary;          // customerAgreementGovernmentID.expiryDate - QE:range
  caTaxId: Binary;                // customerAgreementTaxIDNumber - QE:prefix
  // v30 issuer vault (module-owned CDE) - QE:equality, lookup tier
  vaultPan: Binary;               // cardIssuerVault.paymentCardNumber (full PAN) - QE:equality
  vaultServiceCode: Binary;       // cardIssuerVault.cardServiceCode - QE:equality
  caOccupation: Binary;           // customerAgreementOccupation - QE:equality
  kycRiskScore: Binary;           // customerAgreementKycCheck.customerAgreementKycCheckRiskScore - QE:range
  kycRiskRating: Binary;          // customerAgreementKycCheck.customerAgreementKycCheckRiskRating - QE:equality
  kycPepStatus: Binary;           // customerAgreementKycCheck.customerAgreementKycCheckPepStatus - QE:equality
  kycSanctionsResult: Binary;     // customerAgreementKycCheck.customerAgreementKycCheckSanctionsResult - QE:equality

  // -- Sensitive tier (QE:none, Level 2 only) ------------------------------
  txRawPayload: Binary;           // cardTransactionLogSensitive.rawGatewayPayload
  txProcessorMeta: Binary;        // cardTransactionLogSensitive.processorTransactionMetadata
  customerAddress: Binary;        // customerAgreementProcedureSensitive.customerAgreementResidentialAddress
  customerGovId: Binary;          // customerAgreementProcedureSensitive.governmentIdentificationReference (deprecated)
  customerRiskNotes: Binary;      // customerAgreementProcedureSensitive.customerAgreementRiskNotes (deprecated)
  // v27 QE:none KYC fields - sensitive tier, L2 only
  caSourceOfFunds: Binary;        // customerAgreementSourceOfFunds
  caPurpose: Binary;              // customerAgreementPurposeOfRelationship
  kycScreeningRef: Binary;        // customerAgreementKycCheck.customerAgreementKycCheckScreeningProviderRef
  cardExpiry: Binary;             // paymentCardManagement.paymentCardExpirationDate
  payoutIban: Binary;             // payoutAccountArrangement.payoutAccountIban (SD-66)
  payoutRouting: Binary;          // payoutAccountArrangement.payoutAccountRoutingNumber (SD-66)
  execDestIban: Binary;           // paymentExecutionProcedure.destinationIban (SD-65) — unregistered destination
  partyAddress: Binary;           // party.partyPostalAddress (SD-13) — GDPR PII
  partyDob: Binary;               // party.partyDateOfBirth (SD-13) — GDPR PII
  // v28 RTP QE:none fields (sensitive tier, L2 only) — one DEK per field per collection
  rtpPayeeAlias: Binary;          // paymentRequestProcedure.payeeAlias
  rtpPayerAlias: Binary;          // paymentRequestProcedure.payerAlias
  rtpRemittance: Binary;          // paymentRequestProcedure.unstructuredRemittance
  rtpAddress: Binary;             // paymentRequestProcedure.structuredAddress
  rtpPayeeName: Binary;           // paymentRequestProcedure.payeeName
}

export async function provisionDataEncryptionKeys(client: MongoClient): Promise<DEKs> {
  const kmsProviders = buildKmsProviders();
  const cmkOptions = buildCmkOptions();

  const clientEncryption = new ClientEncryption(client, {
    keyVaultNamespace: kmsConfig.namespace,
    kmsProviders,
  });

  const keyVaultColl = client.db(kmsConfig.database).collection(kmsConfig.collection);

  async function getOrCreate(keyName: string): Promise<Binary> {
    const existing = await keyVaultColl.findOne({ keyAltNames: keyName });
    if (existing) {
      console.log(`    reuse: ${keyName}`);
      return existing._id as unknown as Binary;
    }
    const id = await clientEncryption.createDataKey(
      kmsConfig.provider,
      { masterKey: cmkOptions?.aws, keyAltNames: [keyName] }
    );
    console.log(`    new:   ${keyName}`);
    return id as unknown as Binary;
  }

  // Lookup tier
  const txAccountRef = await getOrCreate('DEK-tx-account-ref');
  const partyEmail = await getOrCreate('DEK-party-email');
  const partyPhone = await getOrCreate('DEK-party-phone');
  const customerAccountRef = await getOrCreate('DEK-customer-account-ref');
  const authEmail = await getOrCreate('DEK-auth-email');
  // v27 searchable KYC (lookup tier)
  const partyName = await getOrCreate('DEK-party-name');
  const partyNationality = await getOrCreate('DEK-party-nationality');
  const partyPlaceOfBirth = await getOrCreate('DEK-party-place-of-birth');
  const caGovIdType = await getOrCreate('DEK-ca-govid-type');
  const caGovIdNumber = await getOrCreate('DEK-ca-govid-number');
  const caGovIdIssuingCountry = await getOrCreate('DEK-ca-govid-issuing-country');
  const caGovIdExpiry = await getOrCreate('DEK-ca-govid-expiry');
  const caTaxId = await getOrCreate('DEK-ca-tax-id');
  // v30 issuer vault
  const vaultPan = await getOrCreate('DEK-vault-pan');
  const vaultServiceCode = await getOrCreate('DEK-vault-service-code');
  const caOccupation = await getOrCreate('DEK-ca-occupation');
  const kycRiskScore = await getOrCreate('DEK-kyc-risk-score');
  const kycRiskRating = await getOrCreate('DEK-kyc-risk-rating');
  const kycPepStatus = await getOrCreate('DEK-kyc-pep-status');
  const kycSanctionsResult = await getOrCreate('DEK-kyc-sanctions-result');

  // Sensitive tier
  const txRawPayload = await getOrCreate('DEK-tx-raw-payload');
  const txProcessorMeta = await getOrCreate('DEK-tx-processor-meta');
  const customerAddress = await getOrCreate('DEK-customer-address');
  const customerGovId = await getOrCreate('DEK-customer-gov-id');
  const customerRiskNotes = await getOrCreate('DEK-customer-risk-notes');
  const cardExpiry = await getOrCreate('DEK-card-expiry');
  const payoutIban = await getOrCreate('DEK-payout-iban');
  const payoutRouting = await getOrCreate('DEK-payout-routing');
  const execDestIban = await getOrCreate('DEK-exec-dest-iban');
  const partyAddress = await getOrCreate('DEK-party-address');
  const partyDob = await getOrCreate('DEK-party-dob');
  // v27 QE:none KYC (sensitive tier)
  const caSourceOfFunds = await getOrCreate('DEK-ca-source-of-funds');
  const caPurpose = await getOrCreate('DEK-ca-purpose');
  const kycScreeningRef = await getOrCreate('DEK-kyc-screening-ref');
  // v28 RTP QE:none (sensitive tier)
  const rtpPayeeAlias = await getOrCreate('DEK-rtp-payee-alias');
  const rtpPayerAlias = await getOrCreate('DEK-rtp-payer-alias');
  const rtpRemittance = await getOrCreate('DEK-rtp-remittance');
  const rtpAddress = await getOrCreate('DEK-rtp-address');
  const rtpPayeeName = await getOrCreate('DEK-rtp-payee-name');

  return {
    txAccountRef, partyEmail, partyPhone, customerAccountRef, authEmail,
    partyName, partyNationality, partyPlaceOfBirth,
    caGovIdType, caGovIdNumber, caGovIdIssuingCountry, caGovIdExpiry,
    caTaxId, caOccupation, kycRiskScore, kycRiskRating, kycPepStatus, kycSanctionsResult,
    vaultPan, vaultServiceCode,
    txRawPayload, txProcessorMeta, customerAddress, customerGovId, customerRiskNotes, cardExpiry,
    payoutIban, payoutRouting, execDestIban, partyAddress, partyDob,
    caSourceOfFunds, caPurpose, kycScreeningRef,
    rtpPayeeAlias, rtpPayerAlias, rtpRemittance, rtpAddress, rtpPayeeName,
  };
}

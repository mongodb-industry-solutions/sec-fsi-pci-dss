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
  partyEmail: Binary;             // party.partyEmailAddress 
  partyPhone: Binary;             // party.partyMobilePhoneNumber 
  customerAccountRef: Binary;     // customerAgreementProcedure.customerAgreementReference
  authEmail: Binary;              // customerAuthenticationAssessment.customerAuthenticationEmailAddress
  // v27 searchable KYC fields (QE:equality/range/text) - lookup tier, L1+
  partyName: Binary;              // party.partyName - QE:substring
  partyNationality: Binary;       // party.partyNationality - QE:equality
  partyPlaceOfBirth: Binary;      // party.partyPlaceOfBirth - QE:equality
  partySex: Binary;               // party.partySex - QE:equality
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
  customerGovId: Binary;          // legacy DEK for the deprecated governmentIdentificationReference (v32:
                                  // no longer written or read; the DEK stays so pre-v32 documents remain decryptable)
  customerRiskNotes: Binary;      // customerAgreementProcedureSensitive.customerAgreementRiskNotes (deprecated)
  // v27 QE:none KYC fields - sensitive tier, L2 only
  caSourceOfFunds: Binary;        // customerAgreementSourceOfFunds
  caPurpose: Binary;              // customerAgreementPurposeOfRelationship
  kycScreeningRef: Binary;        // customerAgreementKycCheck.customerAgreementKycCheckScreeningProviderRef
  cardExpiry: Binary;             // paymentCardManagement.paymentCardExpirationDate
  payoutIban: Binary;             // payoutAccountArrangement.payoutAccountIban 
  payoutRouting: Binary;          // payoutAccountArrangement.payoutAccountRoutingNumber 
  execDestIban: Binary;           // paymentExecutionProcedure.destinationIban , unregistered destination
  partyAddress: Binary;           // party.partyPostalAddress , GDPR PII
  partyDob: Binary;               // party.partyDateOfBirth , GDPR PII
  // v28 RTP QE:none fields (sensitive tier, L2 only), one DEK per field per collection
  rtpPayeeAlias: Binary;          // paymentRequestProcedure.payeeAlias
  rtpPayerAlias: Binary;          // paymentRequestProcedure.payerAlias
  rtpRemittance: Binary;          // paymentRequestProcedure.unstructuredRemittance
  rtpAddress: Binary;             // paymentRequestProcedure.structuredAddress
  rtpPayeeName: Binary;           // paymentRequestProcedure.payeeName
}

/**
 * Repairs a key vault that already holds several keys under one alt name, then establishes the
 * uniqueness guarantee that prevents it happening again.
 *
 * How a vault gets into that state: provisioning runs from two places, `runSetup` and `buildQEClient`
 * (once per QE tier), and `getOrCreate` is a check then act. On a FRESH vault with the server running,
 * those paths race and each creates its own copy. The unique index used to be created only by the
 * setup path, so nothing stopped it, and once duplicated the index can never be built again: setup
 * fails with E11000 on every subsequent run and the platform cannot be provisioned at all.
 *
 * The repair keeps one key per alt name (the oldest, which is the one anything already encrypted
 * would have used) and removes only the ALT NAME from the others. The key material stays, so data
 * encrypted under a duplicate remains decryptable; deleting the keys would make it unreadable
 * forever, which is not a trade to make for a naming conflict.
 */
export async function ensureKeyVaultIntegrity(client: MongoClient): Promise<{ repaired: string[] }> {
  const keyVaultColl = client.db(kmsConfig.database).collection(kmsConfig.collection);
  const repaired: string[] = [];

  const duplicates = await keyVaultColl.aggregate<{ _id: string; keys: Array<{ id: unknown; created: Date }> }>([
    { $unwind: '$keyAltNames' },
    { $group: { _id: '$keyAltNames', keys: { $push: { id: '$_id', created: '$creationDate' } } } },
    { $match: { $expr: { $gt: [{ $size: '$keys' }, 1] } } },
  ]).toArray();

  for (const duplicate of duplicates) {
    const ordered = [...duplicate.keys].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
    const [, ...losers] = ordered;
    await keyVaultColl.updateMany(
      { _id: { $in: losers.map((k) => k.id) } as never },
      { $pull: { keyAltNames: duplicate._id } as never },
    );
    repaired.push(`${duplicate._id} (kept 1 of ${ordered.length})`);
  }

  // An emptied array is not the same as no array: `keyAltNames: []` still satisfies the partial
  // filter and indexes as a single undefined value, so several of them collide with each other and
  // the index still cannot build. Remove the field once nothing is left in it.
  // Unconditional: a previous repair may have left the empty arrays behind, and this run would then
  // find no duplicates, skip the cleanup, and still fail to build the index.
  const emptied = await keyVaultColl.updateMany(
    { keyAltNames: { $size: 0 } },
    { $unset: { keyAltNames: '' } as never },
  );
  if (emptied.modifiedCount > 0) {
    console.log(`    dropped the empty alt-name array on ${emptied.modifiedCount} superseded key(s)`);
  }

  if (repaired.length > 0) {
    console.log(`    repaired duplicate DEK alt names: ${repaired.join(', ')}`);
  }

  // Establish the guarantee for every provisioning path, not just the setup one.
  await keyVaultColl.createIndex(
    { keyAltNames: 1 },
    { unique: true, partialFilterExpression: { keyAltNames: { $exists: true } } },
  );

  return { repaired };
}

export async function provisionDataEncryptionKeys(client: MongoClient): Promise<DEKs> {
  const kmsProviders = buildKmsProviders();
  const cmkOptions = buildCmkOptions();

  const clientEncryption = new ClientEncryption(client, {
    keyVaultNamespace: kmsConfig.namespace,
    kmsProviders,
  });

  const keyVaultColl = client.db(kmsConfig.database).collection(kmsConfig.collection);

  // Before any key is created, whichever path got here first.
  await ensureKeyVaultIntegrity(client);

  async function getOrCreate(keyName: string): Promise<Binary> {
    const existing = await keyVaultColl.findOne({ keyAltNames: keyName });
    if (existing) {
      console.log(`    reuse: ${keyName}`);
      return existing._id as unknown as Binary;
    }
    try {
      const id = await clientEncryption.createDataKey(
        kmsConfig.provider,
        { masterKey: cmkOptions?.aws, keyAltNames: [keyName] }
      );
      console.log(`    new:   ${keyName}`);
      return id as unknown as Binary;
    } catch (err) {
      // Another provisioning path won the race between the read above and this write. With the unique
      // index in place that is now a clean refusal, so adopt the key it created instead of failing.
      if ((err as { code?: number }).code !== 11000) throw err;
      const winner = await keyVaultColl.findOne({ keyAltNames: keyName });
      if (!winner) throw err;
      console.log(`    reuse: ${keyName} (created concurrently)`);
      return winner._id as unknown as Binary;
    }
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
  const partySex = await getOrCreate('DEK-party-sex');
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
    partyName, partyNationality, partyPlaceOfBirth, partySex,
    caGovIdType, caGovIdNumber, caGovIdIssuingCountry, caGovIdExpiry,
    caTaxId, caOccupation, kycRiskScore, kycRiskRating, kycPepStatus, kycSanctionsResult,
    vaultPan, vaultServiceCode,
    txRawPayload, txProcessorMeta, customerAddress, customerGovId, customerRiskNotes, cardExpiry,
    payoutIban, payoutRouting, execDestIban, partyAddress, partyDob,
    caSourceOfFunds, caPurpose, kycScreeningRef,
    rtpPayeeAlias, rtpPayerAlias, rtpRemittance, rtpAddress, rtpPayeeName,
  };
}

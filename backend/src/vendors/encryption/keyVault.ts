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

  // -- Sensitive tier (QE:none, Level 2 only) ------------------------------
  txRawPayload: Binary;           // cardTransactionLogSensitive.rawGatewayPayload
  txProcessorMeta: Binary;        // cardTransactionLogSensitive.processorTransactionMetadata
  customerAddress: Binary;        // customerAgreementProcedureSensitive.customerAgreementResidentialAddress
  customerGovId: Binary;          // customerAgreementProcedureSensitive.governmentIdentificationReference
  customerRiskNotes: Binary;      // customerAgreementProcedureSensitive.customerAgreementRiskNotes
  cardExpiry: Binary;             // paymentCardManagement.paymentCardExpirationDate
  payoutIban: Binary;             // payoutAccountArrangement.payoutAccountIban (SD-66)
  payoutRouting: Binary;          // payoutAccountArrangement.payoutAccountRoutingNumber (SD-66)
  execDestIban: Binary;           // paymentExecutionProcedure.destinationIban (SD-65) — unregistered destination
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

  return {
    txAccountRef, partyEmail, partyPhone, customerAccountRef, authEmail,
    txRawPayload, txProcessorMeta, customerAddress, customerGovId, customerRiskNotes, cardExpiry,
    payoutIban, payoutRouting, execDestIban,
  };
}

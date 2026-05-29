import { MongoClient, ClientEncryption, Binary } from 'mongodb';
import { buildKmsProviders, buildCmkOptions } from './kms';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';

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
  // ── Lookup tier (QE:equality, Level 1+) ─────────────────────────────────
  txAccountRef: Binary;           // cardTransaction.cardTransactionAccountReference
  customerEmail: Binary;          // customerAgreement.customerEmailAddress
  customerPhone: Binary;          // customerAgreement.customerMobilePhoneNumber
  customerAccountRef: Binary;     // customerAgreement.customerAgreementReference
  authEmail: Binary;              // partyAuthentication.partyAuthenticationUserEmailAddress

  // ── Sensitive tier (QE:none, Level 2 only) ──────────────────────────────
  txRawPayload: Binary;           // cardTransactionSensitive.rawGatewayPayload
  txProcessorMeta: Binary;        // cardTransactionSensitive.processorTransactionMetadata
  customerAddress: Binary;        // customerAgreementSensitive.customerAgreementResidentialAddress
  customerGovId: Binary;          // customerAgreementSensitive.governmentIdentificationReference
  customerRiskNotes: Binary;      // customerAgreementSensitive.customerAgreementRiskNotes
  cardExpiry: Binary;             // paymentCard.paymentCardExpirationDate
}

export async function provisionDataEncryptionKeys(client: MongoClient): Promise<DEKs> {
  const kmsProviders = buildKmsProviders();
  const cmkOptions = buildCmkOptions();

  const clientEncryption = new ClientEncryption(client, {
    keyVaultNamespace: KEY_VAULT_NAMESPACE,
    kmsProviders,
  });

  const keyVaultColl = client.db('encryption').collection('__keyVault');

  async function getOrCreate(keyName: string): Promise<Binary> {
    const existing = await keyVaultColl.findOne({ keyAltNames: keyName });
    if (existing) {
      console.log(`    reuse: ${keyName}`);
      return existing._id as unknown as Binary;
    }
    const id = await clientEncryption.createDataKey(
      process.env.KMS_PROVIDER === 'local' ? 'local' : 'aws',
      { masterKey: cmkOptions?.aws, keyAltNames: [keyName] }
    );
    console.log(`    new:   ${keyName}`);
    return id as unknown as Binary;
  }

  // Lookup tier
  const txAccountRef      = await getOrCreate('DEK-tx-account-ref');
  const customerEmail     = await getOrCreate('DEK-customer-email');
  const customerPhone     = await getOrCreate('DEK-customer-phone');
  const customerAccountRef = await getOrCreate('DEK-customer-account-ref');
  const authEmail         = await getOrCreate('DEK-auth-email');

  // Sensitive tier
  const txRawPayload      = await getOrCreate('DEK-tx-raw-payload');
  const txProcessorMeta   = await getOrCreate('DEK-tx-processor-meta');
  const customerAddress   = await getOrCreate('DEK-customer-address');
  const customerGovId     = await getOrCreate('DEK-customer-gov-id');
  const customerRiskNotes = await getOrCreate('DEK-customer-risk-notes');
  const cardExpiry        = await getOrCreate('DEK-card-expiry');

  return {
    txAccountRef, customerEmail, customerPhone, customerAccountRef, authEmail,
    txRawPayload, txProcessorMeta, customerAddress, customerGovId, customerRiskNotes, cardExpiry,
  };
}

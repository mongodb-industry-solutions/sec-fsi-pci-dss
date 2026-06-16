import { MongoClient, ClientEncryption } from 'mongodb';
import { buildKmsProviders } from '../encryption/kms';
import { buildEncryptedFieldsMaps } from '../encryption/encryptedFieldsMaps';
import { DEKs } from '../encryption/keyVault';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';

export async function createCollections(
  client: MongoClient,
  deks: DEKs,
  reset = false
) {
  const dbName = process.env.MONGODB_DB_NAME!;
  const db = client.db(dbName);
  const maps = buildEncryptedFieldsMaps(deks);

  const clientEncryption = new ClientEncryption(client, {
    keyVaultNamespace: KEY_VAULT_NAMESPACE,
    kmsProviders: buildKmsProviders(),
  });

  // v2: *Sensitive collections removed. Sensitive fields (QE:none, DEK-sensitive tier)
  // are now co-located in the main collection. Field-level access is enforced by the
  // role-aware QE client pool (roleClients.ts) - Level 1 map omits sensitive fields so
  // they are returned as Binary ciphertext; Level 2 map includes them for auto-decryption.
  const qeCollections = [
    // SD-13: Party Data Management  -  canonical PII store
    { name: 'party',                            map: maps.party },
    // SD-254: Card Transaction Log (includes sensitive gateway fields in unified doc)
    { name: 'cardTransactionLog',               map: maps.cardTransactionLog },
    // SD-53: Customer Agreement Procedure (includes sensitive address/govId in unified doc)
    { name: 'customerAgreementProcedure',       map: maps.customerAgreementProcedure },
    // SD-88: Payment Card Management
    { name: 'paymentCardManagement',            map: maps.paymentCardManagement },
    // SD-91: Customer Authentication
    { name: 'customerAuthenticationAssessment', map: maps.customerAuthenticationAssessment },
  ] as const;

  const existingList = await db.listCollections().toArray();
  const existingNames = new Set(existingList.map((c) => c.name));

  for (const { name, map } of qeCollections) {
    if (existingNames.has(name)) {
      if (reset) {
        await db.collection(name).drop();
        console.log(`  dropped: ${name}`);
      } else {
        console.log(`  skip:    ${name} (already exists  -  run with --reset to recreate)`);
        continue;
      }
    }

    const provider = process.env.KMS_PROVIDER === 'local' ? 'local' : 'aws';
    const masterKey =
      process.env.KMS_PROVIDER !== 'local'
        ? { key: process.env.AWS_CMK_ARN!, region: process.env.AWS_REGION! }
        : undefined;

    await clientEncryption.createEncryptedCollection(db, name, {
      provider,
      createCollectionOptions: { encryptedFields: map },
      ...(masterKey && { masterKey }),
    });
    console.log(`  created: ${name}`);
  }

  // authenticationDomain  -  plaintext, no QE (domain config, no CHD)
  if (!existingNames.has('authenticationDomain') || reset) {
    if (existingNames.has('authenticationDomain') && reset) {
      await db.collection('authenticationDomain').drop();
      console.log('  dropped: authenticationDomain');
    }
    await db.createCollection('authenticationDomain');
    console.log('  created: authenticationDomain');
  } else {
    console.log('  skip:    authenticationDomain (already exists)');
  }

  // ADR-030 / SD-16: RBAC role definitions  -  plaintext, no QE (permission matrix, no CHD)
  if (!existingNames.has('role') || reset) {
    if (existingNames.has('role') && reset) {
      await db.collection('role').drop();
      console.log('  dropped: role');
    }
    await db.createCollection('role');
    console.log('  created: role');
  } else {
    console.log('  skip:    role (already exists)');
  }

  // SD-16: Party Authentication Assessment  -  plaintext, identity verification stubs
  if (!existingNames.has('partyAuthenticationAssessment') || reset) {
    if (existingNames.has('partyAuthenticationAssessment') && reset) {
      await db.collection('partyAuthenticationAssessment').drop();
      console.log('  dropped: partyAuthenticationAssessment');
    }
    await db.createCollection('partyAuthenticationAssessment');
    console.log('  created: partyAuthenticationAssessment');
  } else {
    console.log('  skip:    partyAuthenticationAssessment (already exists)');
  }

  // SD-88: Payment Card Registry  -  plaintext, the physical card deduplicated by token (no CHD)
  if (!existingNames.has('paymentCardRegistry') || reset) {
    if (existingNames.has('paymentCardRegistry') && reset) {
      await db.collection('paymentCardRegistry').drop();
      console.log('  dropped: paymentCardRegistry');
    }
    await db.createCollection('paymentCardRegistry');
    console.log('  created: paymentCardRegistry');
  } else {
    console.log('  skip:    paymentCardRegistry (already exists)');
  }

  // SD-83: Fraud Diagnosis Case  -  plaintext, no QE
  if (!existingNames.has('fraudDiagnosisCase') || reset) {
    if (existingNames.has('fraudDiagnosisCase') && reset) {
      await db.collection('fraudDiagnosisCase').drop();
      console.log('  dropped: fraudDiagnosisCase');
    }
    await db.createCollection('fraudDiagnosisCase');
    console.log('  created: fraudDiagnosisCase');
  } else {
    console.log('  skip:    fraudDiagnosisCase (already exists)');
  }

  // SD-83: Fraud Diagnosis Case Events  -  plaintext, append-only audit log
  if (!existingNames.has('fraudDiagnosisCaseEvents') || reset) {
    if (existingNames.has('fraudDiagnosisCaseEvents') && reset) {
      await db.collection('fraudDiagnosisCaseEvents').drop();
    }
    await db.createCollection('fraudDiagnosisCaseEvents');
    console.log('  created: fraudDiagnosisCaseEvents');
  } else {
    console.log('  skip:    fraudDiagnosisCaseEvents (already exists)');
  }

  // SD-83: Customer Questions  -  plaintext (no CHD), investigator questions + immutable responses
  if (!existingNames.has('fraudDiagnosisCustomerQuestion') || reset) {
    if (existingNames.has('fraudDiagnosisCustomerQuestion') && reset) {
      await db.collection('fraudDiagnosisCustomerQuestion').drop();
    }
    await db.createCollection('fraudDiagnosisCustomerQuestion');
    console.log('  created: fraudDiagnosisCustomerQuestion');
  } else {
    console.log('  skip:    fraudDiagnosisCustomerQuestion (already exists)');
  }

  // SD-60: Customer Credit Rating State  -  plaintext, classification metadata, no PII
  if (!existingNames.has('customerCreditRatingState') || reset) {
    if (existingNames.has('customerCreditRatingState') && reset) {
      await db.collection('customerCreditRatingState').drop();
      console.log('  dropped: customerCreditRatingState');
    }
    await db.createCollection('customerCreditRatingState');
    console.log('  created: customerCreditRatingState');
  } else {
    console.log('  skip:    customerCreditRatingState (already exists)');
  }

  // Open Banking: Consent Agreement  -  plaintext, no CHD or PII stored here
  if (!existingNames.has('consentAgreement') || reset) {
    if (existingNames.has('consentAgreement') && reset) {
      await db.collection('consentAgreement').drop();
      console.log('  dropped: consentAgreement');
    }
    await db.createCollection('consentAgreement');
    console.log('  created: consentAgreement');
  } else {
    console.log('  skip:    consentAgreement (already exists)');
  }

  // Open Banking: Consent Access Log  -  plaintext, append-only TPP access audit
  if (!existingNames.has('consentAccessLog') || reset) {
    if (existingNames.has('consentAccessLog') && reset) {
      await db.collection('consentAccessLog').drop();
      console.log('  dropped: consentAccessLog');
    }
    await db.createCollection('consentAccessLog');
    console.log('  created: consentAccessLog');
  } else {
    console.log('  skip:    consentAccessLog (already exists)');
  }

  // SD-89: Merchant Agreement Procedure  -  plaintext (API key stored as bcrypt hash)
  if (!existingNames.has('merchantAgreementProcedure') || reset) {
    if (existingNames.has('merchantAgreementProcedure') && reset) {
      await db.collection('merchantAgreementProcedure').drop();
      console.log('  dropped: merchantAgreementProcedure');
    }
    await db.createCollection('merchantAgreementProcedure');
    console.log('  created: merchantAgreementProcedure');
  } else {
    console.log('  skip:    merchantAgreementProcedure (already exists)');
  }

  // SD-64: Checkout Session Log  -  plaintext (TTL-indexed, 30-min session lifecycle)
  if (!existingNames.has('checkoutSessionLog') || reset) {
    if (existingNames.has('checkoutSessionLog') && reset) {
      await db.collection('checkoutSessionLog').drop();
      console.log('  dropped: checkoutSessionLog');
    }
    await db.createCollection('checkoutSessionLog');
    console.log('  created: checkoutSessionLog');
  } else {
    console.log('  skip:    checkoutSessionLog (already exists)');
  }

  // SD-64: Payment Link Record  -  plaintext (unique short code, optional TTL)
  if (!existingNames.has('paymentLinkRecord') || reset) {
    if (existingNames.has('paymentLinkRecord') && reset) {
      await db.collection('paymentLinkRecord').drop();
      console.log('  dropped: paymentLinkRecord');
    }
    await db.createCollection('paymentLinkRecord');
    console.log('  created: paymentLinkRecord');
  } else {
    console.log('  skip:    paymentLinkRecord (already exists)');
  }

  // SD-89: Merchant Agreement Events  -  plaintext, append-only lifecycle audit (ADR-025 fix)
  if (!existingNames.has('merchantAgreementEvents') || reset) {
    if (existingNames.has('merchantAgreementEvents') && reset) {
      await db.collection('merchantAgreementEvents').drop();
      console.log('  dropped: merchantAgreementEvents');
    }
    await db.createCollection('merchantAgreementEvents');
    console.log('  created: merchantAgreementEvents');
  } else {
    console.log('  skip:    merchantAgreementEvents (already exists)');
  }

  // SD-193: External Provider Arrangement Action Log  -  timeseries, TTL 90 days (ADR-025).
  // Timeseries collections cannot be converted; drop + recreate always on reset.
  // Renamed from legacy 'integrationEvents'.)
  if (existingNames.has('integrationEvents')) {
    await db.collection('integrationEvents').drop().catch(() => {});
    console.log('  dropped: integrationEvents (legacy → externalProviderArrangementActionLog)');
  }
  // Drop legacy non-timeseries collections renamed to BIAN names (data is re-seeded
  // into the new names from JSON). Makes setup on an OLD database migrate cleanly without orphans.
  for (const legacy of ['integrationRegistry', 'integrationRoutingGroups']) {
    if (existingNames.has(legacy)) {
      await db.collection(legacy).drop().catch(() => {});
      console.log(`  dropped: ${legacy} (legacy → BIAN-renamed)`);
    }
  }
  if (!existingNames.has('externalProviderArrangementActionLog') || reset) {
    if (existingNames.has('externalProviderArrangementActionLog') && reset) {
      await db.collection('externalProviderArrangementActionLog').drop();
      console.log('  dropped: externalProviderArrangementActionLog (timeseries migration)');
    }
    await db.createCollection('externalProviderArrangementActionLog', {
      timeseries: {
        timeField: 'recordCreatedDateTime',
        metaField: 'externalProviderArrangementInstanceReference',
        granularity: 'hours',
      },
      expireAfterSeconds: 7776000, // 90 days
    });
    console.log('  created: externalProviderArrangementActionLog (timeseries, TTL 90d)');
  } else {
    console.log('  skip:    externalProviderArrangementActionLog (already exists)');
  }

  // ADR-025: Business Process Events  -  timeseries, TTL 90 days (transactional processes)
  if (!existingNames.has('businessProcessEvent') || reset) {
    if (existingNames.has('businessProcessEvent') && reset) {
      await db.collection('businessProcessEvent').drop();
      console.log('  dropped: businessProcessEvent');
    }
    await db.createCollection('businessProcessEvent', {
      timeseries: {
        timeField: 'eventDateTime',
        metaField: 'processType',
        granularity: 'hours',
      },
      expireAfterSeconds: 7776000, // 90 days
    });
    console.log('  created: businessProcessEvent (timeseries, TTL 90d)');
  } else {
    console.log('  skip:    businessProcessEvent (already exists)');
  }

  // ADR-025: Compliance Process Events  -  timeseries, TTL 365 days (KYC/KYB regulatory)
  if (!existingNames.has('complianceProcessEvent') || reset) {
    if (existingNames.has('complianceProcessEvent') && reset) {
      await db.collection('complianceProcessEvent').drop();
      console.log('  dropped: complianceProcessEvent');
    }
    await db.createCollection('complianceProcessEvent', {
      timeseries: {
        timeField: 'eventDateTime',
        metaField: 'processType',
        granularity: 'hours',
      },
      expireAfterSeconds: 31536000, // 365 days
    });
    console.log('  created: complianceProcessEvent (timeseries, TTL 365d)');
  } else {
    console.log('  skip:    complianceProcessEvent (already exists)');
  }
}

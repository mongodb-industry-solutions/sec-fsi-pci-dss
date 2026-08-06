import { MongoClient, ClientEncryption } from 'mongodb';
import { buildKmsProviders, getKmsConfig } from '../encryption/kms';
import { buildEncryptedFieldsMaps } from '../encryption/encryptedFieldsMaps';
import { DEKs } from '../encryption/keyVault';
import { config } from '../../config';
import { MERCHANT_WEBHOOK_LOG_COLLECTION } from '../../modules/gateway/models/merchantWebhookLog.model';
import { PARTY_AUTH_CONSENT_COLLECTION } from '../../modules/identity/models/partyAuthConsent.model';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../modules/gateway/models/payoutAccount.model';
import { PAYMENT_EXECUTION_COLLECTION } from '../../modules/gateway/models/paymentExecution.model';
import { COUNTERPARTY_COLLECTION } from '../../modules/identity/models/counterpartyArrangement.model';
import { BALANCE_CREDIT_LOG_COLLECTION } from '../../modules/gateway/models/balanceCreditLog.model';
import { PARTY_ENROLLED_CREDENTIAL_COLLECTION } from '../../modules/identity/models/partyEnrolledCredential.model';
import { PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION } from '../../modules/identity/models/partyBackchannelAuthentication.model';
import { PAYMENT_REQUEST_COLLECTION } from '../../modules/gateway/models/paymentRequest.model';
import { PAYMENT_REQUEST_EVENT_COLLECTION } from '../../modules/gateway/models/paymentRequestEvent.model';
import { QR_REPRESENTATION_COLLECTION } from '../../modules/gateway/models/qrRepresentation.model';
import { RTP_ALIAS_DIRECTORY_CACHE_COLLECTION } from '../../modules/gateway/models/rtpAliasDirectoryCache.model';
import { DEMO_TEAM_CONTACT_COLLECTION } from '../../modules/system/models/demoTeamContact.model';

const kmsConfig = getKmsConfig();

export async function createCollections(
  client: MongoClient,
  deks: DEKs,
  reset = false
) {
  const dbName = config.mongodb.dbName;
  const db = client.db(dbName);
  const maps = buildEncryptedFieldsMaps(deks);

  const clientEncryption = new ClientEncryption(client, {
    keyVaultNamespace: kmsConfig.namespace,
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
    // Card Administration (issuer CDE, v30): module-owned vault with the full PAN + service code
    // (QE:equality). The PSP core NEVER holds these; extracting the module leaves the core descoped.
    { name: 'cardIssuerVault',                  map: maps.cardIssuerVault },
    // SD-91: Customer Authentication
    { name: 'customerAuthenticationAssessment', map: maps.customerAuthenticationAssessment },
    // SD-66: Payout Account Arrangement (IBAN/routing QE:none, L2 only, PCI DSS Req 3.3)
    ...(maps.payoutAccountArrangement
      ? [{ name: PAYOUT_ACCOUNT_COLLECTION, map: maps.payoutAccountArrangement }]
      : [{ name: PAYOUT_ACCOUNT_COLLECTION, map: { fields: [] } }]
    ),
    // SD-65: Payment Execution Procedure (destinationIban QE:none, L2 only, GDPR Art. 32 / PSD2)
    ...(maps.paymentExecutionProcedure
      ? [{ name: PAYMENT_EXECUTION_COLLECTION, map: maps.paymentExecutionProcedure }]
      : [{ name: PAYMENT_EXECUTION_COLLECTION, map: { fields: [] } }]
    ),
    // SD-65 (v28): Request to Pay canonical record. Alias/remittance/address/payee-name QE:none, L2 only
    // (GDPR minimization). RTP is account/alias-based → OUTSIDE PCI scope (no PAN/CHD).
    ...(maps.paymentRequestProcedure
      ? [{ name: PAYMENT_REQUEST_COLLECTION, map: maps.paymentRequestProcedure }]
      : [{ name: PAYMENT_REQUEST_COLLECTION, map: { fields: [] } }]
    ),
  ];

  let existingList = await db.listCollections().toArray();

  // Self-healing: an encrypted collection the code now wants plaintext breaks its TTL index (6346501).
  const wantsQe = new Set(qeCollections.map((c) => c.name));
  for (const c of existingList) {
    const isEncrypted = Boolean((c as { options?: { encryptedFields?: unknown } }).options?.encryptedFields);
    if (wantsQe.has(c.name) || !isEncrypted) continue;
    await db.collection(c.name).drop();
    for (const suffix of ['esc', 'ecoc']) {
      await db.collection(`enxcol_.${c.name}.${suffix}`).drop().catch(() => { /* absent */ });
    }
    console.log(`  dropped: ${c.name} (was encrypted, code wants plaintext)`);
  }
  existingList = await db.listCollections().toArray();

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

    const provider = config.kms.provider;
    const masterKey =
      config.kms.provider !== 'local'
        ? { key: config.kms.awsCmkArn!, region: config.kms.awsRegion }
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

  // ADR-031: Notifications  -  plaintext (no CHD), per-party with read/unread state
  if (!existingNames.has('notification') || reset) {
    if (existingNames.has('notification') && reset) {
      await db.collection('notification').drop();
    }
    await db.createCollection('notification');
    console.log('  created: notification');
  } else {
    console.log('  skip:    notification (already exists)');
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

  // Demo-only (no BIAN service domain): IST team contact points for the "About us" page.
  // Plaintext, no CHD and no customer PII. Contents are inserted directly (no seeder).
  if (!existingNames.has(DEMO_TEAM_CONTACT_COLLECTION) || reset) {
    if (existingNames.has(DEMO_TEAM_CONTACT_COLLECTION) && reset) {
      await db.collection(DEMO_TEAM_CONTACT_COLLECTION).drop();
      console.log(`  dropped: ${DEMO_TEAM_CONTACT_COLLECTION}`);
    }
    await db.createCollection(DEMO_TEAM_CONTACT_COLLECTION);
    console.log(`  created: ${DEMO_TEAM_CONTACT_COLLECTION} (demo metadata, team contacts)`);
  } else {
    console.log(`  skip:    ${DEMO_TEAM_CONTACT_COLLECTION} (already exists)`);
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

  // dev.v8: unified Event Store (EDA backbone). Regular collection (NOT timeseries) so it can carry
  // a UNIQUE index on eventId for idempotency. Holds every DomainEvent, correlated by correlationId.
  if (!existingNames.has('domainEvent') || reset) {
    if (existingNames.has('domainEvent') && reset) {
      await db.collection('domainEvent').drop();
      console.log('  dropped: domainEvent');
    }
    await db.createCollection('domainEvent');
    console.log('  created: domainEvent (event store)');
  } else {
    console.log('  skip:    domainEvent (already exists)');
  }

  // v16 (ADR-036): SD-16 RSA public key registry, public keys only, never private. JWKS + rotation audit.
  if (!existingNames.has('partyAuthenticationKey') || reset) {
    if (existingNames.has('partyAuthenticationKey') && reset) {
      await db.collection('partyAuthenticationKey').drop();
      console.log('  dropped: partyAuthenticationKey');
    }
    await db.createCollection('partyAuthenticationKey');
    console.log('  created: partyAuthenticationKey (OAuth RS256 public key registry)');
  } else {
    console.log('  skip:    partyAuthenticationKey (already exists)');
  }

  // v16 (ADR-033): SD-16 OAuth 2.0 authorization codes, TTL 5 minutes (expiresAt index)
  if (!existingNames.has('partyAuthorizationCode') || reset) {
    if (existingNames.has('partyAuthorizationCode') && reset) {
      await db.collection('partyAuthorizationCode').drop();
      console.log('  dropped: partyAuthorizationCode');
    }
    await db.createCollection('partyAuthorizationCode');
    console.log('  created: partyAuthorizationCode (OAuth auth codes, TTL 5min)');
  } else {
    console.log('  skip:    partyAuthorizationCode (already exists)');
  }

  // v16 (ADR-033): SD-16 Issued OAuth tokens, refresh tokens + revocation registry. TTL on expiresAt.
  if (!existingNames.has('partyIssuedToken') || reset) {
    if (existingNames.has('partyIssuedToken') && reset) {
      await db.collection('partyIssuedToken').drop();
      console.log('  dropped: partyIssuedToken');
    }
    await db.createCollection('partyIssuedToken');
    console.log('  created: partyIssuedToken (OAuth refresh tokens + revocation registry)');
  } else {
    console.log('  skip:    partyIssuedToken (already exists)');
  }

  // v16 (ADR-038): SD-16 PartyAuthentication, ConsentGrant, per-user per-client consent with revocation support.
  if (!existingNames.has(PARTY_AUTH_CONSENT_COLLECTION) || reset) {
    if (existingNames.has(PARTY_AUTH_CONSENT_COLLECTION) && reset) {
      await db.collection(PARTY_AUTH_CONSENT_COLLECTION).drop();
      console.log(`  dropped: ${PARTY_AUTH_CONSENT_COLLECTION}`);
    }
    await db.createCollection(PARTY_AUTH_CONSENT_COLLECTION);
    console.log(`  created: ${PARTY_AUTH_CONSENT_COLLECTION} (consent grants; user-authorized apps registry)`);
  } else {
    console.log(`  skip:    ${PARTY_AUTH_CONSENT_COLLECTION} (already exists)`);
  }

  // SD-91/SD-16: PartyEnrolledCredential, user authenticator registry (public keys only, no CHD).
  if (!existingNames.has(PARTY_ENROLLED_CREDENTIAL_COLLECTION) || reset) {
    if (existingNames.has(PARTY_ENROLLED_CREDENTIAL_COLLECTION) && reset) {
      await db.collection(PARTY_ENROLLED_CREDENTIAL_COLLECTION).drop();
      console.log(`  dropped: ${PARTY_ENROLLED_CREDENTIAL_COLLECTION}`);
    }
    await db.createCollection(PARTY_ENROLLED_CREDENTIAL_COLLECTION);
    console.log(`  created: ${PARTY_ENROLLED_CREDENTIAL_COLLECTION} (passwordless credentials, public keys only)`);
  } else {
    console.log(`  skip:    ${PARTY_ENROLLED_CREDENTIAL_COLLECTION} (already exists)`);
  }

  // SD-91: PartyBackchannelAuthentication, CIBA auth_req_id lifecycle (TTL-expiring, one-time).
  if (!existingNames.has(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION) || reset) {
    if (existingNames.has(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION) && reset) {
      await db.collection(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION).drop();
      console.log(`  dropped: ${PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION}`);
    }
    await db.createCollection(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION);
    console.log(`  created: ${PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION} (CIBA backchannel requests, TTL)`);
  } else {
    console.log(`  skip:    ${PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION} (already exists)`);
  }

  // merchantWebhookDeliveryLog: persisted delivery attempt records (ADR-038)
  const logColls = await db.listCollections({ name: MERCHANT_WEBHOOK_LOG_COLLECTION }).toArray();
  if (logColls.length === 0) {
    await db.createCollection(MERCHANT_WEBHOOK_LOG_COLLECTION);
    console.log(`  created: ${MERCHANT_WEBHOOK_LOG_COLLECTION}`);
  } else {
    console.log(`  skip:    ${MERCHANT_WEBHOOK_LOG_COLLECTION} (already exists)`);
  }

  // SD-65: Payment Execution Procedure, created above as a QE-encrypted collection
  // (destinationIban QE:none). See the qeCollections loop; no plaintext creation here.

  // SD-54: Counterparty Arrangement, plaintext (beneficiary registry, no raw PII stored)
  if (!existingNames.has(COUNTERPARTY_COLLECTION) || reset) {
    if (existingNames.has(COUNTERPARTY_COLLECTION) && reset) {
      await db.collection(COUNTERPARTY_COLLECTION).drop();
      console.log(`  dropped: ${COUNTERPARTY_COLLECTION}`);
    }
    await db.createCollection(COUNTERPARTY_COLLECTION);
    console.log(`  created: ${COUNTERPARTY_COLLECTION} (SD-54 beneficiary registry)`);
  } else {
    console.log(`  skip:    ${COUNTERPARTY_COLLECTION} (already exists)`);
  }

  if (!existingNames.has(BALANCE_CREDIT_LOG_COLLECTION) || reset) {
    if (existingNames.has(BALANCE_CREDIT_LOG_COLLECTION) && reset) {
      await db.collection(BALANCE_CREDIT_LOG_COLLECTION).drop();
      console.log(`  dropped: ${BALANCE_CREDIT_LOG_COLLECTION}`);
    }
    await db.createCollection(BALANCE_CREDIT_LOG_COLLECTION);
    console.log(`  created: ${BALANCE_CREDIT_LOG_COLLECTION} (SD-66 balance credit audit log, PCI DSS Req 10)`);
  } else {
    console.log(`  skip:    ${BALANCE_CREDIT_LOG_COLLECTION} (already exists)`);
  }

  // SD-65 (v28): QR Payment Representation, plaintext. No QE: TTL forbids it (v35 CH-1).
  if (!existingNames.has(QR_REPRESENTATION_COLLECTION) || reset) {
    if (existingNames.has(QR_REPRESENTATION_COLLECTION) && reset) {
      await db.collection(QR_REPRESENTATION_COLLECTION).drop();
      console.log(`  dropped: ${QR_REPRESENTATION_COLLECTION}`);
    }
    await db.createCollection(QR_REPRESENTATION_COLLECTION);
    console.log(`  created: ${QR_REPRESENTATION_COLLECTION} (SD-65 shared QR capability)`);
  } else {
    console.log(`  skip:    ${QR_REPRESENTATION_COLLECTION} (already exists)`);
  }

  // Directory Entry (v28): RTP alias resolution cache, plaintext (aliasHash only, no plaintext alias)
  if (!existingNames.has(RTP_ALIAS_DIRECTORY_CACHE_COLLECTION) || reset) {
    if (existingNames.has(RTP_ALIAS_DIRECTORY_CACHE_COLLECTION) && reset) {
      await db.collection(RTP_ALIAS_DIRECTORY_CACHE_COLLECTION).drop();
      console.log(`  dropped: ${RTP_ALIAS_DIRECTORY_CACHE_COLLECTION}`);
    }
    await db.createCollection(RTP_ALIAS_DIRECTORY_CACHE_COLLECTION);
    console.log(`  created: ${RTP_ALIAS_DIRECTORY_CACHE_COLLECTION} (RTP alias directory cache, TTL)`);
  } else {
    console.log(`  skip:    ${RTP_ALIAS_DIRECTORY_CACHE_COLLECTION} (already exists)`);
  }

  // SD-65 (v28): Payment Request Event, timeseries, TTL 365 days (per-request lifecycle trail).
  // Timeseries collections cannot be converted; drop + recreate always on reset.
  if (!existingNames.has(PAYMENT_REQUEST_EVENT_COLLECTION) || reset) {
    if (existingNames.has(PAYMENT_REQUEST_EVENT_COLLECTION) && reset) {
      await db.collection(PAYMENT_REQUEST_EVENT_COLLECTION).drop();
      console.log(`  dropped: ${PAYMENT_REQUEST_EVENT_COLLECTION}`);
    }
    await db.createCollection(PAYMENT_REQUEST_EVENT_COLLECTION, {
      timeseries: {
        timeField: 'eventDateTime',
        metaField: 'paymentRequestInstanceReference',
        granularity: 'hours',
      },
      expireAfterSeconds: 31536000, // 365 days
    });
    console.log(`  created: ${PAYMENT_REQUEST_EVENT_COLLECTION} (timeseries, TTL 365d)`);
  } else {
    console.log(`  skip:    ${PAYMENT_REQUEST_EVENT_COLLECTION} (already exists)`);
  }
}

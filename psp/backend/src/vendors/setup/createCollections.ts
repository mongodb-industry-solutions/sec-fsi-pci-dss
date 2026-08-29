import { MongoClient, ClientEncryption } from 'mongodb';
import { buildKmsProviders, getKmsConfig } from '../encryption/kms';
import { buildEncryptedFieldsMaps } from '../encryption/encryptedFieldsMaps';
import { DEKs } from '../encryption/keyVault';
import { config } from '../../config';
import { MERCHANT_WEBHOOK_LOG_COLLECTION } from '../../modules/gateway/models/merchantWebhookLog.model';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../modules/gateway/models/payoutAccount.model';
import { PAYMENT_EXECUTION_COLLECTION } from '../../modules/gateway/models/paymentExecution.model';
import { COUNTERPARTY_COLLECTION } from '../../modules/customer/models/counterpartyArrangement.model';
import { PAYMENT_REQUEST_COLLECTION } from '../../modules/gateway/models/paymentRequest.model';
import { PAYMENT_REQUEST_EVENT_COLLECTION } from '../../modules/gateway/models/paymentRequestEvent.model';
import { QR_REPRESENTATION_COLLECTION } from '../../modules/gateway/models/qrRepresentation.model';
import { RTP_ALIAS_DIRECTORY_CACHE_COLLECTION } from '../../modules/gateway/models/rtpAliasDirectoryCache.model';
import { DEMO_TEAM_CONTACT_COLLECTION } from '../../modules/system/models/demoTeamContact.model';
import { CARD_AUTHORIZATION_COLLECTION } from '../../modules/gateway/models/cardAuthorization.model';
import { PAYMENT_ORDER_COLLECTION } from '../../modules/gateway/models/paymentOrder.model';

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
    // Party Data Management  -  canonical PII store
    { name: 'party',                            map: maps.party },
    // Card Transaction Log (includes sensitive gateway fields in unified doc)
    { name: 'cardTransactionLog',               map: maps.cardTransactionLog },
    // Customer Agreement Procedure (includes sensitive address/govId in unified doc)
    { name: 'customerAgreementProcedure',       map: maps.customerAgreementProcedure },
    // Payment Card Management
    { name: 'paymentCardManagement',            map: maps.paymentCardManagement },
    // v37: the issuer vault moved to the bank, so no collection here holds a PAN.
    // Customer Authentication
    // Payout Account Arrangement (IBAN/routing QE:none, L2 only, PCI DSS)
    ...(maps.payoutAccountArrangement
      ? [{ name: PAYOUT_ACCOUNT_COLLECTION, map: maps.payoutAccountArrangement }]
      : [{ name: PAYOUT_ACCOUNT_COLLECTION, map: { fields: [] } }]
    ),
    // Payment Execution Procedure (destinationIban QE:none, L2 only, GDPR Art. 32 / PSD2)
    ...(maps.paymentExecutionProcedure
      ? [{ name: PAYMENT_EXECUTION_COLLECTION, map: maps.paymentExecutionProcedure }]
      : [{ name: PAYMENT_EXECUTION_COLLECTION, map: { fields: [] } }]
    ),
    // (v28): Request to Pay canonical record. Alias/remittance/address/payee-name QE:none, L2 only
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

  // v39: authenticationDomain belonged to the login screen and moved with it. A realm at the
  // authority is what a domain used to be, plus the key boundary a domain never had.



  // Payment Card Registry  -  plaintext, the physical card deduplicated by token (no CHD)
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

  // Fraud Diagnosis Case  -  plaintext, no QE
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

  // Fraud Diagnosis Case Events  -  plaintext, append-only audit log
  if (!existingNames.has('fraudDiagnosisCaseEvents') || reset) {
    if (existingNames.has('fraudDiagnosisCaseEvents') && reset) {
      await db.collection('fraudDiagnosisCaseEvents').drop();
    }
    await db.createCollection('fraudDiagnosisCaseEvents');
    console.log('  created: fraudDiagnosisCaseEvents');
  } else {
    console.log('  skip:    fraudDiagnosisCaseEvents (already exists)');
  }

  // Customer Questions  -  plaintext (no CHD), investigator questions + immutable responses
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

  // Customer Credit Rating State  -  plaintext, classification metadata, no PII
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

  // Payment Order Procedure  -  plaintext order record, no CHD. v37: like the two below it was created
  // implicitly by its first insert, so it had no indexes and no --reset path.
  if (!existingNames.has(PAYMENT_ORDER_COLLECTION) || reset) {
    if (existingNames.has(PAYMENT_ORDER_COLLECTION) && reset) {
      await db.collection(PAYMENT_ORDER_COLLECTION).drop();
      console.log(`  dropped: ${PAYMENT_ORDER_COLLECTION}`);
    }
    await db.createCollection(PAYMENT_ORDER_COLLECTION);
    console.log(`  created: ${PAYMENT_ORDER_COLLECTION} (merchant payment orders)`);
  } else {
    console.log(`  skip:    ${PAYMENT_ORDER_COLLECTION} (already exists)`);
  }

  // Counters  -  sequence generator for human-readable references (case numbers, order numbers).
  // NOT dropped on reset: dropping it would restart every sequence and collide with existing
  // references that are already in the seeded data.
  if (!existingNames.has('counters')) {
    await db.createCollection('counters');
    console.log('  created: counters (reference sequences)');
  } else {
    console.log('  skip:    counters (already exists; never dropped, sequences must not restart)');
  }

  // Card Authorization Record  -  plaintext, ISO 8583 response codes, no CHD.
  // v37: was never declared here and got created implicitly by its first insert, so it had no indexes
  // and no --reset path. P7 moves it to the issuer, and it should start from a declared state.
  if (!existingNames.has(CARD_AUTHORIZATION_COLLECTION) || reset) {
    if (existingNames.has(CARD_AUTHORIZATION_COLLECTION) && reset) {
      await db.collection(CARD_AUTHORIZATION_COLLECTION).drop();
      console.log(`  dropped: ${CARD_AUTHORIZATION_COLLECTION}`);
    }
    await db.createCollection(CARD_AUTHORIZATION_COLLECTION);
    console.log(`  created: ${CARD_AUTHORIZATION_COLLECTION} (card authorisation decisions)`);
  } else {
    console.log(`  skip:    ${CARD_AUTHORIZATION_COLLECTION} (already exists)`);
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

  // Merchant Agreement Procedure  -  plaintext, and no longer a credential store
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

  // v39 P2: the OAuth client registry and the integration keys, out of the commercial record and
  // into collections of their own. A credential the authorization server verifies on every token
  // request has no business living inside a document the gateway module owns, and an unbounded array
  // of keys inside a record read on every merchant lookup is the other half of the same mistake.
  for (const name of ['oauthClient', 'apiKey']) {
    if (!existingNames.has(name) || reset) {
      if (existingNames.has(name) && reset) {
        await db.collection(name).drop();
        console.log(`  dropped: ${name}`);
      }
      await db.createCollection(name);
      console.log(`  created: ${name}`);
    } else {
      console.log(`  skip:    ${name} (already exists)`);
    }
  }

  // Checkout Session Log  -  plaintext (TTL-indexed, 30-min session lifecycle)
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

  // Payment Link Record  -  plaintext (unique short code, optional TTL)
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

  // Merchant Agreement Events  -  plaintext, append-only lifecycle audit (ADR-025 fix)
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

  // External Provider Arrangement Action Log  -  timeseries, TTL 90 days (ADR-025).
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




  // v39: role, the party authentication assessment, authenticator keys, authorization codes and
  // issued tokens all moved to the identity authority. This service creates none of them, because a
  // place to write principals to is eventually written to.
  // v39: the consent, enrolled-credential and backchannel collections belong to the identity
  // authority and are created by its setup, in its database. Creating them here as well would leave
  // two stores that both look authoritative, and which one a reader trusts becomes an accident of
  // which they happened to open.

  // merchantWebhookDeliveryLog: persisted delivery attempt records (ADR-038)
  const logColls = await db.listCollections({ name: MERCHANT_WEBHOOK_LOG_COLLECTION }).toArray();
  if (logColls.length === 0) {
    await db.createCollection(MERCHANT_WEBHOOK_LOG_COLLECTION);
    console.log(`  created: ${MERCHANT_WEBHOOK_LOG_COLLECTION}`);
  } else {
    console.log(`  skip:    ${MERCHANT_WEBHOOK_LOG_COLLECTION} (already exists)`);
  }

  // Payment Execution Procedure, created above as a QE-encrypted collection
  // (destinationIban QE:none). See the qeCollections loop; no plaintext creation here.

  // Counterparty Arrangement, plaintext (beneficiary registry, no raw PII stored)
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

  // v37: collections that MOVED to the bank, or were retired in favour of a bank resource. They are
  // dropped rather than merely left unmanaged: a collection nothing writes and nobody owns is a ghost that
  // still answers a query, and the next person to find rows in it will reasonably believe they matter.
  //   · balanceCreditLog       → the bank's. The audit trail of a balance mutation belongs where the
  //                              balance does, and the balance moved in P2.
  //   · recurringMandateProcedure → retired. A standing order is `periodicPaymentProcedure` at the bank,
  //                              on Berlin Group's own resource.
  for (const movedToTheBank of ['balanceCreditLog', 'recurringMandateProcedure']) {
    if (existingNames.has(movedToTheBank)) {
      await db.collection(movedToTheBank).drop().catch(() => {});
      console.log(`  dropped: ${movedToTheBank} (moved to the bank)`);
    }
  }

  // (v28): QR Payment Representation, plaintext. No QE: TTL forbids it (v35 CH-1).
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

  // (v28): Payment Request Event, timeseries, TTL 365 days (per-request lifecycle trail).
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

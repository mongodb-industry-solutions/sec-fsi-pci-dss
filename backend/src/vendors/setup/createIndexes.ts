import { MongoClient, Db, IndexSpecification, CreateIndexesOptions, IndexDescription, MongoServerError } from 'mongodb';
import { MERCHANT_WEBHOOK_LOG_COLLECTION } from '../../modules/gateway/models/merchantWebhookLog.model';
import { PARTY_AUTH_CONSENT_COLLECTION } from '../../modules/identity/models/partyAuthConsent.model';
import { config } from '../../config';

// ── Self-healing index helpers ────────────────────────────────────────────────

/**
 * Creates a single index with two self-healing modes:
 *  - Code 85/86 (IndexOptionsConflict/IndexKeySpecsConflict): drops the stale
 *    index by name and recreates it with the correct spec.
 *  - E11000/11001 on a unique index: aggregates duplicates, keeps the oldest
 *    document per duplicate group (lowest _id), deletes the rest, then retries.
 */
async function ensureIndex(
  db: Db,
  collection: string,
  keySpec: IndexSpecification,
  options: CreateIndexesOptions = {},
): Promise<void> {
  try {
    await db.collection(collection).createIndex(keySpec, options);
  } catch (err) {
    const e = err as MongoServerError;

    if (e.code === 85 || e.code === 86) {
      // Index exists with wrong options — drop by auto-name and recreate.
      const autoName = Object.entries(keySpec as Record<string, unknown>)
        .map(([k, v]) => `${k}_${v}`)
        .join('_');
      const indexName = options.name ?? autoName;
      await db.collection(collection).dropIndex(indexName).catch(() => {});
      await db.collection(collection).createIndex(keySpec, options);
      console.log(`  repaired: ${collection}[${indexName}] options conflict → recreated`);
      return;
    }

    if ((e.code === 11000 || e.code === 11001) && options.unique) {
      // Unique index blocked by duplicate data.
      // Group documents by the unique key, keep the oldest (lowest _id), drop the rest.
      const fields = Object.keys(keySpec as Record<string, unknown>);
      const groupId =
        fields.length === 1
          ? `$${fields[0]}`
          : fields.reduce<Record<string, string>>((acc, f) => { acc[f] = `$${f}`; return acc; }, {});

      const groups = await db
        .collection(collection)
        .aggregate<{ _id: unknown; ids: unknown[]; count: number }>([
          { $group: { _id: groupId, ids: { $push: '$_id' }, count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
        ])
        .toArray();

      let removed = 0;
      for (const g of groups) {
        // Sort ascending so index-0 is the oldest ObjectId / earliest UUID.
        const sorted = (g.ids as unknown[]).sort((a, b) =>
          String(a).localeCompare(String(b)),
        );
        const [, ...toDelete] = sorted;
        if (toDelete.length) {
          // toDelete contains MongoDB _id values (ObjectId or string); cast needed for TS.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res = await db.collection(collection).deleteMany({ _id: { $in: toDelete as any[] } });
          removed += res.deletedCount;
        }
      }
      console.log(
        `  repaired: ${collection}.{${fields.join(', ')}} — removed ${removed} duplicate(s), retrying unique index`,
      );
      // Final attempt — let it throw if it still fails.
      await db.collection(collection).createIndex(keySpec, options);
      return;
    }

    throw e;
  }
}

/**
 * Creates a batch of indexes for one collection.  On any failure falls back to
 * per-index creation via ensureIndex so that every index gets individual
 * self-healing (options conflicts and duplicate-key repairs).
 */
async function ensureIndexes(
  db: Db,
  collection: string,
  indexes: IndexDescription[],
): Promise<void> {
  try {
    await db.collection(collection).createIndexes(indexes);
  } catch {
    // Batch failed — run each index individually so ensureIndex can self-heal.
    for (const idx of indexes) {
      const { key, ...opts } = idx;
      await ensureIndex(db, collection, key as IndexSpecification, opts as CreateIndexesOptions);
    }
  }
}

// ── Main index creation ───────────────────────────────────────────────────────

export async function createIndexes(client: MongoClient) {
  const db = client.db(config.mongodb.dbName);

  // SD-13: Party Data Management
  await ensureIndexes(db, 'party', [
    { key: { partyInstanceReference: 1 }, unique: true },
  ]);

  // SD-254: Card Transaction Log
  await ensureIndexes(db, 'cardTransactionLog', [
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },
    { key: { cardTransactionDateTime: -1 } },
    { key: { cardTransactionStatus: 1 } },
    { key: { merchantAgreementInstanceReference: 1, cardTransactionDateTime: -1 } },
  ]);

  // SD-53: Customer Agreement Procedure
  await ensureIndexes(db, 'customerAgreementProcedure', [
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
    { key: { customerAgreementStatus: 1 } },
  ]);

  // SD-88: Payment Card Management (the per-customer card-on-file arrangement).
  // A customer may hold a given card (token) only once → unique compound index dedups per customer.
  await ensureIndexes(db, 'paymentCardManagement', [
    { key: { paymentCardInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },
    { key: { customerAgreementInstanceReference: 1 } },
    { key: { customerAgreementInstanceReference: 1, paymentCardReference: 1 }, unique: true },
  ]);

  // SD-88: Payment Card Registry (the physical card, one per token). Token is the unique identity;
  // the holder array is indexed so "which cards does this customer hold" and FDS shared-card lookups
  // are fast.
  await ensureIndexes(db, 'paymentCardRegistry', [
    { key: { paymentCardReference: 1 }, unique: true },
    { key: { cardHolderAgreementReferences: 1 } },
    { key: { cardHolderCount: -1 } },
  ]);

  // SD-83: Fraud Diagnosis — instance reference (natural primary key)
  await ensureIndexes(db, 'fraudDiagnosisCase', [
    { key: { fraudDiagnosisInstanceReference: 1 }, unique: true },
    { key: { cardTransactionInstanceReference: 1 } },
    { key: { customerAgreementInstanceReference: 1 } },
    { key: { fraudDiagnosisCaseStatus: 1, fraudDiagnosisCaseSeverity: -1 } },
  ]);

  // SD-83: Fraud Diagnosis — human-readable business key (unique constraint).
  // ensureIndex deduplicates the collection automatically when E11000 occurs
  // (runtime-generated cases can share a reference if the counter is ever reset).
  await ensureIndex(
    db,
    'fraudDiagnosisCase',
    { fraudDiagnosisCaseReference: 1 },
    { unique: true },
  );

  await ensureIndexes(db, 'fraudDiagnosisCaseEvents', [
    { key: { fraudDiagnosisInstanceReference: 1, actionDateTime: -1 } },
  ]);

  // SD-83: Customer Questions (ADR-031)
  await ensureIndexes(db, 'fraudDiagnosisCustomerQuestion', [
    { key: { customerQuestionInstanceReference: 1 }, unique: true },
    { key: { cardTransactionInstanceReference: 1 } },
    { key: { fraudDiagnosisInstanceReference: 1, askedDateTime: -1 } },
    { key: { partyInstanceReference: 1, questionStatus: 1 } },
  ]);

  // ADR-031: Notifications (per-party, read/unread)
  await ensureIndexes(db, 'notification', [
    { key: { notificationInstanceReference: 1 }, unique: true },
    { key: { recipientPartyReference: 1, recordCreatedDateTime: -1 } },
    { key: { recipientPartyReference: 1, notificationStatus: 1 } },
    { key: { recipientPartyReference: 1, notificationType: 1, relatedReference: 1 } },
  ]);

  // dev.v8: Event Store (EDA). Unique eventId = idempotency; the rest power correlated trails,
  // per-business-process grouping and type/time queries for audit and investigation.
  await ensureIndexes(db, 'domainEvent', [
    { key: { eventId: 1 }, unique: true },
    { key: { correlationId: 1, occurredAt: 1 } },
    { key: { businessProcess: 1, occurredAt: -1 } },
    { key: { eventType: 1, occurredAt: -1 } },
    { key: { partitionKey: 1, occurredAt: 1 } },
  ]);

  // SD-91: Customer Authentication Assessment
  await ensureIndexes(db, 'customerAuthenticationAssessment', [
    { key: { customerAuthenticationInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
    { key: { customerAuthenticationUserRole: 1 } },
  ]);

  // SD-16: Party Authentication Assessment
  await ensureIndexes(db, 'partyAuthenticationAssessment', [
    { key: { partyAuthenticationInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
  ]);

  // Authentication Domain config
  await ensureIndexes(db, 'authenticationDomain', [
    { key: { partyAuthenticationDomainInstanceReference: 1 }, unique: true },
    { key: { partyAuthenticationDomainName: 1 }, unique: true },
    { key: { partyAuthenticationDomainEnabled: 1 } },
  ]);

  // ADR-030: RBAC role definitions (data-driven ACL)
  await ensureIndexes(db, 'role', [
    { key: { roleName: 1 }, unique: true },
    { key: { roleIsBuiltin: 1 } },
  ]);

  // SD-60: Customer Credit Rating State
  await ensureIndexes(db, 'customerCreditRatingState', [
    { key: { customerCreditRatingInstanceReference: 1 }, unique: true },
    { key: { customerAgreementReference: 1 } },
  ]);

  // Open Banking: Consent Agreement
  await ensureIndexes(db, 'consentAgreement', [
    { key: { consentAgreementInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
    { key: { consentRecipientIdentifier: 1 } },
    { key: { consentStatus: 1, consentExpiryDateTime: 1 } },
  ]);

  // Open Banking: Consent Access Log
  await ensureIndexes(db, 'consentAccessLog', [
    { key: { consentAccessLogInstanceReference: 1 }, unique: true },
    { key: { consentAgreementInstanceReference: 1, accessDateTime: -1 } },
    { key: { accessDateTime: -1 } },
  ]);

  // SD-89: Merchant Agreement Procedure
  await ensureIndexes(db, 'merchantAgreementProcedure', [
    { key: { merchantAgreementInstanceReference: 1 }, unique: true },
    { key: { merchantAgreementStatus: 1 } },
    { key: { merchantCategoryCode: 1 } },
    { key: { merchantOwnerPartyReference: 1 } },
  ]);

  // SD-89: Merchant lifecycle audit trail (append-only, PCI DSS Req 10)
  await ensureIndexes(db, 'merchantAgreementEvents', [
    { key: { merchantAgreementInstanceReference: 1, eventDateTime: 1 } },
  ]);

  // SD-64: Checkout Session Log (TTL on expiry field)
  await ensureIndexes(db, 'checkoutSessionLog', [
    { key: { checkoutSessionInstanceReference: 1 }, unique: true },
    { key: { merchantAgreementInstanceReference: 1 } },
    { key: { checkoutSessionMerchantReference: 1, merchantAgreementInstanceReference: 1 } },
    { key: { checkoutSessionExpiresAt: 1 }, expireAfterSeconds: 0 },
  ]);

  // SD-64: Payment Link Record
  await ensureIndexes(db, 'paymentLinkRecord', [
    { key: { paymentLinkInstanceReference: 1 }, unique: true },
    { key: { paymentLinkCode: 1 }, unique: true },
    { key: { merchantAgreementInstanceReference: 1 } },
    { key: { paymentLinkStatus: 1 } },
    { key: { paymentLinkExpiresAt: 1 }, expireAfterSeconds: 0, sparse: true },
  ]);

  // SD-193: External Provider Arrangement (Ch-07) — registry of providers/vendors
  // (dev.v7 Fase 2: renamed from legacy 'integrationRegistry').
  // Drop the old unique (type+endpoint) index if it still exists — replaced with non-unique
  // to support multi-provider configurations (ADR-010).
  await db.collection('externalProviderArrangement')
    .dropIndex('externalProviderArrangementType_1_externalProviderApiEndpoint_1')
    .catch(() => { /* index may not exist — safe to ignore */ });

  await ensureIndexes(db, 'externalProviderArrangement', [
    { key: { externalProviderArrangementInstanceReference: 1 }, unique: true },
    { key: { externalProviderArrangementType: 1, externalProviderArrangementStatus: 1 } },
    { key: { externalProviderIsInternal: 1 } },
    { key: { externalProviderArrangementType: 1, externalProviderApiEndpoint: 1 }, sparse: true },
    { key: { routingGroupId: 1 }, sparse: true },
    { key: { routingPriority: 1, externalProviderArrangementType: 1 } },
  ]);

  // SD-193: External Provider Arrangement Portfolio (Ch-07) — routing groups
  // (dev.v7 Fase 2: renamed from legacy 'integrationRoutingGroups').
  await ensureIndexes(db, 'externalProviderArrangementPortfolio', [
    { key: { routingGroupInstanceReference: 1 }, unique: true },
    { key: { routingGroupProviderType: 1, routingGroupStatus: 1 } },
    { key: { isDefaultGroup: 1 }, sparse: true },
  ]);

  // SD-193: External Provider Arrangement Action Log — timeseries (ADR-025)
  // (dev.v7 Fase 2: renamed from legacy 'integrationEvents').
  // TTL is managed by the timeseries collection definition; no manual TTL index needed.
  await ensureIndexes(db, 'externalProviderArrangementActionLog', [
    { key: { externalProviderArrangementInstanceReference: 1, recordCreatedDateTime: -1 } },
    { key: { integrationEventType: 1, recordCreatedDateTime: -1 } },
    { key: { 'businessContext.entityType': 1, 'businessContext.entityId': 1, recordCreatedDateTime: -1 }, sparse: true },
  ]).catch(() => { /* timeseries collection may not exist on the very first run */ });

  // dev.v7 Fase 2: capabilityModuleConfiguration — internal Module engine config (ADR-029).
  // Implicitly created here via createIndex; documents seeded in Fase 4.
  await ensureIndexes(db, 'capabilityModuleConfiguration', [
    { key: { capabilityModuleInstanceReference: 1 }, unique: true },
    { key: { capability: 1 }, unique: true },
    { key: { moduleDomain: 1 } },
  ]);

  // ADR-025: Business Process Events — timeseries
  await ensureIndexes(db, 'businessProcessEvent', [
    { key: { entityType: 1, entityId: 1, eventDateTime: -1 } },
    { key: { processType: 1, eventDateTime: -1 } },
    { key: { processAction: 1, processOutcome: 1 } },
  ]).catch(() => { /* timeseries collection may not exist on the very first run */ });

  // ADR-025: Compliance Process Events — timeseries
  await ensureIndexes(db, 'complianceProcessEvent', [
    { key: { entityType: 1, entityId: 1, eventDateTime: -1 } },
    { key: { processType: 1, eventDateTime: -1 } },
  ]).catch(() => { /* timeseries collection may not exist on the very first run */ });

  // v16 (ADR-036): SD-16 RSA public key registry — unique kid, status filter for JWKS
  await ensureIndexes(db, 'partyAuthenticationKey', [
    { key: { keyId: 1 }, unique: true },
    { key: { keyStatus: 1 } },
  ]);

  // v16 (ADR-033): SD-16 OAuth authorization codes — unique code, TTL 5min on expiresAt
  await ensureIndexes(db, 'partyAuthorizationCode', [
    { key: { code: 1 }, unique: true },
    { key: { clientId: 1 } },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ]);

  // v16 (ADR-033): SD-16 Issued OAuth tokens — unique tokenId, TTL on expiresAt, accessTokenJti lookup
  await ensureIndexes(db, 'partyIssuedToken', [
    { key: { tokenId: 1 }, unique: true },
    { key: { accessTokenJti: 1 }, sparse: true },
    { key: { clientId: 1, tokenType: 1 } },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ]);

  // v16 (ADR-037): OAuth client lookup on merchantAgreementProcedure
  await ensureIndex(
    db,
    'merchantAgreementProcedure',
    { 'merchantOAuthClient.oauthClientId': 1 },
    { sparse: true },
  );

  // v16 (ADR-038): SD-16 PartyAuthentication, ConsentGrant — unique per-user+client pair, sub lookup, revocation
  await ensureIndexes(db, PARTY_AUTH_CONSENT_COLLECTION, [
    { key: { consentId: 1 }, unique: true },
    { key: { partyAuthenticationInstanceReference: 1, oauthClientId: 1 }, unique: true },
    { key: { partyAuthenticationInstanceReference: 1, consentStatus: 1 } },
    { key: { oauthClientId: 1, consentStatus: 1 } },
  ]);

  // merchantWebhookDeliveryLog indexes (ADR-038)
  await ensureIndexes(db, MERCHANT_WEBHOOK_LOG_COLLECTION, [
    { key: { logId: 1 }, unique: true },
    { key: { merchantAgreementInstanceReference: 1, deliveredAt: -1 } },
    { key: { merchantAgreementInstanceReference: 1, webhookEventType: 1, deliveredAt: -1 } },
  ]);
}

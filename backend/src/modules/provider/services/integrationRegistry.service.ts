import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import {
  EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION,
  ExternalProviderArrangement,
  IntegrationSummary,
  IntegrationProviderType,
  IntegrationMode,
  IntegrationAuth,
  RetryPolicy,
  CategoryConfig,
  IntegrationAuthConfig,
  FieldMappingConfig,
} from '../models/externalProviderArrangement.model';
import { validateMappingRules, mayMapCardData } from './fieldMapping.service';
import { getDefaultGroupForType, addMemberToGroup } from './integrationRoutingGroup.service';

const BCRYPT_ROUNDS = 12;

function generateApiKey(): string {
  return randomBytes(32).toString('base64url');
}

function keyPrefix(plainKey: string): string {
  return plainKey.substring(0, 12) + '...';
}

export function stripSecrets(doc: ExternalProviderArrangement): IntegrationSummary {
  const { externalProviderApiKeyHash, externalProviderCallbackSecretHash, ...safe } = doc;
  void externalProviderApiKeyHash;
  void externalProviderCallbackSecretHash;
  return safe;
}

export interface CreateIntegrationInput {
  name: string;
  type: IntegrationProviderType;
  endpoint?: string;
  authScheme?: IntegrationAuth;
  apiKey?: string;
  callbackEnabled?: boolean;
  callbackSecret?: string;
  triggerEvents: string[];
  mode: IntegrationMode;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  categoryConfig?: CategoryConfig;
  authConfig?: IntegrationAuthConfig;
  fieldMappingConfig?: FieldMappingConfig;
  routingGroupId?: string;
  routingPriority?: number;
  routingWeight?: number;
  initialStatus?: 'active' | 'inactive' | 'test';
}

export async function createIntegration(
  db: Db,
  input: CreateIntegrationInput
): Promise<{ integration: IntegrationSummary; apiKey?: string }> {
  const col = db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION);

  // Validate field mapping rules for PCI DSS blocklist. Card issuer / card authorization connectors
  // may map cardholder data (they authorize the card); all other types may not.
  if (input.fieldMappingConfig) {
    const allowCardData = mayMapCardData(input.type);
    const errors = [
      ...validateMappingRules(input.fieldMappingConfig.outbound, { allowCardData }),
      ...validateMappingRules(input.fieldMappingConfig.inbound, { allowCardData }),
    ];
    if (errors.length > 0) {
      throw Object.assign(new Error(errors.join('; ')), { code: 422 });
    }
  }

  // Reject duplicate type+endpoint (non-unique index — check manually for better error message)
  if (input.endpoint) {
    const existing = await col.findOne({
      externalProviderArrangementType: input.type,
      externalProviderApiEndpoint: input.endpoint,
    });
    if (existing) throw Object.assign(new Error('duplicate'), { code: 409 });
  }

  const plainKey = input.apiKey ?? generateApiKey();
  const keyHash = await bcrypt.hash(plainKey, BCRYPT_ROUNDS);

  let callbackSecretHash: string | undefined;
  if (input.callbackEnabled && input.callbackSecret) {
    callbackSecretHash = await bcrypt.hash(input.callbackSecret, BCRYPT_ROUNDS);
  }

  const id = uuidv4();
  const now = new Date();
  const bianMeta = bianMetaFor(input.type);

  const record: ExternalProviderArrangement = {
    externalProviderArrangementInstanceReference: id,
    externalProviderArrangementName: input.name,
    externalProviderArrangementType: input.type,
    externalProviderArrangementStatus: input.initialStatus ?? 'inactive',
    externalProviderIsInternal: false,
    externalProviderApiEndpoint: input.endpoint,
    externalProviderApiKeyHash: keyHash,
    externalProviderApiKeyPrefix: keyPrefix(plainKey),
    externalProviderAuthScheme: input.authScheme ?? 'bearer',
    externalProviderCallbackEnabled: input.callbackEnabled ?? false,
    externalProviderCallbackPath: input.callbackEnabled
      ? `/webhooks/${input.type}/${id}/callback`
      : undefined,
    externalProviderCallbackSecretHash: callbackSecretHash,
    externalProviderTriggerEvents: input.triggerEvents,
    externalProviderMode: input.mode,
    externalProviderTimeoutMs: input.timeoutMs ?? 5000,
    externalProviderRetryPolicy: input.retryPolicy ?? { maxAttempts: 3, backoffMs: 1000 },
    externalProviderHealthStatus: 'unknown',
    categoryConfig: input.categoryConfig,
    authConfig: input.authConfig,
    fieldMappingConfig: input.fieldMappingConfig,
    routingGroupId: input.routingGroupId,
    routingPriority: input.routingPriority ?? 100,
    routingWeight: input.routingWeight,
    bianServiceDomain: bianMeta.domain,
    bianControlRecordType: bianMeta.controlRecordType,
    pciDssRequirements: bianMeta.pciDss,
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 2,
  };

  await col.insertOne(record);

  // Auto-join to default group unless caller provided an explicit routingGroupId
  if (!input.routingGroupId) {
    const defaultGroup = await getDefaultGroupForType(db, input.type);
    if (defaultGroup) {
      // Next available priority = max external priority in group + 10, minimum 10
      const externalMembers = defaultGroup.routingGroupMembers.filter(m => m.memberPriority < 999);
      const maxPriority = externalMembers.length > 0
        ? Math.max(...externalMembers.map(m => m.memberPriority))
        : 0;
      const nextPriority = maxPriority + 10;
      await addMemberToGroup(db, defaultGroup.routingGroupInstanceReference, id, nextPriority);
      record.routingGroupId = defaultGroup.routingGroupInstanceReference;
      record.routingPriority = nextPriority;
    }
  }

  return { integration: stripSecrets(record), apiKey: plainKey };
}

export async function getIntegration(
  db: Db,
  id: string
): Promise<IntegrationSummary | null> {
  const doc = await db
    .collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION)
    .findOne({ externalProviderArrangementInstanceReference: id });
  return doc ? stripSecrets(doc) : null;
}

export async function listIntegrations(
  db: Db,
  filter?: { type?: IntegrationProviderType; status?: string }
): Promise<IntegrationSummary[]> {
  const query: Record<string, unknown> = {};
  if (filter?.type)   query['externalProviderArrangementType']   = filter.type;
  if (filter?.status) query['externalProviderArrangementStatus'] = filter.status;

  const docs = await db
    .collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION)
    .find(query)
    .sort({ recordCreatedDateTime: 1 })
    .toArray();

  return docs.map(stripSecrets);
}

type UpdateablePatch = Partial<Pick<
  ExternalProviderArrangement,
  | 'externalProviderApiEndpoint'
  | 'externalProviderTriggerEvents'
  | 'externalProviderEvents'
  | 'externalProviderMode'
  | 'externalProviderTimeoutMs'
  | 'externalProviderRetryPolicy'
  | 'externalProviderArrangementStatus'
  | 'externalProviderCallbackEnabled'
  | 'externalProviderCallbackPath'
  | 'categoryConfig'
  | 'authConfig'
  | 'fieldMappingConfig'
  | 'routingGroupId'
  | 'routingPriority'
  | 'routingWeight'
>>;

export async function updateIntegration(
  db: Db,
  id: string,
  patch: UpdateablePatch
): Promise<IntegrationSummary | null> {
  const col = db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION);

  // Validate field mapping rules if being updated. Card-data mapping is allowed only for the card
  // issuer / card authorization connector (decided by the existing provider's type).
  if (patch.fieldMappingConfig) {
    const existing = await col.findOne(
      { externalProviderArrangementInstanceReference: id },
      { projection: { _id: 0, externalProviderArrangementType: 1 } },
    );
    const allowCardData = mayMapCardData(existing?.externalProviderArrangementType);
    const errors = [
      ...validateMappingRules(patch.fieldMappingConfig.outbound, { allowCardData }),
      ...validateMappingRules(patch.fieldMappingConfig.inbound, { allowCardData }),
    ];
    if (errors.length > 0) {
      throw Object.assign(new Error(errors.join('; ')), { code: 422 });
    }
  }

  const result = await col.findOneAndUpdate(
    { externalProviderArrangementInstanceReference: id },
    { $set: { ...patch, recordUpdatedDateTime: new Date() } },
    { returnDocument: 'after' }
  );
  return result ? stripSecrets(result) : null;
}

export async function rotateKey(
  db: Db,
  id: string
): Promise<{ integration: IntegrationSummary; apiKey: string } | null> {
  const col = db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION);
  const doc = await col.findOne({ externalProviderArrangementInstanceReference: id });
  if (!doc) return null;
  if (doc.externalProviderIsInternal) throw Object.assign(new Error('internal providers do not use API keys'), { code: 400 });

  const plainKey = generateApiKey();
  const keyHash  = await bcrypt.hash(plainKey, BCRYPT_ROUNDS);

  const result = await col.findOneAndUpdate(
    { externalProviderArrangementInstanceReference: id },
    { $set: { externalProviderApiKeyHash: keyHash, externalProviderApiKeyPrefix: keyPrefix(plainKey), recordUpdatedDateTime: new Date() } },
    { returnDocument: 'after' }
  );
  return result ? { integration: stripSecrets(result), apiKey: plainKey } : null;
}

export async function suspendIntegration(
  db: Db,
  id: string
): Promise<IntegrationSummary | null> {
  const col = db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION);
  const doc = await col.findOne({ externalProviderArrangementInstanceReference: id });
  if (!doc) return null;
  if (doc.externalProviderIsInternal) throw Object.assign(new Error('internal providers cannot be suspended'), { code: 400 });

  const result = await col.findOneAndUpdate(
    { externalProviderArrangementInstanceReference: id },
    { $set: { externalProviderArrangementStatus: 'suspended', recordUpdatedDateTime: new Date() } },
    { returnDocument: 'after' }
  );
  return result ? stripSecrets(result) : null;
}

export async function deleteIntegration(
  db: Db,
  id: string
): Promise<boolean> {
  const col = db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION);
  const doc = await col.findOne({ externalProviderArrangementInstanceReference: id });
  if (!doc) return false;
  if (doc.externalProviderIsInternal)
    throw Object.assign(new Error('Built-in providers cannot be deleted'), { code: 400 });
  await col.deleteOne({ externalProviderArrangementInstanceReference: id });
  return true;
}

export async function verifyApiKey(
  db: Db,
  id: string,
  plainKey: string
): Promise<boolean> {
  const doc = await db
    .collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION)
    .findOne({ externalProviderArrangementInstanceReference: id });
  if (!doc?.externalProviderApiKeyHash) return false;
  return bcrypt.compare(plainKey, doc.externalProviderApiKeyHash);
}

// Returns the single active provider for a type (internal-first, then external by priority)
export async function getActiveProviderForType(
  db: Db,
  type: IntegrationProviderType
): Promise<ExternalProviderArrangement | null> {
  const providers = await getActiveProvidersForType(db, type);
  return providers[0] ?? null;
}

// Returns all active providers for a type, sorted by priority (internal first, then by routingPriority ASC)
export async function getActiveProvidersForType(
  db: Db,
  type: IntegrationProviderType
): Promise<ExternalProviderArrangement[]> {
  const docs = await db
    .collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION)
    .find({
      externalProviderArrangementType: type,
      externalProviderArrangementStatus: 'active',
    })
    .toArray();

  // Sort: internal providers first, then by routingPriority (lower = higher priority)
  return docs.sort((a, b) => {
    if (a.externalProviderIsInternal && !b.externalProviderIsInternal) return -1;
    if (!a.externalProviderIsInternal && b.externalProviderIsInternal) return 1;
    return (a.routingPriority ?? 100) - (b.routingPriority ?? 100);
  });
}

export async function updateHealthStatus(
  db: Db,
  id: string,
  status: 'ok' | 'degraded' | 'unreachable' | 'unknown'
): Promise<void> {
  await db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).updateOne(
    { externalProviderArrangementInstanceReference: id },
    { $set: { externalProviderHealthStatus: status, externalProviderLastHealthCheckAt: new Date(), recordUpdatedDateTime: new Date() } }
  );
}

export function bianMetaFor(type: IntegrationProviderType): { domain: string; controlRecordType: string; pciDss: string[] } {
  const map: Record<IntegrationProviderType, { domain: string; controlRecordType: string; pciDss: string[] }> = {
    fraud_detection:    { domain: 'Fraud Evaluation',                  controlRecordType: 'FraudEvaluationAssessment',                  pciDss: ['Req 10.2.1', 'Req 12.3.1'] },
    hrp_sanctions:      { domain: 'Party Reference Data',              controlRecordType: 'PartyReferenceDataDirectoryEntry',           pciDss: ['Req 12.8.1', 'Req 12.8.5'] },
    kyc_identity:       { domain: 'Customer Agreement',                 controlRecordType: 'CustomerAgreementProcedure',                 pciDss: ['Req 8.1', 'Req 12.8.1'] },
    kyb_business:       { domain: 'Merchant Relations',                 controlRecordType: 'MerchantAgreementProcedure',                 pciDss: ['Req 12.8.1', 'Req 12.8.3'] },
    aml_monitoring:     { domain: 'Suspicious Activity Analysis',       controlRecordType: 'SuspiciousActivityAnalysisAssessment',       pciDss: ['Req 10.2.1', 'Req 12.3.1'] },
    credit_bureau:      { domain: 'Customer Credit Rating',             controlRecordType: 'CustomerCreditRatingState',                  pciDss: ['Req 12.8.1'] },
    card_authorization: { domain: 'Card Authorization',                 controlRecordType: 'CardAuthorizationRecord',                    pciDss: ['Req 3.3.1', 'Req 10.2.1'] },
    card_issuer:        { domain: 'Payment Card',                       controlRecordType: 'PaymentCardProcedure',                        pciDss: ['Req 3.3.1', 'Req 3.5.1', 'Req 8.3.6'] },
    account_information: { domain: 'SD-36 Open Banking',               controlRecordType: 'AccountInformationValidation',               pciDss: ['Req 12.8.1', 'Req 10.2.1'] },
    payment_initiation:  { domain: 'SD-65 Payment Execution',          controlRecordType: 'PaymentExecutionProcedure',                  pciDss: ['Req 12.8.1', 'Req 10.2.1'] },
    currency_exchange:   { domain: 'SD-66 Payment Initiation',          controlRecordType: 'CurrencyExchangeConversion',                 pciDss: ['Req 10.2.1'] },
    generic:            { domain: 'External Provider Arrangements',     controlRecordType: 'ExternalProviderArrangementPortfolio',       pciDss: ['Req 12.8.1'] },
  };
  return map[type];
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

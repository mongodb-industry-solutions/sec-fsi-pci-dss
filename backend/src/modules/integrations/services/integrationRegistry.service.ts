import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import {
  INTEGRATION_REGISTRY_COLLECTION,
  ExternalProviderArrangement,
  IntegrationSummary,
  IntegrationProviderType,
  IntegrationMode,
  IntegrationAuth,
  RetryPolicy,
} from '../models/externalProviderArrangement.model';

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
}

export async function createIntegration(
  db: Db,
  input: CreateIntegrationInput
): Promise<{ integration: IntegrationSummary; apiKey?: string }> {
  const col = db.collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION);

  // Reject duplicate type+endpoint
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
    externalProviderArrangementStatus: 'inactive',
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
    bianServiceDomain: bianMeta.domain,
    bianControlRecordType: bianMeta.controlRecordType,
    pciDssRequirements: bianMeta.pciDss,
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  await col.insertOne(record);
  return { integration: stripSecrets(record), apiKey: plainKey };
}

export async function getIntegration(
  db: Db,
  id: string
): Promise<IntegrationSummary | null> {
  const doc = await db
    .collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION)
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
    .collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION)
    .find(query)
    .sort({ recordCreatedDateTime: 1 })
    .toArray();

  return docs.map(stripSecrets);
}

export async function updateIntegration(
  db: Db,
  id: string,
  patch: Partial<Pick<
    ExternalProviderArrangement,
    | 'externalProviderApiEndpoint'
    | 'externalProviderTriggerEvents'
    | 'externalProviderMode'
    | 'externalProviderTimeoutMs'
    | 'externalProviderRetryPolicy'
    | 'externalProviderArrangementStatus'
  >>
): Promise<IntegrationSummary | null> {
  const col = db.collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION);
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
  const col = db.collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION);
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
  const col = db.collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION);
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

export async function verifyApiKey(
  db: Db,
  id: string,
  plainKey: string
): Promise<boolean> {
  const doc = await db
    .collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION)
    .findOne({ externalProviderArrangementInstanceReference: id });
  if (!doc?.externalProviderApiKeyHash) return false;
  return bcrypt.compare(plainKey, doc.externalProviderApiKeyHash);
}

export async function getActiveProviderForType(
  db: Db,
  type: IntegrationProviderType
): Promise<ExternalProviderArrangement | null> {
  return db.collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION).findOne({
    externalProviderArrangementType: type,
    externalProviderArrangementStatus: 'active',
  });
}

export async function updateHealthStatus(
  db: Db,
  id: string,
  status: 'ok' | 'degraded' | 'unreachable' | 'unknown'
): Promise<void> {
  await db.collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION).updateOne(
    { externalProviderArrangementInstanceReference: id },
    { $set: { externalProviderHealthStatus: status, externalProviderLastHealthCheckAt: new Date(), recordUpdatedDateTime: new Date() } }
  );
}

function bianMetaFor(type: IntegrationProviderType): { domain: string; controlRecordType: string; pciDss: string[] } {
  const map: Record<IntegrationProviderType, { domain: string; controlRecordType: string; pciDss: string[] }> = {
    fraud_detection: { domain: 'Fraud Evaluation',                  controlRecordType: 'FraudEvaluationAssessment',                  pciDss: ['Req 10.2.1', 'Req 12.3.1'] },
    hrp_sanctions:   { domain: 'Party Reference Data',              controlRecordType: 'PartyReferenceDataDirectoryEntry',           pciDss: ['Req 12.8.1', 'Req 12.8.5'] },
    kyc_identity:    { domain: 'Customer Agreement',                 controlRecordType: 'CustomerAgreementProcedure',                 pciDss: ['Req 8.1', 'Req 12.8.1'] },
    kyb_business:    { domain: 'Merchant Relations',                 controlRecordType: 'MerchantAgreementProcedure',                 pciDss: ['Req 12.8.1', 'Req 12.8.3'] },
    aml_monitoring:  { domain: 'Suspicious Activity Analysis',       controlRecordType: 'SuspiciousActivityAnalysisAssessment',       pciDss: ['Req 10.2.1', 'Req 12.3.1'] },
    credit_bureau:   { domain: 'Customer Credit Rating',             controlRecordType: 'CustomerCreditRatingState',                  pciDss: ['Req 12.8.1'] },
  };
  return map[type];
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

import { Db } from 'mongodb';
import { createHmac, timingSafeEqual } from 'crypto';
import { INTEGRATION_REGISTRY_COLLECTION, ExternalProviderArrangement } from '../models/externalProviderArrangement.model';
import { logEvent } from './integrationDispatch.service';
import { applyMappings } from './fieldMapping.service';

export function verifyHmacSignature(
  secret: string,
  bodyRaw: string,
  signatureHeader: string
): boolean {
  try {
    const expected = 'sha256=' + createHmac('sha256', secret).update(bodyRaw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function validateCallback(
  db: Db,
  arrangementId: string,
  bodyRaw: string,
  signatureHeader: string | undefined
): Promise<{ valid: boolean; provider?: ExternalProviderArrangement; errorCode?: number }> {
  if (!signatureHeader) return { valid: false, errorCode: 401 };

  const provider = await db
    .collection<ExternalProviderArrangement>(INTEGRATION_REGISTRY_COLLECTION)
    .findOne({ externalProviderArrangementInstanceReference: arrangementId });

  if (!provider) return { valid: false, errorCode: 404 };
  if (!provider.externalProviderCallbackEnabled) return { valid: false, errorCode: 400 };
  if (!provider.externalProviderCallbackSecretHash) return { valid: false, errorCode: 400 };

  // Demo simplification: use arrangement ID as HMAC secret.
  // Production: retrieve from AWS Secrets Manager.
  const demoSecret = arrangementId;
  const valid = verifyHmacSignature(demoSecret, bodyRaw, signatureHeader);

  return { valid, provider: valid ? provider : undefined, errorCode: valid ? undefined : 401 };
}

// Apply inbound field mapping rules to a callback body
function applyInboundMapping(
  provider: ExternalProviderArrangement,
  body: Record<string, unknown>
): Record<string, unknown> {
  const rules = provider.fieldMappingConfig?.inbound;
  if (!rules || rules.length === 0) return body;
  return applyMappings(body, rules);
}

export async function processFdsCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: { fraudScore: number; recommendation: string; caseId?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  const mapped = applyInboundMapping(provider, body as unknown as Record<string, unknown>) as typeof body;

  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.fds.callback',
    payload: mapped as unknown as Record<string, unknown>,
    latencyMs: 0,
  });

  if (mapped.caseId) {
    await db.collection('fraudDiagnosisCase').updateOne(
      { fraudDiagnosisInstanceReference: mapped.caseId },
      {
        $set: {
          externalFraudScore: mapped.fraudScore,
          externalFraudRecommendation: mapped.recommendation,
          externalFraudProvider: provider.externalProviderArrangementName,
          recordUpdatedDateTime: new Date(),
        },
      }
    );
  }
}

export async function processAmlCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: { alertType: string; severity: string; entities: string[]; caseId?: string }
): Promise<void> {
  const mapped = applyInboundMapping(provider, body as unknown as Record<string, unknown>) as typeof body;

  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.aml.callback',
    payload: mapped as unknown as Record<string, unknown>,
    latencyMs: 0,
  });
}

export async function processKycCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: { status: 'verified' | 'rejected' | 'expired'; agreementRef: string; reference?: string }
): Promise<void> {
  const mapped = applyInboundMapping(provider, body as unknown as Record<string, unknown>) as typeof body;

  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.kyc.callback',
    payload: mapped as unknown as Record<string, unknown>,
    latencyMs: 0,
  });

  await db.collection('customerAgreementProcedure').updateOne(
    { customerAgreementInstanceReference: mapped.agreementRef },
    {
      $set: {
        'customerAgreementKycCheck.customerAgreementKycCheckStatus': mapped.status,
        'customerAgreementKycCheck.customerAgreementKycCheckReference': mapped.reference ?? provider.externalProviderArrangementName,
        'customerAgreementKycCheck.customerAgreementKycCheckCompletedDate': new Date().toISOString(),
        recordUpdatedDateTime: new Date(),
      },
    }
  );
}

export async function processKybCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: { status: 'verified' | 'rejected' | 'expired'; merchantRef: string; reference?: string }
): Promise<void> {
  const mapped = applyInboundMapping(provider, body as unknown as Record<string, unknown>) as typeof body;

  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.kyb.callback',
    payload: mapped as unknown as Record<string, unknown>,
    latencyMs: 0,
  });

  await db.collection('merchantAgreementProcedure').updateOne(
    { merchantAgreementInstanceReference: mapped.merchantRef },
    {
      $set: {
        'merchantAgreementKybCheck.merchantAgreementKybCheckStatus': mapped.status,
        'merchantAgreementKybCheck.merchantAgreementKybCheckReference': mapped.reference ?? provider.externalProviderArrangementName,
        'merchantAgreementKybCheck.merchantAgreementKybCheckCompletedDate': new Date().toISOString(),
        recordUpdatedDateTime: new Date(),
      },
    }
  );
}

export async function processHrpCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: { hrpcMatch: boolean; flags: string[]; accountRef: string }
): Promise<void> {
  const mapped = applyInboundMapping(provider, body as unknown as Record<string, unknown>) as typeof body;

  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.hrp.callback',
    payload: mapped as unknown as Record<string, unknown>,
    latencyMs: 0,
  });
}

export async function processGenericCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: Record<string, unknown>
): Promise<void> {
  const mapped = applyInboundMapping(provider, body);

  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.generic.callback',
    payload: mapped,
    latencyMs: 0,
  });
}

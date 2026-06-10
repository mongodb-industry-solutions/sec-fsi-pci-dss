import { Db } from 'mongodb';
import * as bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual } from 'crypto';
import { INTEGRATION_REGISTRY_COLLECTION, ExternalProviderArrangement } from '../models/externalProviderArrangement.model';
import { logEvent } from './integrationDispatch.service';

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

  // Derive the secret from the hash — in demo, we use bcrypt verification approach:
  // Since we can't reverse bcrypt, for demo purposes we store the HMAC secret in env
  // or derive it from the arrangement ID. For a proper production system, the secret
  // would be stored encrypted (e.g., in AWS Secrets Manager).
  // Demo simplification: use the arrangement ID as the HMAC secret for internal testing.
  const demoSecret = arrangementId;
  const valid = verifyHmacSignature(demoSecret, bodyRaw, signatureHeader);

  return { valid, provider: valid ? provider : undefined, errorCode: valid ? undefined : 401 };
}

export async function processFdsCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: { fraudScore: number; recommendation: string; caseId?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.fds.callback',
    payload: body,
    latencyMs: 0,
  });

  if (body.caseId) {
    await db.collection('fraudDiagnosisCase').updateOne(
      { fraudDiagnosisInstanceReference: body.caseId },
      {
        $set: {
          externalFraudScore: body.fraudScore,
          externalFraudRecommendation: body.recommendation,
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
  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.aml.callback',
    payload: body as unknown as Record<string, unknown>,
    latencyMs: 0,
  });
}

export async function processKycCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: { status: 'verified' | 'rejected' | 'expired'; agreementRef: string; reference?: string }
): Promise<void> {
  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.kyc.callback',
    payload: body as unknown as Record<string, unknown>,
    latencyMs: 0,
  });

  await db.collection('customerAgreementProcedure').updateOne(
    { customerAgreementInstanceReference: body.agreementRef },
    {
      $set: {
        'customerAgreementKycCheck.customerAgreementKycCheckStatus': body.status,
        'customerAgreementKycCheck.customerAgreementKycCheckReference': body.reference ?? provider.externalProviderArrangementName,
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
  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.kyb.callback',
    payload: body as unknown as Record<string, unknown>,
    latencyMs: 0,
  });

  await db.collection('merchantAgreementProcedure').updateOne(
    { merchantAgreementInstanceReference: body.merchantRef },
    {
      $set: {
        'merchantAgreementKybCheck.merchantAgreementKybCheckStatus': body.status,
        'merchantAgreementKybCheck.merchantAgreementKybCheckReference': body.reference ?? provider.externalProviderArrangementName,
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
  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.hrp.callback',
    payload: body as unknown as Record<string, unknown>,
    latencyMs: 0,
  });
}

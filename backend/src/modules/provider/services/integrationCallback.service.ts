import { Db } from 'mongodb';
import { createHmac, timingSafeEqual } from 'crypto';
import { EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION, ExternalProviderArrangement } from '../models/externalProviderArrangement.model';
import { logEvent } from './integrationDispatch.service';
import { applyMappings } from './fieldMapping.service';
import { createNotification } from '../../notification/notifications.service';
import { getEventBus, makeEvent } from '../../../vendors/eventbus';
import { resolvePendingCorrelation, clearPendingCorrelation } from './pendingCorrelation.service';

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
    .collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION)
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
    // Inbound capture (PCI DSS Req 10.7): method + received body. Raw request headers are also
    // recorded by the webhook inspector that receives the call.
    request: { method: 'POST', body: mapped },
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
    // Inbound capture (PCI DSS Req 10.7): method + received body. Raw request headers are also
    // recorded by the webhook inspector that receives the call.
    request: { method: 'POST', body: mapped },
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
    // Inbound capture (PCI DSS Req 10.7): method + received body. Raw request headers are also
    // recorded by the webhook inspector that receives the call.
    request: { method: 'POST', body: mapped },
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

  // Notify the customer when KYC is approved (ADR-031 account-status notification).
  if (mapped.status === 'verified') {
    const agreement = await db.collection('customerAgreementProcedure')
      .findOne<{ partyInstanceReference?: string }>({ customerAgreementInstanceReference: mapped.agreementRef });
    await createNotification(db, {
      recipientPartyReference: agreement?.partyInstanceReference ?? '',
      notificationType: 'kyc_status',
      title: 'Your identity verification (KYC) was approved',
      detail: 'Your identity check is complete and verified. Your account is fully enabled.',
      href: '/system/profile',
      relatedReference: `kyc-${mapped.agreementRef}`,
      actionable: false,
    }).catch(() => { /* non-blocking */ });
  }
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
    // Inbound capture (PCI DSS Req 10.7): method + received body. Raw request headers are also
    // recorded by the webhook inspector that receives the call.
    request: { method: 'POST', body: mapped },
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

  // Notify the merchant owner when KYB is approved (ADR-031 account-status notification).
  if (mapped.status === 'verified') {
    const merchant = await db.collection('merchantAgreementProcedure')
      .findOne<{ merchantOwnerPartyReference?: string; merchantName?: string }>({ merchantAgreementInstanceReference: mapped.merchantRef });
    await createNotification(db, {
      recipientPartyReference: merchant?.merchantOwnerPartyReference ?? '',
      notificationType: 'kyb_status',
      title: 'Your business verification (KYB) was approved',
      detail: `Your merchant${merchant?.merchantName ? ` "${merchant.merchantName}"` : ''} passed KYB verification and can now accept payments.`,
      href: `/system/merchant/${mapped.merchantRef}`,
      relatedReference: `kyb-${mapped.merchantRef}`,
      actionable: false,
    }).catch(() => { /* non-blocking */ });
  }
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
    // Inbound capture (PCI DSS Req 10.7): method + received body. Raw request headers are also
    // recorded by the webhook inspector that receives the call.
    request: { method: 'POST', body: mapped },
  });
}

export async function processCardAuthorizationCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: { authorizationResult: string; cardTransactionInstanceReference?: string; responseCode: string }
): Promise<void> {
  const mapped = applyInboundMapping(provider, body as unknown as Record<string, unknown>) as typeof body;

  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.card_authorization.callback',
    payload: mapped as unknown as Record<string, unknown>,
    latencyMs: 0,
    // Inbound capture (PCI DSS Req 10.7): method + received body. Raw request headers are also
    // recorded by the webhook inspector that receives the call.
    request: { method: 'POST', body: mapped },
  });
}

export async function processCardIssuerCallback(
  db: Db,
  provider: ExternalProviderArrangement,
  body: { responseCode: string; cvvValidationResult?: string; pinValidationResult?: string; cardTransactionInstanceReference?: string; transactionId?: string; actionConfirmed?: boolean }
): Promise<void> {
  const mapped = applyInboundMapping(provider, body as unknown as Record<string, unknown>) as typeof body;

  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'callback',
    status: 'received',
    triggeredBy: 'external.card_issuer.callback',
    payload: mapped as unknown as Record<string, unknown>,
    latencyMs: 0,
    // Inbound capture (PCI DSS Req 10.7): method + received body. Raw request headers are also
    // recorded by the webhook inspector that receives the call.
    request: { method: 'POST', body: mapped },
  });

  // dev.v8 F3: a real ASYNC issuer posts its decision here. Funnel it into the same event the saga
  // consumes (card.issuer.validation.completed), so external and internal issuers drive one flow.
  const txnId = mapped.cardTransactionInstanceReference ?? mapped.transactionId;
  if (txnId) {
    const approved = mapped.actionConfirmed ?? (mapped.responseCode === '00' || mapped.responseCode === '0000');
    // §7.7: restore the full envelope (causationId + businessProcess) from the pending-correlation
    // entry recorded at dispatch; fall back to defaults if the entry has lapsed/was swept.
    const pending = resolvePendingCorrelation(txnId);
    void getEventBus().publish(makeEvent({
      eventType: 'card.issuer.validation.completed',
      correlationId: txnId,
      businessProcess: 'card_payment',
      source: 'callback.card-issuer',
      ...(pending?.causationId ? { causationId: pending.causationId } : {}),
      payload: { transactionId: txnId, outcome: approved ? 'approved' : 'declined', approved, responseCode: mapped.responseCode },
      bian: { serviceDomain: 'SD-88 Payment Card', controlRecord: 'PaymentCardValidation' },
    }));
    clearPendingCorrelation(txnId);
  }
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
    // Inbound capture (PCI DSS Req 10.7): method + received body. Raw request headers are also
    // recorded by the webhook inspector that receives the call.
    request: { method: 'POST', body: mapped },
  });
}

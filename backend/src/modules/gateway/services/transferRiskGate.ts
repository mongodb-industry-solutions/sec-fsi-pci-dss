// v17.1 (G4c): pre-initiation risk gate for bank transfers (/83/99).
// Runs FDS (fraud), HRP (sanctions) and AML monitoring through their providers BEFORE any funds
// move or any rail is engaged, and returns a hard block decision. Shared by the bank-transfer and
// P2P flows (DRY). Sanctions match and an FDS block recommendation are hard blocks; a high/critical
// AML alert is a hard block, lower AML alerts pass to post-initiation monitoring (P2PComplianceProcess).
//
// Providers are reached only through dispatchProvider (ADR-039): built-in or external, replaceable.

import { Db } from 'mongodb';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { createFraudCase } from '../../fraud/services/fraudDiagnosis.service';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';
import type { RiskSeverity } from '../../../shared/models/risk.model';
import type { TransactionSnapshot } from '../../../shared/models/transaction.model';

export interface TransferScreeningInput {
  transferRef: string;
  amount: number;
  currency: string;
  initiatorPartyRef?: string;
  sourceAccountRef?: string;
  destinationCountry?: string;
}

export interface TransferScreeningResult {
  blocked: boolean;
  indicators: string[];   // e.g. ['hrp.sanctions.match', 'fds.high.risk: velocity']
  score: number;          // FDS risk score (0 when unavailable)
  reason?: string;        // first human-readable block reason
}

export async function screenTransfer(
  db: Db,
  input: TransferScreeningInput,
): Promise<TransferScreeningResult> {
  const { transferRef, amount, currency, initiatorPartyRef, sourceAccountRef, destinationCountry } = input;

  const [fds, hrp, aml] = await Promise.allSettled([
    runFds(db, transferRef, amount, currency),
    runHrp(db, transferRef, initiatorPartyRef),
    runAml(db, transferRef, amount, sourceAccountRef, destinationCountry),
  ]);

  const fdsR = fds.status === 'fulfilled' ? fds.value : { flag: false, score: 0, reason: undefined as string | undefined };
  const hrpR = hrp.status === 'fulfilled' ? hrp.value : { match: false };
  const amlR = aml.status === 'fulfilled' ? aml.value : { alert: false, severity: undefined as string | undefined };

  const indicators: string[] = [];
  if (hrpR.match) indicators.push('hrp.sanctions.match');
  if (fdsR.flag) indicators.push(`fds.high.risk${fdsR.reason ? ': ' + fdsR.reason : ''}`);
  if (amlR.alert) indicators.push(`aml.alert${amlR.severity ? ': ' + amlR.severity : ''}`);

  // Hard block: sanctions match, FDS block, or a high/critical AML alert.
  const severe = amlR.severity === 'high' || amlR.severity === 'critical';
  const blocked = hrpR.match || fdsR.flag || (amlR.alert && severe);
  const reason = hrpR.match
    ? 'Sanctions screening match (HRP).'
    : fdsR.flag
      ? `Fraud risk block${fdsR.reason ? ': ' + fdsR.reason : ''} (FDS).`
      : (amlR.alert && severe)
        ? `AML alert (${amlR.severity}).`
        : undefined;

  return { blocked, indicators, score: fdsR.score, reason };
}

/**
 * Open a fraud investigation case (status 'open') for a transfer blocked by the risk gate, so an
 * L1 support analyst (level1_analyst) reviews it. Emits fraud.case.opened + a notification via
 * createFraudCase. Reused by the bank-transfer and P2P flows (DRY). Never throws.
 */
export async function openTransferFraudCase(
  db: Db,
  input: { transferRef: string; initiatorPartyRef?: string; indicators: string[]; score: number; amount: number; currency: string; destinationRef?: string },
): Promise<void> {
  try {
    const { transferRef, initiatorPartyRef, indicators, score, amount, currency, destinationRef } = input;
    // Resolve the initiator's customer agreement (falls back to the party ref).
    let customerRef = initiatorPartyRef ?? transferRef;
    if (initiatorPartyRef) {
      const agreement = await db.collection<{ customerAgreementInstanceReference: string }>(CUSTOMER_AGREEMENT_COLLECTION)
        .findOne({ partyInstanceReference: initiatorPartyRef }, { projection: { customerAgreementInstanceReference: 1 } });
      customerRef = agreement?.customerAgreementInstanceReference ?? initiatorPartyRef;
    }
    const severity: RiskSeverity = (score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 40 ? 'medium' : 'high') as RiskSeverity;
    const snapshot = {
      cardTransactionInstanceReference: transferRef,
      cardTransactionMaskedPanDisplay: 'Bank transfer',
      cardTransactionMerchantName: `Transfer → ${destinationRef?.slice(0, 8) ?? 'external account'}`,
      cardTransactionMerchantCategoryCode: '6012',
      cardTransactionAmount: { amount, currency },
      cardTransactionDateTime: new Date(),
      cardTransactionStatus: 'exception',
      cardTransactionChannel: 'transfer',
    } as unknown as TransactionSnapshot;
    await createFraudCase(db, transferRef, customerRef, indicators.length ? indicators : ['transfer.risk.block'], severity, snapshot, score);
  } catch { /* case-opening must never block the (already-blocked) transfer response */ }
}

async function runFds(db: Db, ref: string, amount: number, currency: string): Promise<{ flag: boolean; score: number; reason?: string }> {
  try {
    const r = await dispatchProvider(db, 'fraud_detection', 'fds.scoring.requested',
      { cardTransactionInstanceReference: ref, amount, currency, merchantName: 'Bank transfer' },
      { entityType: 'transaction', entityId: ref, processType: 'fraud_evaluation' });
    const b = r.responseBody as { riskScore?: number; recommendation?: string; fraudFlag?: boolean; reason?: string } | undefined;
    const flag = !!(b?.recommendation === 'block' || b?.recommendation === 'decline' || b?.fraudFlag);
    return { flag, score: b?.riskScore ?? 0, reason: b?.reason };
  } catch { return { flag: false, score: 0 }; }
}

async function runHrp(db: Db, ref: string, partyRef?: string): Promise<{ match: boolean }> {
  if (!partyRef) return { match: false };
  try {
    const r = await dispatchProvider(db, 'hrp_sanctions', 'hrp.screening.requested',
      { cardTransactionInstanceReference: ref, accountReference: partyRef },
      { entityType: 'transaction', entityId: ref, processType: 'aml_screening' });
    const b = r.responseBody as { hrpcMatch?: boolean; match?: boolean } | undefined;
    return { match: !!(b?.hrpcMatch ?? b?.match) };
  } catch { return { match: false }; }
}

async function runAml(db: Db, ref: string, amount: number, accountRef?: string, destinationCountry?: string): Promise<{ alert: boolean; severity?: string }> {
  try {
    const r = await dispatchProvider(db, 'aml_monitoring', 'aml.monitoring.requested',
      { cardTransactionInstanceReference: ref, amount, accountReference: accountRef, destinationCountry },
      { entityType: 'transaction', entityId: ref, processType: 'aml_screening' });
    const b = r.responseBody as { requiresReview?: boolean; alertLevel?: string; alert?: boolean; severity?: string } | undefined;
    const alert = !!(b?.requiresReview || (b?.alertLevel && b.alertLevel !== 'none') || b?.alert);
    return { alert, severity: b?.severity ?? b?.alertLevel };
  } catch { return { alert: false }; }
}

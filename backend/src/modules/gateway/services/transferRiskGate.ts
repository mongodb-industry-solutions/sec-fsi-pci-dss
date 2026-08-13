// v17.1 (G4c): pre-initiation risk gate for bank transfers.
// Runs FDS (fraud), HRP (sanctions) and AML monitoring through their providers BEFORE any funds move
// or any rail is engaged. Shared by the bank-transfer and P2P flows (DRY). ADR-059/060: a risk signal
// is never a hard block; it HOLDS the movement for investigation (funds immobilised, nothing delivered)
// until L1/L2 resolve the case. ADR-061: an AML alert of ANY severity holds, so nothing reaches the
// rail and is only reviewed afterwards. P2PComplianceProcess still runs post-initiation for a transfer
// that passed the gate and is flagged later.
//
// Providers are reached only through dispatchProvider (ADR-039): built-in or external, replaceable.

import { Db } from 'mongodb';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { createFraudCase } from '../../fraud/services/fraudDiagnosis.service';
import { FRAUD_DIAGNOSIS_COLLECTION, type FraudCaseTransactionKind } from '../../fraud/models/fraudDiagnosis.model';
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
  hold: boolean;          // a risk signal fired: hold the movement for investigation, never deliver it
  indicators: string[];   // e.g. ['hrp.sanctions.match', 'fds.high.risk: velocity']
  score: number;          // FDS risk score (0 when unavailable)
  reason?: string;        // first human-readable hold reason
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

  // Hold for investigation on ANY risk signal: sanctions match, FDS flag or an AML alert of any
  // severity. A pre-initiation alert holds the movement instead of letting it reach the rail and be
  // reviewed afterwards, so the money is always immobilised while the case is open.
  const hold = hrpR.match || fdsR.flag || amlR.alert;
  const reason = hrpR.match
    ? 'Sanctions screening match (HRP).'
    : fdsR.flag
      ? `Fraud risk${fdsR.reason ? ': ' + fdsR.reason : ''} (FDS).`
      : amlR.alert
        ? `AML alert${amlR.severity ? ` (${amlR.severity})` : ''}.`
        : undefined;

  return { hold, indicators, score: fdsR.score, reason };
}

/**
 * Open a fraud investigation case (status 'open') for a transfer blocked by the risk gate, so an
 * L1 support analyst (level1_analyst) reviews it. Emits fraud.case.opened + a notification via
 * createFraudCase. Reused by the bank-transfer and P2P flows (DRY). Never throws.
 */
export async function openTransferFraudCase(
  db: Db,
  input: {
    transferRef: string; initiatorPartyRef?: string; indicators: string[]; score: number;
    amount: number; currency: string; destinationRef?: string;
    // Movement kind, stamped on the case so the investigation read-model resolves the right
    // counterparty (a beneficiary or a payee, never an acquired merchant).
    kind?: FraudCaseTransactionKind;
    beneficiaryLabel?: string;
  },
): Promise<void> {
  try {
    const { transferRef, initiatorPartyRef, indicators, score, amount, currency, destinationRef } = input;
    const kind: FraudCaseTransactionKind = input.kind ?? 'bank_transfer';
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
      cardTransactionMerchantName: input.beneficiaryLabel
        ? `Transfer to ${input.beneficiaryLabel}`
        : `Transfer to ${destinationRef?.slice(0, 8) ?? 'external account'}`,
      cardTransactionMerchantCategoryCode: '6012',
      cardTransactionAmount: { amount, currency },
      cardTransactionDateTime: new Date(),
      cardTransactionStatus: 'exception',
      cardTransactionChannel: 'transfer',
    } as unknown as TransactionSnapshot;
    const created = await createFraudCase(db, transferRef, customerRef, indicators.length ? indicators : ['transfer.risk.block'], severity, snapshot, score);
    // Stamp the discriminator + execution/request link so the case is resolvable to its movement.
    await db.collection(FRAUD_DIAGNOSIS_COLLECTION).updateOne(
      { fraudDiagnosisInstanceReference: created.fraudDiagnosisInstanceReference },
      { $set: {
        transactionKind: kind,
        ...(kind === 'rtp' ? { paymentRequestInstanceReference: transferRef } : { paymentExecutionInstanceReference: transferRef }),
        recordUpdatedDateTime: new Date(),
      } },
    );
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

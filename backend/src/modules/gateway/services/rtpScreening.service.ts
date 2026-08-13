// v28 RTP screening: reuses the shared transferRiskGate (FDS + HRP + AML) and ADDS Verification of
// Payee (VoP) as an independent, additive check (ADR-v28-01). VoP does NOT replace FDS/HRP/AML; a
// VoP block only holds the request when policy makes it mandatory/blocking. All provider calls go
// through dispatchProvider (ADR-039). Runs at the accept step (and on demand via verify-payee).
import { Db } from 'mongodb';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { screenTransfer, openTransferFraudCase } from './transferRiskGate';
import { getPayoutAccount } from './payoutAccount.service';
import { config } from '../../../config';
import {
  PaymentRequestProcedure,
  PaymentRequestPolicyDecision,
} from '../models/paymentRequest.model';

export interface VopVerification {
  matchResult: 'match' | 'close_match' | 'no_match' | 'not_supported';
  matchScore: number;
  verifiedName?: string;
  decision: 'block' | 'warn' | 'pass';
  recommendation: string;
}

// Run VoP for a request: declared payee name vs the destination (payee receiving) account holder name.
export async function verifyPayeeForRequest(db: Db, req: PaymentRequestProcedure): Promise<VopVerification> {
  if (!config.rtp.vop) {
    return { matchResult: 'not_supported', matchScore: 0, decision: 'pass', recommendation: 'VoP disabled.' };
  }
  const account = await getPayoutAccount(db, req.payeeReceivingAccountReference);
  const countryCode = account?.payoutAccountCountryCode;
  try {
    const r = await dispatchProvider(db, 'vop_verification', 'vop.verification.requested', {
      declaredName: req.payeeName,
      accountHolderName: account?.payoutAccountHolderName,
      countryCode,
      amount: req.amount,
    }, { entityType: 'payment_request', entityId: req.paymentRequestInstanceReference, processType: 'aml_screening' });
    const b = r.responseBody as Partial<VopVerification> | undefined;
    return {
      matchResult: b?.matchResult ?? 'not_supported',
      matchScore: b?.matchScore ?? 0,
      verifiedName: b?.verifiedName,
      decision: b?.decision ?? 'pass',
      recommendation: b?.recommendation ?? 'VoP unavailable (advisory).',
    };
  } catch {
    return { matchResult: 'not_supported', matchScore: 0, decision: 'pass', recommendation: 'VoP transport error (advisory).' };
  }
}

export interface RtpScreeningResult {
  hold: boolean;              // risk signal: accept and hold the payment for investigation
  blocked: boolean;           // eligibility failure (VoP mismatch): the approval cannot proceed
  indicators: string[];
  score: number;
  reason?: string;
  decisions: PaymentRequestPolicyDecision[];
  vop: VopVerification;
}

// Full accept-time screening. FDS/HRP/AML block are hard blocks; VoP is additive (blocks only when its
// own decision is 'block', i.e. mandatory + non-match). Opens a fraud case on any hard block.
export async function screenRtpRequest(db: Db, req: PaymentRequestProcedure): Promise<RtpScreeningResult> {
  const payerAccount = req.payerFundingAccountReference;
  const [gate, vop] = await Promise.all([
    screenTransfer(db, {
      transferRef: req.paymentRequestInstanceReference,
      amount: req.amount,
      currency: req.currency,
      initiatorPartyRef: req.payerPartyReference,
      sourceAccountRef: payerAccount,
    }),
    verifyPayeeForRequest(db, req),
  ]);

  const now = new Date();
  const decisions: PaymentRequestPolicyDecision[] = [
    { policyType: 'fds', outcome: gate.indicators.some((i) => i.startsWith('fds')) ? 'flag' : 'clear', score: gate.score, decidedAt: now },
    { policyType: 'hrp', outcome: gate.indicators.includes('hrp.sanctions.match') ? 'match' : 'clear', decidedAt: now },
    { policyType: 'aml', outcome: gate.indicators.some((i) => i.startsWith('aml')) ? 'alert' : 'clear', decidedAt: now },
    { policyType: 'vop', outcome: vop.matchResult, score: vop.matchScore, reason: vop.recommendation, decidedAt: now },
  ];

  const vopBlocks = vop.decision === 'block';
  const indicators = [...gate.indicators, ...(vopBlocks ? [`vop.${vop.matchResult}`] : [])];
  // A risk signal holds the payment (accepted, funds reserved, nothing delivered); a VoP mismatch is an
  // eligibility failure and still rejects the approval outright (ADR-061).
  const hold = gate.hold;
  const blocked = vopBlocks;
  const reason = gate.reason ?? (vopBlocks ? `Verification of Payee ${vop.matchResult} (name mismatch).` : undefined);

  if (blocked || hold) {
    await openTransferFraudCase(db, {
      transferRef: req.paymentRequestInstanceReference,
      initiatorPartyRef: req.payerPartyReference,
      indicators,
      score: gate.score,
      amount: req.amount,
      currency: req.currency,
      destinationRef: req.payeeReceivingAccountReference,
    });
  }

  return { hold, blocked, indicators, score: gate.score, reason, decisions, vop };
}

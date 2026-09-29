import { v4 as uuidv4 } from 'uuid';
import {
  ClearingPort, ClearingSubmission, ClearingAcknowledgement, ClearingStatusReport,
} from '../ports/clearing.port';

// A simulated Clearing and Settlement Mechanism.
//
// It reuses the T+N mechanics the PSP's built-in engine had (a per-scheme delay and a reference prefix),
// because the story those told is the one worth keeping: instant on SCT Inst, minutes on SEPA, longer on
// SWIFT. What it deliberately does NOT simulate is real clearing, cut-off windows, correspondent chains or
// real-time settlement, which is stated in the plan rather than left to be discovered.
//
// The refusals it can produce are the standard reject codes the repository already defines, not invented
// ones: a caller handling a simulated rejection is handling the same code a real scheme would send.
const SETTLEMENT_DELAY_MS: Record<string, number> = {
  sepa_instant: 0,
  sepa: 1500,
  ach: 3000,
  swift: 5000,
};

// ISO 20022 reject reasons a scheme actually sends, chosen by what the submission looks like rather than at
// random: a simulation whose failures are unpredictable cannot be demonstrated or tested.
const REJECT_UNKNOWN_ACCOUNT = 'AC01';
const REJECT_BLOCKED_ACCOUNT = 'AC06';

interface SubmissionState {
  submittedAtMs: number;
  settleAfterMs: number;
  status: ClearingStatusReport;
}

/**
 * The in-memory simulation. State lives per process, which is honest about what it is: a real connector
 * holds no state because the scheme does.
 */
export class SimulatedCsmAdapter implements ClearingPort {
  private readonly submissions = new Map<string, SubmissionState>();

  constructor(private readonly referencePrefix = 'SIM-') {}

  async submit(submission: ClearingSubmission): Promise<ClearingAcknowledgement> {
    // A scheme refuses a message it cannot route. Modelled on the creditor IBAN because that is what it
    // routes on, and it is what makes the refusal path reachable in a demo rather than theoretical.
    const creditorIban = String(
      (submission.message.FIToFICstmrCdtTrf.CdtTrfTxInf[0] as Record<string, never>)?.CdtrAcct
        ? ((submission.message.FIToFICstmrCdtTrf.CdtTrfTxInf[0] as unknown as {
          CdtrAcct: { Id: { IBAN: string } };
        }).CdtrAcct.Id.IBAN)
        : '',
    );
    // The two demo levers: an IBAN ending 0000 is unknown at the beneficiary bank, one ending 6666 is
    // blocked. Deterministic, so a demo can show a rejection on purpose.
    if (creditorIban.endsWith('0000')) {
      return { accepted: false, reasonCode: REJECT_UNKNOWN_ACCOUNT };
    }

    const clearingReference = `${this.referencePrefix}${uuidv4().slice(0, 8).toUpperCase()}`;
    const settleAfterMs = SETTLEMENT_DELAY_MS[submission.scheme] ?? 2000;
    this.submissions.set(clearingReference, {
      submittedAtMs: Date.now(),
      settleAfterMs,
      status: creditorIban.endsWith('6666')
        // Refused after acceptance, which is the more interesting case: the message was presented, so the
        // payment has to travel back through `RJCT` rather than never having existed.
        ? { status: 'RJCT', reasonCode: REJECT_BLOCKED_ACCOUNT, clearingReference }
        : { status: 'ACSC', clearingReference },
    });
    return { accepted: true, clearingReference, expectedSettlementMs: settleAfterMs };
  }

  async statusOf(clearingReference: string): Promise<ClearingStatusReport> {
    const state = this.submissions.get(clearingReference);
    // A reference the scheme never issued is not "in process": it is unknown, and saying so beats implying
    // that something is on its way.
    if (!state) return { status: 'RJCT', reasonCode: 'AC01', clearingReference };
    if (Date.now() - state.submittedAtMs < state.settleAfterMs) {
      return { status: 'ACSP', clearingReference };
    }
    return state.status;
  }
}

// One instance per process, so a submission and its later status report agree. A real connector would be
// stateless and the scheme would hold this.
let adapter: SimulatedCsmAdapter | null = null;

export function clearingPort(): ClearingPort {
  if (!adapter) adapter = new SimulatedCsmAdapter();
  return adapter;
}

/** For tests: a fresh simulation with no memory of earlier submissions. */
export function resetClearingPort(): void {
  adapter = null;
}

import { Pacs002Status, Pacs008 } from '../services/iso20022.service';
import { ClearingScheme } from '../models/counterpartyBank.model';

// The seam a real scheme connector plugs into.
//
// This is the concrete case that justifies `ports/` in a bankcore module: everything else here is the bank's
// own business, but reaching a clearing scheme is genuinely an outward integration, and it is the one place
// where a real connector (SEPA, ACH, SWIFT) would replace a simulation without touching the module.
//
// The port deliberately models a SUBMISSION and a separate STATUS REPORT rather than a request/response.
// A scheme does not answer synchronously: it acknowledges, then reports. Collapsing the two would make the
// simulation lie about the one thing that matters most, which is that settlement is asynchronous.
export interface ClearingSubmission {
  message: Pacs008;
  messageIdentification: string;
  endToEndIdentification: string;
  scheme: ClearingScheme;
  creditorBic?: string;
  amount: number;
  currency: string;
}

export interface ClearingAcknowledgement {
  // Whether the scheme took the message at all. A refusal here is not a settlement failure: nothing was
  // presented, so nothing has to be returned.
  accepted: boolean;
  // The scheme's own reference, which a reconciliation quotes.
  clearingReference?: string;
  reasonCode?: string;
  // How long the scheme expects to take, so the caller can decide whether to wait or to report in flight.
  expectedSettlementMs?: number;
}

export interface ClearingStatusReport {
  status: Pacs002Status;
  reasonCode?: string;
  clearingReference?: string;
}

export interface ClearingPort {
  /** Presents the credit transfer. Past this point the payment is irrevocable (N3). */
  submit(submission: ClearingSubmission): Promise<ClearingAcknowledgement>;
  /** The scheme's status report for a submission it accepted. */
  statusOf(clearingReference: string): Promise<ClearingStatusReport>;
}

// v28 SEPA / ISO 20022 mapping layer (demo fidelity, NOT a live inter-PSP connection). Maps the
// canonical RTP request → ISO 20022-aligned identifiers (pain.013 request-to-pay / pain.014 response
// shape) and the accepted intent → a rail selection. Structured address + structured remittance are
// stored from day one to avoid the 15-Nov-2026 EPC unstructured-address reject risk. Pure functions.
import type { PaymentRequestProcedure, PaymentRequestRail } from '../../modules/gateway/models/paymentRequest.model';

export interface Iso20022RequestToPay {
  messageId: string;              // pain.013 GrpHdr/MsgId
  creationDateTime: string;
  paymentInformationId: string;
  creditorReference?: string;     // structured remittance (SCOR)
  amount: { value: number; currency: string };
  requestedExecutionDate?: string;
  creditorName?: string;
  remittanceInformation?: { structured?: unknown; unstructured?: string };
  creditorPostalAddress?: unknown;
  expiryDateTime: string;
}

const toIso = (d?: Date) => (d ? new Date(d).toISOString() : undefined);

// Map a canonical request to a pain.013-shaped Request to Pay message (identifiers + structured fields).
export function mapRequestToIso20022(req: PaymentRequestProcedure): Iso20022RequestToPay {
  return {
    messageId: `RTP-${req.paymentRequestInstanceReference}`,
    creationDateTime: toIso(req.recordCreatedDateTime) ?? new Date().toISOString(),
    paymentInformationId: `PMTINF-${req.paymentRequestInstanceReference}`,
    creditorReference: req.structuredRemittance?.reference,
    amount: { value: req.amount, currency: req.currency },
    requestedExecutionDate: toIso(req.dueAt),
    creditorName: req.payeeName,
    remittanceInformation: {
      structured: req.structuredRemittance,
      unstructured: req.unstructuredRemittance,
    },
    creditorPostalAddress: req.structuredAddress,
    expiryDateTime: toIso(req.expiresAt) ?? new Date().toISOString(),
  };
}

// Constrain the accepted intent to a rail the existing engine supports (ACH/SEPA/SWIFT/local_bank).
// SEPA (SCT / SCT Inst) is the default for EUR; USD → ACH; otherwise SWIFT.
export function resolveRtpRail(req: PaymentRequestProcedure): PaymentRequestRail {
  if (req.preferredRail && req.supportedRails.includes(req.preferredRail)) return req.preferredRail;
  if (req.currency === 'EUR') return 'sepa';
  if (req.currency === 'USD') return 'ach';
  return 'swift';
}

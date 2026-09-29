import { v4 as uuidv4 } from 'uuid';
import { PaymentInitiationControlRecord } from '../../pisp/models/paymentInitiation.model';
import { ClearingScheme } from '../models/counterpartyBank.model';

// ISO 20022 messages, as structures rather than XML.
//
// The repository already models `pain.013` / `pain.014` and `pacs.002` this way, so this follows the same
// convention: the element names and the nesting are the standard's, which is what makes the shape reviewable
// and a real serialiser a later mechanical step. Inventing shorter field names would have been the actual
// deviation.
//
// `pacs.008` is the credit transfer itself and is the one message genuinely absent from this repository
// before now. Everything downstream (the status report, the return) already had a precedent.

function isoDateTime(): string {
  return new Date().toISOString();
}

/** Group header, shared by every message this bank sends. */
function groupHeader(messageId: string, count: number, amount: number, currency: string, debtorBic: string) {
  return {
    MsgId: messageId,
    CreDtTm: isoDateTime(),
    NbOfTxs: String(count),
    // The sum a scheme reconciles against, which is why it is the total and not the per-transaction amount.
    TtlIntrBkSttlmAmt: { Ccy: currency, amount: amount.toFixed(2) },
    IntrBkSttlmDt: isoDateTime().slice(0, 10),
    SttlmInf: { SttlmMtd: 'CLRG' },
    InstgAgt: { FinInstnId: { BICFI: debtorBic } },
  };
}

export interface Pacs008 {
  FIToFICstmrCdtTrf: {
    GrpHdr: Record<string, unknown>;
    CdtTrfTxInf: Array<Record<string, unknown>>;
  };
}

/**
 * Builds the outbound credit transfer.
 *
 * `EndToEndId` is the caller's own payment id, carried unchanged: it is the identifier that survives the
 * whole chain, so a reconciliation and a customer enquiry both resolve to the same payment.
 */
export function buildPacs008(
  payment: PaymentInitiationControlRecord,
  context: { debtorBic: string; creditorBic?: string; scheme: ClearingScheme; messageId?: string },
): { message: Pacs008; messageIdentification: string } {
  const messageIdentification = context.messageId ?? `MSG-${uuidv4()}`;
  const message: Pacs008 = {
    FIToFICstmrCdtTrf: {
      GrpHdr: groupHeader(
        messageIdentification, 1, payment.paymentInstructedAmount, payment.paymentCurrency, context.debtorBic,
      ),
      CdtTrfTxInf: [{
        PmtId: {
          InstrId: payment.paymentInitiationInstanceReference,
          EndToEndId: payment.paymentEndToEndIdentification,
        },
        PmtTpInf: { SvcLvl: { Cd: context.scheme === 'sepa_instant' ? 'SEPA' : 'SEPA' }, LclInstrm: { Prtry: context.scheme } },
        IntrBkSttlmAmt: { Ccy: payment.paymentCurrency, amount: payment.paymentInstructedAmount.toFixed(2) },
        ChrgBr: 'SLEV',
        Dbtr: { Nm: 'Account holder' },
        DbtrAcct: { Id: { IBAN: payment.paymentDebtor.iban } },
        DbtrAgt: { FinInstnId: { BICFI: context.debtorBic } },
        CdtrAgt: context.creditorBic ? { FinInstnId: { BICFI: context.creditorBic } } : undefined,
        Cdtr: { Nm: payment.paymentCreditorName },
        CdtrAcct: { Id: { IBAN: payment.paymentCreditor.iban } },
        RmtInf: payment.paymentRemittanceInformation
          ? { Ustrd: [payment.paymentRemittanceInformation] }
          : undefined,
      }],
    },
  };
  return { message, messageIdentification };
}

// The scheme's status report. `ACSP` is in process, `ACSC` settled, `RJCT` refused with a reason code.
export type Pacs002Status = 'ACSP' | 'ACSC' | 'RJCT';

export interface Pacs002 {
  FIToFIPmtStsRpt: {
    GrpHdr: Record<string, unknown>;
    TxInfAndSts: Array<Record<string, unknown>>;
  };
}

export function buildPacs002(input: {
  originalMessageIdentification: string;
  originalEndToEndIdentification: string;
  status: Pacs002Status;
  reasonCode?: string;
  messageId?: string;
}): { message: Pacs002; messageIdentification: string } {
  const messageIdentification = input.messageId ?? `STS-${uuidv4()}`;
  const message: Pacs002 = {
    FIToFIPmtStsRpt: {
      GrpHdr: { MsgId: messageIdentification, CreDtTm: isoDateTime() },
      TxInfAndSts: [{
        OrgnlGrpInf: { OrgnlMsgId: input.originalMessageIdentification, OrgnlMsgNmId: 'pacs.008' },
        OrgnlEndToEndId: input.originalEndToEndIdentification,
        TxSts: input.status,
        // Only on a refusal: a reason code on an acceptance would be meaningless and misread.
        StsRsnInf: input.reasonCode ? [{ Rsn: { Cd: input.reasonCode } }] : undefined,
      }],
    },
  };
  return { message, messageIdentification };
}

// A return AFTER settlement, which is a different fact from a rejection: the money moved and is coming
// back, so the PSP has to hear about it even though the payment was already reported settled.
export interface Pacs004 {
  PmtRtr: {
    GrpHdr: Record<string, unknown>;
    TxInf: Array<Record<string, unknown>>;
  };
}

export function buildPacs004(input: {
  originalEndToEndIdentification: string;
  amount: number;
  currency: string;
  reasonCode: string;
  messageId?: string;
}): { message: Pacs004; messageIdentification: string } {
  const messageIdentification = input.messageId ?? `RTN-${uuidv4()}`;
  const message: Pacs004 = {
    PmtRtr: {
      GrpHdr: {
        MsgId: messageIdentification,
        CreDtTm: isoDateTime(),
        NbOfTxs: '1',
        TtlRtrdIntrBkSttlmAmt: { Ccy: input.currency, amount: input.amount.toFixed(2) },
      },
      TxInf: [{
        OrgnlEndToEndId: input.originalEndToEndIdentification,
        RtrdIntrBkSttlmAmt: { Ccy: input.currency, amount: input.amount.toFixed(2) },
        RtrRsnInf: [{ Rsn: { Cd: input.reasonCode } }],
      }],
    },
  };
  return { message, messageIdentification };
}

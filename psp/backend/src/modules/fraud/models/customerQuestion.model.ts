// (Fraud Diagnosis): structured customer questions raised by L1/L2 investigators on a
// case, answered by the customer on the related transaction. Append-only / immutable once answered
// (PCI DSS traceability; no edit after submission). The QUESTION and the customer's RESPONSE
// carry no cardholder data (CHD), only free text the customer chooses to provide.
import type { AnalystRole } from '../../../shared/models/identity.model';

export const CUSTOMER_QUESTION_COLLECTION = 'fraudDiagnosisCustomerQuestion';

export type CustomerQuestionStatus = 'pending' | 'closed';

export interface CustomerQuestionRecord {
  customerQuestionInstanceReference: string;     // PK, UUID
  fraudDiagnosisInstanceReference: string;       // FK → fraudDiagnosisCase 
  fraudDiagnosisCaseReference: string;           // human-readable case ref (display only)
  cardTransactionInstanceReference: string;      // FK → cardTransaction ; customer entry point
  customerAgreementInstanceReference: string;    // FK → customerAgreement 
  partyInstanceReference: string;                // FK → party ; used for ownership checks
  questionText: string;
  questionOptions: string[];                     // predefined selectable responses (e.g. ['Yes','No'])
  allowOther: boolean;                           // whether a free-text "Other" answer is permitted
  questionStatus: CustomerQuestionStatus;
  askedByInstanceReference: string;              // acting investigator (partyRef/sub)
  askedByName?: string;
  askedByRole: AnalystRole;
  askedDateTime: Date;
  // Immutable response (set once, never modified):
  responseOption?: string;                       // the chosen option, or 'Other'
  responseText?: string;                         // free text when responseOption === 'Other'
  respondedByInstanceReference?: string;         // the customer (partyRef)
  respondedDateTime?: Date;
  bianServiceDomain: 'Fraud Diagnosis';
  bianControlRecordType: 'FraudDiagnosisCase';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

// Client-facing shape. Deliberately omits internal refs (case/agreement/party instance references)
// the caller does not need: data minimization (PCI DSS).
export interface CustomerQuestionDTO {
  questionId: string;
  caseReference: string;
  transactionId: string;
  questionText: string;
  options: string[];
  allowOther: boolean;
  status: CustomerQuestionStatus;
  askedByRole: string;
  askedDateTime: string;
  responseOption: string | null;
  responseText: string | null;
  respondedDateTime: string | null;
}

export function toCustomerQuestionDTO(q: CustomerQuestionRecord): CustomerQuestionDTO {
  return {
    questionId: q.customerQuestionInstanceReference,
    caseReference: q.fraudDiagnosisCaseReference,
    transactionId: q.cardTransactionInstanceReference,
    questionText: q.questionText,
    options: q.questionOptions,
    allowOther: q.allowOther,
    status: q.questionStatus,
    askedByRole: q.askedByRole,
    askedDateTime: q.askedDateTime instanceof Date ? q.askedDateTime.toISOString() : String(q.askedDateTime),
    responseOption: q.responseOption ?? null,
    responseText: q.responseText ?? null,
    respondedDateTime: q.respondedDateTime
      ? (q.respondedDateTime instanceof Date ? q.respondedDateTime.toISOString() : String(q.respondedDateTime))
      : null,
  };
}

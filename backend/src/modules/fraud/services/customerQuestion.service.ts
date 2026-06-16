import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CUSTOMER_QUESTION_COLLECTION, CustomerQuestionRecord, CustomerQuestionDTO, toCustomerQuestionDTO,
} from '../models/customerQuestion.model';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';
import { getCaseById, appendAuditEvent } from './fraudDiagnosis.service';
import { emitProcessEvent } from '../../providers/services/businessProcessEvent.service';
import type { AnalystRole } from '../../../shared/models/identity.model';

const col = (db: Db) => db.collection<CustomerQuestionRecord>(CUSTOMER_QUESTION_COLLECTION);

// ── Investigator: create a question on a case ────────────────────────────────
export type CreateQuestionResult =
  | { ok: true; question: CustomerQuestionDTO }
  | { ok: false; error: 'case_not_found' | 'invalid' };

export async function createQuestion(
  db: Db,
  caseId: string,
  input: { questionText: string; options: string[]; allowOther: boolean },
  asker: { ref?: string; name?: string; role: AnalystRole },
): Promise<CreateQuestionResult> {
  const text = (input.questionText ?? '').trim();
  const options = [...new Set((input.options ?? []).map((o) => String(o).trim()).filter(Boolean))];
  if (!text || options.length === 0) return { ok: false, error: 'invalid' };

  const fraudCase = await getCaseById(db, caseId);
  if (!fraudCase) return { ok: false, error: 'case_not_found' };

  // Resolve the owning party from the case's customer agreement (used for ownership checks on answer).
  const agreement = await db.collection(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne<{ partyInstanceReference?: string }>({ customerAgreementInstanceReference: fraudCase.customerAgreementInstanceReference });

  const now = new Date();
  const record: CustomerQuestionRecord = {
    customerQuestionInstanceReference: uuidv4(),
    fraudDiagnosisInstanceReference: fraudCase.fraudDiagnosisInstanceReference,
    fraudDiagnosisCaseReference: fraudCase.fraudDiagnosisCaseReference,
    cardTransactionInstanceReference: fraudCase.cardTransactionInstanceReference,
    customerAgreementInstanceReference: fraudCase.customerAgreementInstanceReference,
    partyInstanceReference: agreement?.partyInstanceReference ?? '',
    questionText: text,
    questionOptions: options,
    allowOther: !!input.allowOther,
    questionStatus: 'pending',
    askedByInstanceReference: asker.ref ?? 'rbac-layer',
    askedByName: asker.name,
    askedByRole: asker.role,
    askedDateTime: now,
    bianServiceDomain: 'Fraud Diagnosis',
    bianControlRecordType: 'FraudDiagnosisCase',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };
  await col(db).insertOne(record);

  // Audit trail: case timeline + unified business-process events (PCI DSS Req 10).
  await appendAuditEvent(db, caseId, 'question_created', asker.role, {
    questionId: record.customerQuestionInstanceReference, questionText: text, options, allowOther: record.allowOther,
  }, { ref: asker.ref, name: asker.name });
  emitProcessEvent(db, {
    entityType: 'fraud_case', entityId: caseId, processType: 'fraud_evaluation',
    processAction: 'fraud.question.created', processOutcome: 'pending',
    performedByPartyReference: asker.ref ?? null, performedByRole: asker.role,
    eventSummary: { questionId: record.customerQuestionInstanceReference, transactionId: record.cardTransactionInstanceReference, options },
    bianServiceDomain: 'Fraud Diagnosis', bianControlRecordType: 'FraudDiagnosisCase',
  });

  return { ok: true, question: toCustomerQuestionDTO(record) };
}

// ── Read paths ───────────────────────────────────────────────────────────────
export async function listQuestionsByCase(db: Db, caseId: string): Promise<CustomerQuestionDTO[]> {
  const rows = await col(db).find({ fraudDiagnosisInstanceReference: caseId }).sort({ askedDateTime: -1 }).toArray();
  return rows.map(toCustomerQuestionDTO);
}

export async function listQuestionsByTransaction(db: Db, txnId: string): Promise<CustomerQuestionDTO[]> {
  const rows = await col(db).find({ cardTransactionInstanceReference: txnId }).sort({ askedDateTime: -1 }).toArray();
  return rows.map(toCustomerQuestionDTO);
}

// Pending questions addressed to a specific customer (by owning party) — drives notifications.
export async function listPendingForParty(db: Db, partyRef: string): Promise<CustomerQuestionDTO[]> {
  if (!partyRef) return [];
  const rows = await col(db)
    .find({ partyInstanceReference: partyRef, questionStatus: 'pending' })
    .sort({ askedDateTime: -1 }).toArray();
  return rows.map(toCustomerQuestionDTO);
}

// ── Customer: submit an immutable response ───────────────────────────────────
export type SubmitResponseResult =
  | { ok: true; question: CustomerQuestionDTO }
  | { ok: false; error: 'not_found' | 'forbidden' | 'already_closed' | 'invalid' };

export async function submitResponse(
  db: Db,
  questionId: string,
  input: { option: string; text?: string },
  responder: { partyRef?: string; txnId?: string },
): Promise<SubmitResponseResult> {
  const q = await col(db).findOne({ customerQuestionInstanceReference: questionId });
  if (!q) return { ok: false, error: 'not_found' };

  // Ownership (PCI DSS Req 7): a customer may only answer questions on their own case/transaction.
  if (q.partyInstanceReference && responder.partyRef && q.partyInstanceReference !== responder.partyRef) {
    return { ok: false, error: 'forbidden' };
  }
  if (responder.txnId && q.cardTransactionInstanceReference !== responder.txnId) {
    return { ok: false, error: 'forbidden' };
  }
  if (q.questionStatus === 'closed') return { ok: false, error: 'already_closed' };

  // Validate the selection against the predefined options (or a permitted free-text "Other").
  const option = String(input.option ?? '').trim();
  const isOther = option === 'Other';
  const text = (input.text ?? '').trim();
  if (isOther) {
    if (!q.allowOther || !text) return { ok: false, error: 'invalid' };
  } else if (!q.questionOptions.includes(option)) {
    return { ok: false, error: 'invalid' };
  }

  const now = new Date();
  // Atomic close: only transitions a still-pending question (prevents double-answer races / edits).
  const res = await col(db).updateOne(
    { customerQuestionInstanceReference: questionId, questionStatus: 'pending' },
    {
      $set: {
        questionStatus: 'closed',
        responseOption: option,
        ...(isOther ? { responseText: text } : {}),
        respondedByInstanceReference: responder.partyRef ?? 'customer',
        respondedDateTime: now,
        recordUpdatedDateTime: now,
      },
    },
  );
  if (res.matchedCount === 0) return { ok: false, error: 'already_closed' };

  await appendAuditEvent(db, q.fraudDiagnosisInstanceReference, 'question_answered', 'customer', {
    questionId, responseOption: option, hasFreeText: isOther,
  }, { ref: responder.partyRef });
  emitProcessEvent(db, {
    entityType: 'fraud_case', entityId: q.fraudDiagnosisInstanceReference, processType: 'fraud_evaluation',
    processAction: 'fraud.question.answered', processOutcome: 'approved',
    performedByPartyReference: responder.partyRef ?? null, performedByRole: 'customer',
    eventSummary: { questionId, transactionId: q.cardTransactionInstanceReference, responseOption: option, hasFreeText: isOther },
    bianServiceDomain: 'Fraud Diagnosis', bianControlRecordType: 'FraudDiagnosisCase',
  });

  const updated = await col(db).findOne({ customerQuestionInstanceReference: questionId });
  return { ok: true, question: toCustomerQuestionDTO(updated!) };
}

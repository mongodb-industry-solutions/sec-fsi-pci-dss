// v27: staff view of a customer's aggregated activity (transactions).
// Orchestrates read-only, display-safe money movement for a found customer: payment
// executions (sent/received) and card transactions. Domain logic lives here (Hexagonal);
// the controller stays thin. Reuses the transaction/gateway services rather than duplicating the
// merge the merchant OAuth history already performs.
import { Db } from 'mongodb';
import { CUSTOMER_AGREEMENT_COLLECTION, CustomerAgreementControlRecord } from '../models/customerAgreement.model';
import type { UserRole } from '../../../shared/models/identity.model';
import { getDbForRole } from '../../../vendors/encryption/roleClients';
import { canStaffInvestigate } from '../../../vendors/middleware/rbac';
import { resolveAccountReferenceForParty, getPartyCardTransactions } from '../../transaction/services/cardTransaction.service';
import { listPartyExecutions, getExecution } from '../../gateway/services/paymentExecution.service';
import type { PaymentExecutionResolutionStep } from '../../gateway/models/paymentExecution.model';

// Display-safe unified activity row (no CHD, no raw IBAN). Same shape the merchant OAuth history
// exposes so the frontend can reuse one row renderer across contexts.
interface ActivityRow {
  kind: 'transfer' | 'card';
  paymentExecutionInstanceReference: string;
  direction: 'sent' | 'received';
  grossAmount?: number;
  netAmount?: number;
  feeAmount?: number;
  currency?: string;
  paymentExecutionRail: string | null;
  paymentExecutionStatus: string;
  concept: string | null;
  beneficiaryName: string | null;
  destinationAccountMasked: string | null;
  initiatedAt: string | null;
  completedAt: string | null;
}

/**
 * Aggregate a customer's transactions for the staff profile view.
 *
 * Role gate (PCI DSS): VIEW is restricted to level2_investigator and security_auditor;
 * L1 analyst and customer are rejected with 403. Resolves customerId
 * (customerAgreementInstanceReference) -> partyInstanceReference (+ account reference) via the
 * agreement, then merges the party's executions and card transactions display-safe.
 */
export async function getCustomerTransactions(
  db: Db,
  customerId: string,
  role: UserRole,
  page = 1,
  limit = 20,
): Promise<{ results: ActivityRow[]; total: number; page: number; limit: number }> {
  if (!canStaffInvestigate(role)) {
    throw Object.assign(
      new Error('Customer transaction history is restricted to investigator and auditor roles'),
      { statusCode: 403 },
    );
  }

  const p = Math.max(1, page);
  const l = Math.min(100, Math.max(1, limit));

  // Resolve party + canonical account reference from the agreement. The role-aware QE client is used
  // so the read honors least-privilege; only the plaintext linkage keys are needed here.
  const roleDb = await getDbForRole(role, false);
  const agreement = await roleDb
    .collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementInstanceReference: customerId });
  if (!agreement) return { results: [], total: 0, page: p, limit: l };

  const partyRef = agreement.partyInstanceReference;
  const accountReference = agreement.customerAgreementReference;

  // Source 1: executions (sent/received) for the party, across all merchants/rails.
  const execDocs = await listPartyExecutions(db, partyRef, 200);
  const execRows: ActivityRow[] = execDocs.map((d) => ({
    kind: 'transfer',
    paymentExecutionInstanceReference: d.paymentExecutionInstanceReference,
    direction: d.initiatorPartyReference === partyRef ? 'sent' : 'received',
    grossAmount: d.grossAmount,
    netAmount: d.netAmount,
    feeAmount: d.feeAmount,
    currency: d.currency,
    paymentExecutionRail: d.paymentExecutionRail ?? null,
    paymentExecutionStatus: d.paymentExecutionStatus,
    concept: d.paymentExecutionRemittanceInformation ?? d.routingNote ?? null,
    beneficiaryName: d.beneficiaryName ?? null,
    destinationAccountMasked: d.destinationAccountMasked ?? null,
    initiatedAt: d.initiatedAt?.toISOString() ?? null,
    completedAt: d.completedAt?.toISOString() ?? null,
  }));

  // Source 2: the party's OWN card transactions , masked PAN only, across all merchants.
  const acctRef = accountReference ?? (await resolveAccountReferenceForParty(db, partyRef));
  const cardTxns = acctRef ? await getPartyCardTransactions(db, acctRef, 200) : [];
  const cardRows: ActivityRow[] = cardTxns.map((t) => ({
    kind: 'card',
    paymentExecutionInstanceReference: t.cardTransactionInstanceReference,
    direction: 'sent',
    grossAmount: t.grossAmount,
    currency: t.currency,
    paymentExecutionRail: 'card',
    paymentExecutionStatus: t.status,
    concept: t.cardTransactionDescription ?? null,
    beneficiaryName: t.merchantName,
    destinationAccountMasked: t.maskedPan,
    initiatedAt: t.initiatedAt,
    completedAt: t.initiatedAt,
  }));

  const merged = [...execRows, ...cardRows].sort((a, b) => {
    const av = a.completedAt ?? a.initiatedAt;
    const bv = b.completedAt ?? b.initiatedAt;
    return (bv ? new Date(bv).getTime() : 0) - (av ? new Date(av).getTime() : 0);
  });

  const total = merged.length;
  const results = merged.slice((p - 1) * l, p * l);
  return { results, total, page: p, limit: l };
}

// Display-safe execution detail for the staff drill-down (no CHD, no raw IBAN).
export interface ExecutionDetail {
  kind: 'transfer';
  paymentExecutionInstanceReference: string;
  direction: 'sent' | 'received';
  beneficiaryType: string;
  initiatorPartyReference: string | null;
  beneficiaryPartyReference: string | null;
  sourcePayoutAccountReference: string | null;
  resolvedPayoutAccountReference: string | null;
  beneficiaryArrangementReference: string | null;
  merchantAgreementReference: string | null;
  grossAmount: number;
  netAmount: number;
  feeAmount: number;
  currency: string;
  recipientCurrency: string | null;
  recipientAmount: number | null;
  fxRate: number | null;
  paymentExecutionRail: string | null;
  paymentExecutionStatus: string;
  concept: string | null;
  beneficiaryName: string | null;
  destinationAccountMasked: string | null;
  destinationCountry: string | null;
  failureReason: string | null;
  resolutionLog: PaymentExecutionResolutionStep[];
  initiatedAt: string | null;
  completedAt: string | null;
}

/**
 * Staff drill-down: display-safe detail of ONE payment execution belonging to a customer.
 *
 * Role gate (PCI DSS): restricted to level2_investigator and security_auditor (else 403).
 * Resolves customerId (customerAgreementInstanceReference) -> partyInstanceReference, then asserts
 * the execution belongs to that party (initiator or beneficiary) else 404 (existence not leaked).
 * Reuses the paymentExecution service; never returns the raw destination IBAN (QE:none).
 */
export async function getCustomerTransactionDetail(
  db: Db,
  customerId: string,
  executionId: string,
  role: UserRole,
): Promise<ExecutionDetail> {
  if (!canStaffInvestigate(role)) {
    throw Object.assign(
      new Error('Customer transaction detail is restricted to investigator and auditor roles'),
      { statusCode: 403 },
    );
  }

  const notFound = () => Object.assign(new Error('Transaction not found'), { statusCode: 404 });

  const roleDb = await getDbForRole(role, false);
  const agreement = await roleDb
    .collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementInstanceReference: customerId });
  if (!agreement) throw notFound();
  const partyRef = agreement.partyInstanceReference;

  const exec = await getExecution(db, executionId);
  // Party ownership: the execution must involve this customer's party (sent or received).
  if (!exec || (exec.initiatorPartyReference !== partyRef && exec.beneficiaryPartyReference !== partyRef)) {
    throw notFound();
  }

  return {
    kind: 'transfer',
    paymentExecutionInstanceReference: exec.paymentExecutionInstanceReference,
    direction: exec.initiatorPartyReference === partyRef ? 'sent' : 'received',
    beneficiaryType: exec.beneficiaryType,
    initiatorPartyReference: exec.initiatorPartyReference ?? null,
    beneficiaryPartyReference: exec.beneficiaryPartyReference ?? null,
    sourcePayoutAccountReference: exec.sourcePayoutAccountReference ?? null,
    resolvedPayoutAccountReference: exec.resolvedPayoutAccountReference ?? null,
    beneficiaryArrangementReference: exec.beneficiaryArrangementReference ?? null,
    merchantAgreementReference: exec.merchantAgreementReference ?? null,
    grossAmount: exec.grossAmount,
    netAmount: exec.netAmount,
    feeAmount: exec.feeAmount,
    currency: exec.currency,
    recipientCurrency: exec.recipientCurrency ?? null,
    recipientAmount: exec.recipientAmount ?? null,
    fxRate: exec.fxRate ?? null,
    paymentExecutionRail: exec.paymentExecutionRail ?? null,
    paymentExecutionStatus: exec.paymentExecutionStatus,
    concept: exec.paymentExecutionRemittanceInformation ?? exec.routingNote ?? null,
    beneficiaryName: exec.beneficiaryName ?? null,
    destinationAccountMasked: exec.destinationAccountMasked ?? null,
    destinationCountry: exec.destinationCountry ?? null,
    failureReason: exec.failureReason ?? null,
    resolutionLog: exec.resolutionLog ?? [],
    initiatedAt: exec.initiatedAt?.toISOString() ?? null,
    completedAt: exec.completedAt?.toISOString() ?? null,
  };
}

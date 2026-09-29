// The bank's own audit trail: who asked what, of which resource, under whose authority, and what it answered.
//
// The consent access log next to it records consent DECISIONS, which is a narrower thing: it says whether an
// access was granted and why. It cannot answer "what did this third party do here on Tuesday", because a call
// that needed no consent (a token request, a card validation, an administrative change) never appears in it.
// Non-repudiation needs the whole surface, so this records every authorised request.
//
// What it deliberately does NOT hold: request bodies, cardholder data, verification values, tokens or
// secrets. An audit trail that copies the payload becomes a second place the sensitive data lives, which is
// how a log turns into the thing that has to be protected. References and outcomes are enough to reconstruct
// what happened, and they are what a reviewer actually reads.
export const BANK_AUDIT_LOG_COLLECTION = 'bankAuditLog';

// How the request arrived. `open_banking` is a third party on the standard surface; `admin` is an operator on
// the bank's own administrative API; `internal` is the bank talking to itself.
export type BankAuditChannel = 'open_banking' | 'admin' | 'internal';

export type BankAuditOutcome = 'granted' | 'refused' | 'failed';

export interface BankAuditLogRecord {
  bankAuditLogInstanceReference: string;
  // WHO. The third party's client id on the standard surface, or the operator's subject on the admin one.
  auditActorReference: string;
  auditActorRoles?: string[];
  auditChannel: BankAuditChannel;
  // WHAT was asked, as the route rather than the concrete URL: a path carrying a reference would put that
  // reference in two fields and make the log harder to aggregate, not easier.
  auditRequestMethod: string;
  auditRequestRoute: string;
  // WHICH resource, one field per kind so a reviewer can filter without parsing a path.
  auditConsentReference?: string;
  auditAccountReference?: string;
  auditPaymentReference?: string;
  auditCardReference?: string;
  auditAuthenticationReference?: string;
  // WHAT HAPPENED. The HTTP status is kept alongside the outcome because the two answer different
  // questions: a decline is a successful call that refused, and both matter.
  auditOutcome: BankAuditOutcome;
  auditResponseStatus: number;
  auditDurationMs: number;
  // The thread that ties this row to the PSP's own record of the same journey.
  auditCorrelationId?: string;
  bianServiceDomain: string;
  bianControlRecordType: 'BankAuditLog';
  recordCreatedDateTime: string;
  schemaVersion: number;
}

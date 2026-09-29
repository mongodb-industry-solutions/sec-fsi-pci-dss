import { Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  BANK_AUDIT_LOG_COLLECTION, BankAuditLogRecord, BankAuditChannel, BankAuditOutcome,
} from '../models/bankAuditLog.model';

// Turns a finished request into an audit row. Every decision about WHAT to keep is here, so the hook that
// calls it stays a hook.

function firstHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function channelFor(route: string): BankAuditChannel {
  if (route.startsWith('/api/v1/admin')) return 'admin';
  if (route.startsWith('/v1/')) return 'open_banking';
  return 'internal';
}

function outcomeFor(status: number): BankAuditOutcome {
  if (status < 400) return 'granted';
  // 4xx is a refusal the bank MEANT: no consent, wrong scope, unknown resource. 5xx is the bank failing,
  // which is a different question for whoever reads the trail.
  return status < 500 ? 'refused' : 'failed';
}

// Which reference each parameter names. Read from the route's own parameters rather than guessed from the
// path, so a reference lands in the field a reviewer filters on.
const PARAM_FIELDS: Record<string, keyof BankAuditLogRecord> = {
  consentId: 'auditConsentReference',
  accountId: 'auditAccountReference',
  accountReference: 'auditAccountReference',
  accountHolderReference: 'auditAccountReference',
  paymentId: 'auditPaymentReference',
  paymentReference: 'auditPaymentReference',
  cardToken: 'auditCardReference',
  authorisationReference: 'auditAuthenticationReference',
  authReqId: 'auditAuthenticationReference',
};

export function buildAuditRecord(
  request: FastifyRequest,
  reply: FastifyReply,
  durationMs: number,
): BankAuditLogRecord {
  const route = request.routeOptions?.url ?? request.url.split('?')[0];
  const params = (request.params ?? {}) as Record<string, string>;

  const record: BankAuditLogRecord = {
    bankAuditLogInstanceReference: `aud_${randomUUID()}`,
    // An unauthenticated caller is recorded as such rather than dropped: a refused attempt is precisely the
    // thing a reviewer wants to see, and leaving it out would make the trail look quieter than reality.
    auditActorReference: request.tpp?.clientId ?? 'anonymous',
    auditActorRoles: request.tpp?.roles ? [...request.tpp.roles] : undefined,
    auditChannel: channelFor(route),
    auditRequestMethod: request.method,
    auditRequestRoute: route,
    auditOutcome: outcomeFor(reply.statusCode),
    auditResponseStatus: reply.statusCode,
    auditDurationMs: Math.round(durationMs),
    auditCorrelationId: request.correlationId,
    bianServiceDomain: 'Business Monitoring',
    bianControlRecordType: 'BankAuditLog',
    recordCreatedDateTime: new Date().toISOString(),
    schemaVersion: 1,
  };

  // The consent travels in a header on the standard surface and in a path parameter on the admin one.
  const consentHeader = firstHeader(request, 'consent-id');
  if (consentHeader) record.auditConsentReference = consentHeader;

  for (const [param, field] of Object.entries(PARAM_FIELDS)) {
    const value = params[param];
    if (value && !record[field]) {
      (record as unknown as Record<string, unknown>)[field] = value;
    }
  }
  return record;
}

/**
 * Appends the row. NEVER throws and never awaits the caller's response: an audit write that can fail a request
 * turns a logging problem into an outage, and one that blocks the reply pays for the trail in latency on every
 * call. A failure is reported to the log buffer so it is visible rather than silent, which is the whole point
 * of having the trail in the first place.
 */
export function recordAudit(db: Db, record: BankAuditLogRecord): void {
  db.collection<BankAuditLogRecord>(BANK_AUDIT_LOG_COLLECTION)
    .insertOne(record)
    .catch((error: unknown) => {
      console.warn(`[bankAuditLog] could not record ${record.auditRequestMethod} ${record.auditRequestRoute}: ${(error as Error).message}`);
    });
}

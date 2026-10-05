import { Db } from 'mongodb';
import { getActiveProviderForType } from './integrationRegistry.service';
import { logEvent } from './integrationDispatch.service';
import type { BusinessContextRef, IntegrationProviderType } from '../models/externalProviderArrangement.model';

// Where a direct call to the bank is audited. Some bank operations (initiating a payment, placing or
// releasing a card hold) go through a dedicated client instead of the dispatch pipeline, and so left no
// outbound record in the provider's event log while their callbacks did. This writes the same record the
// pipeline would, so the provider section shows the whole conversation: what was sent and what came back.

/** Passed by the caller that owns the database and knows what the call is about. */
export interface BankCallAudit {
  db: Db;
  triggeredBy: string;
  businessContext?: BusinessContextRef;
}

export interface BankCallRecord {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  status?: number;
  responseBody?: unknown;
  latencyMs: number;
  error?: string;
}

/**
 * Records one outbound call to the bank under the provider of the given capability.
 *
 * The bearer token is never recorded, and the log sanitizer redacts what else is sensitive. Never throws:
 * auditing must not change the outcome of the call it describes.
 */
export async function recordBankCall(
  audit: BankCallAudit | undefined,
  capability: IntegrationProviderType,
  call: BankCallRecord,
): Promise<void> {
  if (!audit) return;
  try {
    const provider = await getActiveProviderForType(audit.db, capability);
    if (!provider) return;
    const ok = typeof call.status === 'number' && call.status >= 200 && call.status < 300;
    const { Authorization: _omitted, authorization: _omittedLower, ...headers } = (call.headers ?? {}) as Record<string, string>;
    void _omitted; void _omittedLower;
    await logEvent(audit.db, {
      arrangementId: provider.externalProviderArrangementInstanceReference,
      type: 'dispatch',
      status: ok ? 'received' : call.status === undefined ? 'timeout' : 'error',
      triggeredBy: audit.triggeredBy,
      payload: (call.body ?? {}) as Record<string, unknown>,
      responseCode: call.status,
      latencyMs: call.latencyMs,
      error: call.error,
      businessContext: audit.businessContext,
      request: { method: call.method, url: call.url, headers, body: call.body },
      ...(call.status !== undefined ? { response: { status: call.status, body: call.responseBody } } : {}),
    });
  } catch { /* the audit trail never changes the outcome of the call */ }
}

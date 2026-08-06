// OIDC/OAuth flow audit (Party Authentication, PCI DSS). Emits one compliance-ledger
// event per step of the flow so an integration can be traced end-to-end and a failure pinpointed.
// Reuses the v7/v8 compliance ledger (emitComplianceEvent + LedgerProjection), no new store.
//
// Correlation: events of one OAuth flow share an entityId (the ledger's correlationId). We derive it
// from hash(state) when available (present on both the authorize and token halves), else from `sub`.
// The merchant logs the same state, so merchant logs and backend events join on this hash. Secrets
// are never emitted: callers pass only safe fields and the summary is defensively redacted.
import { Db } from 'mongodb';
import * as crypto from 'crypto';
import { emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { redactSecrets } from '../../../vendors/eventbus/sanitize';
import { ProcessEventOutcome } from '../../provider/models/externalProviderArrangement.model';
import { MERCHANT_AGREEMENT_COLLECTION } from '../../gateway/models/merchantAgreement.model';
import { PARTY_AUTHORIZATION_CODE_COLLECTION } from '../models/partyAuthorizationCode.model';

export type OAuthAuditAction =
  | 'oauth.authorize.initiated'
  | 'oauth.authorize.denied'
  | 'oauth.code.issued'
  | 'oauth.token.issued'
  | 'oauth.token.refreshed'
  | 'oauth.token.failed'
  | 'oauth.userinfo.accessed'
  | 'oauth.token.introspected'
  | 'oauth.token.revoked';

// Short, non-reversible tag of the OAuth `state` used as the flow correlation key. Never log the raw
// state, only this hash (a 16-hex-char prefix is collision-safe enough for correlating one session).
export function hashState(state?: string): string | undefined {
  if (!state) return undefined;
  return `flow:${crypto.createHash('sha256').update(state).digest('hex').slice(0, 16)}`;
}

export interface OAuthAuditOpts {
  clientId?: string;
  merchantName?: string; // WHO is attempting: the merchant behind the clientId (human-readable)
  sub?: string | null;
  state?: string;
  scopes?: string[];
  grantType?: string;
  outcome?: ProcessEventOutcome;
  reason?: string;        // raw OAuth error code / description, NEVER a secret/token
  failureCause?: string;  // classified, human-readable cause (see classifyOAuthFailure)
}

// Maps a raw OAuth error (code + description) to a stable, human-readable cause so an auditor/manager
// sees exactly WHY a flow failed (bad secret vs PKCE vs redirect_uri vs expired code, …) without
// having to interpret protocol codes. `description` never contains secrets (server messages only).
export function classifyOAuthFailure(oauthError?: string, description?: string): { cause: string; explanation: string } {
  const d = (description ?? '').toLowerCase();
  if (oauthError === 'invalid_client') {
    if (d.includes('secret')) return { cause: 'bad_client_secret', explanation: 'Client secret does not match the registered secret.' };
    if (d.includes('required')) return { cause: 'missing_client_secret', explanation: 'Confidential client did not present its secret.' };
    if (d.includes('unknown')) return { cause: 'unknown_client', explanation: 'client_id is not registered.' };
    if (d.includes('client is not active')) return { cause: 'client_inactive', explanation: 'The OAuth client is not active.' };
    if (d.includes('merchant')) return { cause: 'merchant_inactive', explanation: 'The merchant account is not active.' };
    return { cause: 'client_auth_failed', explanation: description ?? 'Client authentication failed.' };
  }
  if (oauthError === 'invalid_grant') {
    if (d.includes('code_verifier does not match') || d.includes('challenge')) return { cause: 'pkce_mismatch', explanation: 'PKCE code_verifier does not match the code_challenge.' };
    if (d.includes('code_verifier required')) return { cause: 'pkce_missing', explanation: 'PKCE code_verifier was required but not sent.' };
    if (d.includes('redirect_uri')) return { cause: 'redirect_uri_mismatch', explanation: 'redirect_uri differs from the one used at /authorize.' };
    if (d.includes('expired')) return { cause: 'code_expired', explanation: 'Authorization code expired (5 min TTL).' };
    if (d.includes('already used')) return { cause: 'code_replayed', explanation: 'Authorization code was already exchanged (replay).' };
    if (d.includes('not found')) return { cause: 'code_not_found', explanation: 'Authorization code not found (wrong client or issuer).' };
    return { cause: 'invalid_grant', explanation: description ?? 'The grant is invalid.' };
  }
  if (oauthError === 'invalid_scope') return { cause: 'invalid_scope', explanation: description ?? 'Requested scope not permitted.' };
  if (oauthError === 'unsupported_grant_type') return { cause: 'unsupported_grant_type', explanation: 'grant_type not supported.' };
  if (oauthError === 'unauthorized_client') return { cause: 'grant_not_permitted', explanation: 'This client may not use this grant type.' };
  if (oauthError === 'invalid_token') return { cause: 'invalid_token', explanation: description ?? 'Access token invalid or expired.' };
  return { cause: oauthError ?? 'server_error', explanation: description ?? 'Unexpected error.' };
}

// Fire-and-forget: mirrors the flow step onto the compliance ledger (visible to security_auditor and
// manager roles). Never blocks the auth response.
export function auditOAuth(db: Db, action: OAuthAuditAction, opts: OAuthAuditOpts): void {
  const flowId = hashState(opts.state) ?? (opts.sub ? `sub:${opts.sub}` : opts.clientId ?? 'anonymous');
  const summary = redactSecrets({
    clientId: opts.clientId,
    merchantName: opts.merchantName,
    sub: opts.sub ?? undefined,
    flowId,
    scopes: opts.scopes,
    grantType: opts.grantType,
    reason: opts.reason,
    failureCause: opts.failureCause,
  }) as Record<string, unknown>;

  emitComplianceEvent(db, {
    entityType: 'customer',
    entityId: flowId,
    processType: 'authentication',
    processAction: action,
    processOutcome: opts.outcome ?? 'approved',
    performedByPartyReference: opts.sub ?? opts.clientId ?? null,
    performedByRole: opts.sub ? 'customer' : 'client',
    eventSummary: summary,
    bianServiceDomain: 'SD-16 Party Authentication',
    bianControlRecordType: 'AuthenticationSession',
  });
}

// Recover the OAuth `state` for an authorization code so a /token failure can carry the SAME flowId
// as the rest of the flow (the token endpoint only receives `code`, not `state`). Best-effort; the
// code record exists for PKCE/redirect_uri/expired/replayed and bad-secret cases (it is issued at
// /authorize), only a truly unknown code returns undefined.
export async function stateForCode(db: Db, code?: string): Promise<string | undefined> {
  if (!code) return undefined;
  try {
    const rec = await db.collection(PARTY_AUTHORIZATION_CODE_COLLECTION).findOne(
      { code }, { projection: { state: 1 } },
    );
    return (rec as { state?: string } | null)?.state;
  } catch { return undefined; }
}

// Best-effort merchant-name lookup by clientId for events where the resolved client is not already
// in hand (e.g. the /token failure path). Fire-and-forget: resolves the name, then emits. Safe to call
// without await. Never throws into the caller.
export async function auditOAuthWithMerchantLookup(db: Db, action: OAuthAuditAction, opts: OAuthAuditOpts): Promise<void> {
  try {
    if (opts.clientId && !opts.merchantName) {
      const m = await db.collection(MERCHANT_AGREEMENT_COLLECTION).findOne(
        { 'merchantOAuthClient.oauthClientId': opts.clientId },
        { projection: { merchantName: 1 } },
      );
      opts = { ...opts, merchantName: (m as { merchantName?: string } | null)?.merchantName };
    }
  } catch { /* best-effort */ }
  auditOAuth(db, action, opts);
}

/**
 * CIBA (OIDC Client-Initiated Backchannel Authentication, Core 1.0) core business logic.
 * grant_type = urn:openid:params:grant-type:ciba. No browser redirect, no password.
 *
 * Flow: a registered CIBA client calls bc-authorize -> auth_req_id. The user approves out-of-band on
 * their Authentication Device by SIGNING the server challenge with an enrolled private key (the
 * signature IS the authentication, WebAuthn model). The client then polls /token with the auth_req_id.
 *
 * Delivery modes: poll (baseline), ping (notify then client polls), push (tokens in the notification).
 * ping/push reuse the low-level deliverWebhook primitive against the per-request notification endpoint
 * with the per-request client_notification_token as Bearer (NOT the merchant webhook registry).
 *
 * Bare exported functions taking `db` first-arg (matches oauth.service.ts).
 */
import { Db } from 'mongodb';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION,
  PartyBackchannelAuthenticationRecord,
  BackchannelDeliveryMode,
} from '../models/partyBackchannelAuthentication.model';
import {
  PARTY_ENROLLED_CREDENTIAL_COLLECTION,
  PartyEnrolledCredentialRecord,
} from '../models/partyEnrolledCredential.model';
import { CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord } from '../models/customerAuthentication.model';
import {
  MERCHANT_AGREEMENT_COLLECTION,
  MerchantAgreementControlRecord,
} from '../../gateway/models/merchantAgreement.model';
import { issueTokens, resolveOAuthClient, oauth401, oauthError, TokenResponse } from './oauth.service';
import { verifySignature } from './signatureVerifier';
import { deliverWebhook } from '../../gateway/services/webhook.service';
import { emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';

const CIBA_GRANT = 'urn:openid:params:grant-type:ciba' as const;
const DEFAULT_EXPIRES_IN = 300;   // auth_req_id lifetime (seconds)
const DEFAULT_INTERVAL = 5;       // minimum poll interval (seconds)

// ── Audit ───────────────────────────────────────────────────────────────────
function emitCibaEvent(
  db: Db,
  sub: string | null,
  clientId: string,
  action: string,
  outcome: 'approved' | 'rejected' | 'pending' | 'failed',
  summary: Record<string, unknown>,
): void {
  emitComplianceEvent(db, {
    entityType: 'customer',
    entityId: sub ?? clientId,
    processType: 'authentication',
    processAction: action,
    processOutcome: outcome,
    performedByPartyReference: sub,
    performedByRole: sub ? 'customer' : null,
    eventSummary: { clientId, ...summary },
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'BackchannelAuthentication',
  });
}

// ── Hint resolution ───────────────────────────────────────────────────────────
// Resolves exactly one of login_hint / login_hint_token / id_token_hint to a `sub`
// (customerAuthenticationInstanceReference). login_hint accepts an email or a raw sub;
// login_hint_token / id_token_hint are HMAC/JWT-bearing and preferred for sensitive PII.
export interface CibaHints {
  login_hint?: string;
  login_hint_token?: string;
  id_token_hint?: string;
}

export async function resolveHint(db: Db, hints: CibaHints): Promise<string> {
  const provided = [hints.login_hint, hints.login_hint_token, hints.id_token_hint].filter(Boolean);
  if (provided.length === 0) throw oauthError(400, 'invalid_request', 'A login hint is required');
  if (provided.length > 1) throw oauthError(400, 'invalid_request', 'Provide exactly one login hint');

  const col = db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION);

  if (hints.login_hint) {
    const value = hints.login_hint.trim();
    const user = await col.findOne({
      $or: [
        { customerAuthenticationInstanceReference: value },
        { customerAuthenticationEmailAddress: value.toLowerCase() },
        { customerAuthenticationEmailAddress: value },
      ],
    });
    if (!user) throw oauthError(400, 'unknown_user_id', 'No user matches the login_hint');
    return user.customerAuthenticationInstanceReference;
  }

  // login_hint_token / id_token_hint: decode a `sub` claim. For id_token_hint we accept a token we
  // previously issued; for login_hint_token we accept a compact { sub } payload. Both are validated
  // for a resolvable user below. (Full signature verification of foreign IdP hints is out of scope.)
  const token = (hints.id_token_hint ?? hints.login_hint_token)!;
  let sub: string | undefined;
  try {
    const parts = token.split('.');
    const payloadB64 = parts.length >= 2 ? parts[1] : parts[0];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    sub = payload.sub ?? payload.customerAuthenticationInstanceReference;
  } catch {
    throw oauthError(400, 'invalid_request', 'Malformed login hint token');
  }
  if (!sub) throw oauthError(400, 'invalid_request', 'Login hint token missing sub');
  const user = await col.findOne({ customerAuthenticationInstanceReference: sub });
  if (!user) throw oauthError(400, 'unknown_user_id', 'No user matches the hint token');
  return user.customerAuthenticationInstanceReference;
}

// ── bc-authorize ────────────────────────────────────────────────────────────
export interface InitiateBackchannelInput extends CibaHints {
  scope?: string;
  binding_message?: string;
  requested_expiry?: number;
  client_notification_token?: string;
}

export interface BackchannelAuthResponse {
  auth_req_id: string;
  expires_in: number;
  interval: number;
}

export async function initiateBackchannelAuth(
  db: Db,
  clientId: string,
  input: InitiateBackchannelInput,
): Promise<BackchannelAuthResponse> {
  const client = await resolveOAuthClient(db, clientId);
  if (!client.grantTypes.includes(CIBA_GRANT)) {
    throw oauthError(400, 'unauthorized_client', 'client not authorized for the ciba grant');
  }

  // Delivery-mode config lives on the client. ping/push require a client_notification_token.
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ 'merchantOAuthClient.oauthClientId': clientId });
  const cfg = merchant?.merchantOAuthClient;
  const deliveryMode: BackchannelDeliveryMode = cfg?.oauthBackchannelTokenDeliveryMode ?? 'poll';
  if ((deliveryMode === 'ping' || deliveryMode === 'push') && !input.client_notification_token) {
    throw oauthError(400, 'invalid_request', 'client_notification_token is required for ping/push delivery');
  }

  const requestedScopes = (input.scope ?? 'openid').split(' ').filter(Boolean);
  const allowed = requestedScopes.filter((s) => client.scopes.includes(s));
  if (allowed.length === 0) throw oauthError(400, 'invalid_scope', 'No requested scope is permitted for this client');

  const sub = await resolveHint(db, input);

  // The user must have an active enrolled credential to authenticate the backchannel request.
  const activeCred = await db
    .collection<PartyEnrolledCredentialRecord>(PARTY_ENROLLED_CREDENTIAL_COLLECTION)
    .findOne({ customerAuthenticationInstanceReference: sub, status: 'active' });
  if (!activeCred) throw oauthError(400, 'unknown_user_id', 'User has no active enrolled credential');

  const now = new Date();
  const expiresIn = Math.min(Math.max(input.requested_expiry ?? DEFAULT_EXPIRES_IN, 60), 600);
  const record: PartyBackchannelAuthenticationRecord = {
    authReqId: uuidv4(),
    clientId,
    customerAuthenticationInstanceReference: sub,
    scopes: allowed,
    challenge: crypto.randomBytes(32).toString('base64url'),
    bindingMessage: input.binding_message,
    deliveryMode,
    clientNotificationToken: input.client_notification_token,
    status: 'pending',
    interval: DEFAULT_INTERVAL,
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    recordCreatedDateTime: now,
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'BackchannelAuthentication',
  };
  await db
    .collection<PartyBackchannelAuthenticationRecord>(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION)
    .insertOne(record);

  emitCibaEvent(db, sub, clientId, 'auth.ciba.initiated', 'pending', {
    authReqId: record.authReqId, scopes: allowed, deliveryMode,
  });

  return { auth_req_id: record.authReqId, expires_in: expiresIn, interval: DEFAULT_INTERVAL };
}

// ── Authentication Device: fetch challenge ────────────────────────────────────
export interface ChallengeView {
  auth_req_id: string;
  challenge: string;
  binding_message?: string;
  client_id: string;
  client_name: string;
  scopes: string[];
  status: string;
}

export async function getChallenge(db: Db, authReqId: string): Promise<ChallengeView> {
  const req = await loadActiveRequest(db, authReqId);
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ 'merchantOAuthClient.oauthClientId': req.clientId }, { projection: { merchantName: 1 } });
  return {
    auth_req_id: req.authReqId,
    challenge: req.challenge,
    binding_message: req.bindingMessage,
    client_id: req.clientId,
    client_name: merchant?.merchantName ?? req.clientId,
    scopes: req.scopes,
    status: req.status,
  };
}

// ── Authentication Device: pending list (decoupled in-app AD, session-gated) ──
export async function listPending(db: Db, sub: string): Promise<ChallengeView[]> {
  if (!sub) throw oauth401('invalid_token', 'Authenticated session required');
  const rows = await db
    .collection<PartyBackchannelAuthenticationRecord>(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION)
    .find({ customerAuthenticationInstanceReference: sub, status: 'pending' })
    .sort({ recordCreatedDateTime: -1 })
    .toArray();
  return rows
    .filter((r) => r.expiresAt > new Date())
    .map((r) => ({
      auth_req_id: r.authReqId,
      challenge: r.challenge,
      binding_message: r.bindingMessage,
      client_id: r.clientId,
      client_name: r.clientId,
      scopes: r.scopes,
      status: r.status,
    }));
}

// ── Authentication Device: approve (assertion-authenticated) ──────────────────
export interface ApprovalInput {
  credentialId: string;
  signature: string;   // base64url signature over the challenge
}

export async function recordApproval(db: Db, authReqId: string, input: ApprovalInput): Promise<{ status: string }> {
  const req = await loadActiveRequest(db, authReqId);

  const cred = await db
    .collection<PartyEnrolledCredentialRecord>(PARTY_ENROLLED_CREDENTIAL_COLLECTION)
    .findOne({ credentialId: input.credentialId, status: 'active' });
  if (!cred) {
    emitCibaEvent(db, req.customerAuthenticationInstanceReference, req.clientId, 'auth.ciba.approve', 'rejected', { authReqId, reason: 'credential_not_found' });
    throw oauth401('invalid_grant', 'Credential not found or revoked');
  }
  // The credential owner MUST match the sub resolved from the hint.
  if (cred.customerAuthenticationInstanceReference !== req.customerAuthenticationInstanceReference) {
    emitCibaEvent(db, req.customerAuthenticationInstanceReference, req.clientId, 'auth.ciba.approve', 'rejected', { authReqId, reason: 'owner_mismatch' });
    throw oauth401('invalid_grant', 'Credential does not belong to the requested user');
  }
  // The signature over the challenge IS the authentication.
  const ok = verifySignature(cred.alg, cred.publicKeyPem, req.challenge, input.signature);
  if (!ok) {
    emitCibaEvent(db, req.customerAuthenticationInstanceReference, req.clientId, 'auth.ciba.approve', 'rejected', { authReqId, reason: 'bad_signature' });
    throw oauth401('invalid_grant', 'Signature verification failed');
  }

  const now = new Date();
  // Only a still-pending request may transition to approved. If it was already approved/denied/
  // consumed/expired, matchedCount is 0: fail with invalid_grant and do NOT bump signCount, so an
  // already-handled auth_req_id cannot be replayed to bump the counter.
  const upd = await db.collection<PartyBackchannelAuthenticationRecord>(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION).updateOne(
    { authReqId, status: 'pending' },
    { $set: { status: 'approved', credentialIdUsed: cred.credentialId, signatureVerifiedAt: now } },
  );
  if (upd.matchedCount === 0) {
    emitCibaEvent(db, req.customerAuthenticationInstanceReference, req.clientId, 'auth.ciba.approve', 'rejected', { authReqId, reason: 'not_pending' });
    throw oauthError(400, 'invalid_grant', 'Request is not pending (already handled or expired)');
  }
  // Anti-clone: bump the monotonic signCount and record last use.
  await db.collection<PartyEnrolledCredentialRecord>(PARTY_ENROLLED_CREDENTIAL_COLLECTION).updateOne(
    { credentialId: cred.credentialId },
    { $set: { lastUsedAt: now }, $inc: { signCount: 1 } },
  );

  emitCibaEvent(db, req.customerAuthenticationInstanceReference, req.clientId, 'auth.ciba.approve', 'approved', { authReqId, credentialId: cred.credentialId });

  // ping/push: notify the client out-of-band (fire-and-forget).
  if (req.deliveryMode === 'ping' || req.deliveryMode === 'push') {
    void deliverBackchannelNotification(db, { ...req, status: 'approved' }).catch(() => {});
  }
  return { status: 'approved' };
}

// ── Authentication Device: deny (assertion or session) ────────────────────────
export async function recordDenial(
  db: Db,
  authReqId: string,
  input: { credentialId?: string; signature?: string; sessionSub?: string },
): Promise<{ status: string }> {
  const req = await loadActiveRequest(db, authReqId);

  // Anti-DoS: a bare auth_req_id holder cannot deny. Require a valid signed assertion OR a session
  // belonging to the request's user.
  let authorized = false;
  if (input.sessionSub && input.sessionSub === req.customerAuthenticationInstanceReference) {
    authorized = true;
  } else if (input.credentialId && input.signature) {
    const cred = await db
      .collection<PartyEnrolledCredentialRecord>(PARTY_ENROLLED_CREDENTIAL_COLLECTION)
      .findOne({ credentialId: input.credentialId, status: 'active' });
    if (cred && cred.customerAuthenticationInstanceReference === req.customerAuthenticationInstanceReference) {
      authorized = verifySignature(cred.alg, cred.publicKeyPem, req.challenge, input.signature);
    }
  }
  if (!authorized) throw oauth401('invalid_grant', 'Denial requires a valid assertion or the owner session');

  const upd = await db.collection<PartyBackchannelAuthenticationRecord>(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION).updateOne(
    { authReqId, status: 'pending' },
    { $set: { status: 'denied' } },
  );
  // A non-pending auth_req_id (already handled) must not report a fresh denial or emit an audit event.
  if (upd.matchedCount === 0) {
    throw oauthError(400, 'invalid_grant', 'Request is not pending (already handled or expired)');
  }
  emitCibaEvent(db, req.customerAuthenticationInstanceReference, req.clientId, 'auth.ciba.deny', 'rejected', { authReqId });
  return { status: 'denied' };
}

// ── Token endpoint: redeem the ciba grant ─────────────────────────────────────
export async function redeemCibaGrant(db: Db, clientId: string, authReqId: string): Promise<TokenResponse> {
  if (!authReqId) throw oauthError(400, 'invalid_request', 'auth_req_id is required');
  const col = db.collection<PartyBackchannelAuthenticationRecord>(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION);
  const req = await col.findOne({ authReqId });

  // Unknown or foreign auth_req_id -> invalid_grant (do not leak which).
  if (!req || req.clientId !== clientId) throw oauthError(400, 'invalid_grant', 'Unknown auth_req_id');

  if (req.status === 'consumed') throw oauthError(400, 'invalid_grant', 'auth_req_id already redeemed');
  if (req.status === 'denied') throw oauthError(400, 'access_denied', 'The user denied the request');
  if (req.expiresAt < new Date() || req.status === 'expired') {
    await col.updateOne({ authReqId }, { $set: { status: 'expired' } });
    throw oauthError(400, 'expired_token', 'auth_req_id has expired');
  }
  if (req.status === 'pending') {
    // slow_down if the client polls faster than the interval.
    const now = new Date();
    const last = req.lastPolledAt?.getTime() ?? 0;
    await col.updateOne({ authReqId }, { $set: { lastPolledAt: now } });
    if (now.getTime() - last < req.interval * 1000) {
      throw oauthError(400, 'slow_down', 'Polling too frequently');
    }
    throw oauthError(400, 'authorization_pending', 'The user has not yet approved the request');
  }

  // status === 'approved': mint tokens and consume the request.
  const client = await resolveOAuthClient(db, clientId);
  const tokens = await issueTokens(db, req.customerAuthenticationInstanceReference, clientId, req.scopes, CIBA_GRANT, {
    tokenLifetimeSeconds: client.tokenLifetimeSeconds,
    refreshTokenLifetimeDays: client.refreshTokenLifetimeDays,
  });
  await col.updateOne({ authReqId, status: 'approved' }, { $set: { status: 'consumed' } });
  emitCibaEvent(db, req.customerAuthenticationInstanceReference, clientId, 'auth.ciba.token_issued', 'approved', { authReqId, scopes: req.scopes });
  return tokens;
}

// ── ping/push delivery via the low-level webhook primitive ────────────────────
export async function deliverBackchannelNotification(
  db: Db,
  req: PartyBackchannelAuthenticationRecord,
): Promise<void> {
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ 'merchantOAuthClient.oauthClientId': req.clientId });
  const endpoint = merchant?.merchantOAuthClient?.oauthBackchannelClientNotificationEndpoint;
  if (!endpoint || !req.clientNotificationToken) return;

  const data: Record<string, unknown> = { auth_req_id: req.authReqId };
  if (req.deliveryMode === 'push') {
    // push carries the tokens in the (TLS) notification body. Recommend poll/ping over push.
    const client = await resolveOAuthClient(db, req.clientId);
    const tokens = await issueTokens(db, req.customerAuthenticationInstanceReference, req.clientId, req.scopes, CIBA_GRANT, {
      tokenLifetimeSeconds: client.tokenLifetimeSeconds,
      refreshTokenLifetimeDays: client.refreshTokenLifetimeDays,
    });
    await db.collection<PartyBackchannelAuthenticationRecord>(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION)
      .updateOne({ authReqId: req.authReqId, status: 'approved' }, { $set: { status: 'consumed' } });
    Object.assign(data, tokens);
  }

  // The client_notification_token authenticates the callback (CIBA spec). The deliverWebhook HMAC
  // secret reuses the same token so the payload is also integrity-protected.
  await deliverWebhook(
    endpoint,
    { event: `ciba.${req.deliveryMode}`, timestamp: new Date().toISOString(), data },
    req.clientNotificationToken,
    { maxAttempts: 2, extraHeaders: { Authorization: `Bearer ${req.clientNotificationToken}` } },
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
async function loadActiveRequest(db: Db, authReqId: string): Promise<PartyBackchannelAuthenticationRecord> {
  const col = db.collection<PartyBackchannelAuthenticationRecord>(PARTY_BACKCHANNEL_AUTHENTICATION_COLLECTION);
  const req = await col.findOne({ authReqId });
  if (!req) throw oauthError(404, 'invalid_grant', 'Unknown auth_req_id');
  if (req.status === 'pending' && req.expiresAt < new Date()) {
    await col.updateOne({ authReqId }, { $set: { status: 'expired' } });
    throw oauthError(400, 'expired_token', 'auth_req_id has expired');
  }
  return req;
}

/**
 * OAuth 2.0 Authorization Server — core business logic (ADR-033, ADR-035)
 * Supports: authorization_code + PKCE (S256), client_credentials, refresh_token
 * Token format: RS256 JWT (access + id_token), opaque UUID (refresh)
 */
import { Db } from 'mongodb';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { MERCHANT_AGREEMENT_COLLECTION, MerchantAgreementControlRecord, OAuthGrantType } from '../../gateway/models/merchantAgreement.model';
import { describeScope, requiredScopesIn, ScopeDescriptor } from '../../gateway/services/merchantOAuth.service';
import { emitProcessEvent, attributionFromMerchantContext } from '../../provider/services/businessProcessEvent.service';
import { auditOAuth } from './oauthAudit.service';
import { PARTY_AUTH_CONSENT_COLLECTION, PartyAuthConsentRecord } from '../models/partyAuthConsent.model';
import { WebhookService } from '../../gateway/services/merchantWebhook.service';
import { CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord } from '../models/customerAuthentication.model';
import { PARTY_AUTHORIZATION_CODE_COLLECTION, PartyAuthorizationCodeRecord } from '../models/partyAuthorizationCode.model';
import { PARTY_ISSUED_TOKEN_COLLECTION, PartyIssuedTokenRecord } from '../models/partyIssuedToken.model';
import { getOAuthKeyProvider } from './oidcKeys.service';

// ── PKCE ──────────────────────────────────────────────────────────────────────

export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

// ── Client Resolution ─────────────────────────────────────────────────────────

export interface OAuthClientInfo {
  clientId: string;
  merchantAgreementInstanceReference: string;
  merchantName: string;
  redirectUris: string[];
  grantTypes: OAuthGrantType[];
  scopes: string[];
  clientStatus: string;
  merchantStatus: string;
  requirePkce: boolean;
  tokenLifetimeSeconds: number;
  refreshTokenLifetimeDays: number;
  oauthLogoUri?: string;    // v18: OIDC logo_uri — branding on the consent page (A-22)
  oauthClientUri?: string;  // v18: OIDC client_uri — merchant home page link
}

export async function resolveOAuthClient(
  db: Db,
  clientId: string,
  clientSecret?: string,
  opts?: { requireClientAuthentication?: boolean },
): Promise<OAuthClientInfo> {
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ 'merchantOAuthClient.oauthClientId': clientId });

  if (!merchant || !merchant.merchantOAuthClient) {
    throw oauth401('invalid_client', 'Unknown client_id');
  }

  const cfg = merchant.merchantOAuthClient;
  if (cfg.oauthClientStatus !== 'active') {
    throw oauth401('invalid_client', 'Client is not active');
  }
  if (merchant.merchantAgreementStatus !== 'active') {
    throw oauth401('invalid_client', 'Merchant account is not active');
  }

  // A CONFIDENTIAL client (one provisioned with a secret) MUST authenticate at the token endpoint
  // for every grant (RFC 6749 §3.2.1). Enforced only when the caller is authenticating the client
  // (token/introspection endpoints, requireClientAuthentication=true) — not for internal metadata
  // lookups (authorize page, post-auth token issuance). Previously the secret was validated only
  // when it happened to be present, so omitting it bypassed authentication entirely on the
  // authorization_code and refresh_token flows. Public clients (no secret hash) rely on PKCE.
  const isConfidential = typeof cfg.oauthClientSecretHash === 'string' && cfg.oauthClientSecretHash.length > 0;
  if (opts?.requireClientAuthentication && isConfidential && (clientSecret === undefined || clientSecret === '')) {
    throw oauth401('invalid_client', 'client authentication required (confidential client)');
  }
  if (clientSecret !== undefined && clientSecret !== '') {
    const valid = await bcrypt.compare(clientSecret, cfg.oauthClientSecretHash);
    if (!valid) throw oauth401('invalid_client', 'Invalid client_secret');
  }

  return {
    clientId: cfg.oauthClientId,
    merchantAgreementInstanceReference: merchant.merchantAgreementInstanceReference,
    merchantName: merchant.merchantName,
    redirectUris: cfg.oauthRedirectUris,
    grantTypes: cfg.oauthGrantTypes,
    scopes: cfg.oauthScopes,
    clientStatus: cfg.oauthClientStatus,
    merchantStatus: merchant.merchantAgreementStatus,
    requirePkce: cfg.oauthRequirePkce,
    tokenLifetimeSeconds: cfg.oauthTokenLifetimeSeconds ?? 3600,
    refreshTokenLifetimeDays: cfg.oauthRefreshTokenLifetimeDays ?? 30,
    oauthLogoUri: cfg.oauthLogoUri,
    oauthClientUri: cfg.oauthClientUri,
  };
}

// ── Authorization Initiation ──────────────────────────────────────────────────

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  nonce?: string;
}

export interface AuthorizeValidated {
  client: OAuthClientInfo;
  scopes: string[];              // scopes to be granted (after any user selection is applied)
  scopeDescriptors: ScopeDescriptor[]; // v18 E-03: metadata for consent rendering
  redirectUri: string;
  state?: string;
  codeChallenge?: string;
  nonce?: string;
}

export async function initiateAuthorization(
  db: Db,
  params: AuthorizeParams,
): Promise<AuthorizeValidated> {
  if (params.responseType !== 'code') {
    throw oauthError(400, 'unsupported_response_type', 'Only response_type=code is supported');
  }

  const client = await resolveOAuthClient(db, params.clientId);

  if (!client.redirectUris.includes(params.redirectUri)) {
    throw oauthError(400, 'invalid_request', 'redirect_uri not registered for this client');
  }

  const requestedScopes = params.scope.split(' ').filter(Boolean);
  // v18 E-04: RFC 6749 §4.1.2.1 — reject any requested scope outside the client allowlist
  // instead of silently dropping it (previous behaviour narrowed via intersection).
  const invalid = requestedScopes.filter((s) => !client.scopes.includes(s));
  if (invalid.length > 0) {
    throw oauthError(400, 'invalid_scope', `Scope(s) not permitted for this client: ${invalid.join(' ')}`);
  }
  const allowedScopes = requestedScopes;
  if (!allowedScopes.includes('openid')) {
    throw oauthError(400, 'invalid_scope', 'scope must include openid');
  }
  // v18 E-03: a required scope must be requestable (present in the intersection) for the flow to proceed.
  const missingRequired = requiredScopesIn(client.scopes).filter((s) => !allowedScopes.includes(s));
  if (missingRequired.length > 0) {
    throw oauthError(400, 'invalid_scope', `Required scope(s) missing from request: ${missingRequired.join(' ')}`);
  }

  if (client.requirePkce && !params.codeChallenge) {
    throw oauthError(400, 'invalid_request', 'code_challenge required for this client (PKCE)');
  }
  if (params.codeChallenge && params.codeChallengeMethod !== 'S256') {
    throw oauthError(400, 'invalid_request', 'Only code_challenge_method=S256 is supported');
  }

  auditOAuth(db, 'oauth.authorize.initiated', {
    clientId: client.clientId,
    merchantName: client.merchantName,
    state: params.state,
    scopes: allowedScopes,
    outcome: 'approved',
  });

  return {
    client,
    scopes: allowedScopes,
    scopeDescriptors: allowedScopes.map(describeScope),
    redirectUri: params.redirectUri,
    state: params.state,
    codeChallenge: params.codeChallenge,
    nonce: params.nonce,
  };
}

// v18 E-04: apply the user's granular selection to the allowlist. Keeps only user-selected
// scopes that are actually allowed, and force-includes every required scope (openid) even if
// the user tried to omit it. Returns the effective granted set (order-preserving vs allowed).
export function applyUserScopeSelection(allowedScopes: string[], userSelected: string[]): string[] {
  const selected = new Set(userSelected);
  const required = new Set(requiredScopesIn(allowedScopes));
  return allowedScopes.filter((s) => selected.has(s) || required.has(s));
}

// ── Issue Authorization Code ──────────────────────────────────────────────────

export async function issueAuthorizationCode(
  db: Db,
  clientId: string,
  sub: string,
  validated: AuthorizeValidated,
): Promise<{ code: string; state?: string }> {
  const code = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

  const record: PartyAuthorizationCodeRecord = {
    code,
    clientId,
    partyAuthenticationInstanceReference: sub,
    redirectUri: validated.redirectUri,
    scopes: validated.scopes,
    ...(validated.codeChallenge && {
      codeChallenge: validated.codeChallenge,
      codeChallengeMethod: 'S256',
    }),
    state: validated.state,
    nonce: validated.nonce,
    expiresAt,
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'AuthorizationCode',
    recordCreatedDateTime: now,
  };

  await db.collection<PartyAuthorizationCodeRecord>(PARTY_AUTHORIZATION_CODE_COLLECTION).insertOne(record);

  auditOAuth(db, 'oauth.code.issued', {
    clientId,
    sub,
    state: validated.state,
    scopes: validated.scopes,
    outcome: 'approved',
  });

  return { code, state: validated.state };
}

// ── Exchange Authorization Code ───────────────────────────────────────────────

export async function exchangeAuthorizationCode(
  db: Db,
  clientId: string,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<TokenResponse> {
  const col = db.collection<PartyAuthorizationCodeRecord>(PARTY_AUTHORIZATION_CODE_COLLECTION);
  const record = await col.findOne({ code, clientId });

  if (!record) throw oauth401('invalid_grant', 'Authorization code not found or already used');
  if (record.usedAt) throw oauth401('invalid_grant', 'Authorization code already used');
  if (record.expiresAt < new Date()) throw oauth401('invalid_grant', 'Authorization code expired');
  if (record.redirectUri !== redirectUri) throw oauth401('invalid_grant', 'redirect_uri mismatch');

  if (record.codeChallenge) {
    if (!codeVerifier) throw oauth401('invalid_grant', 'code_verifier required (PKCE)');
    if (!verifyCodeChallenge(codeVerifier, record.codeChallenge)) {
      throw oauth401('invalid_grant', 'code_verifier does not match code_challenge');
    }
  }

  await col.updateOne({ code }, { $set: { usedAt: new Date() } });

  const client = await resolveOAuthClient(db, clientId);
  const tokens = await issueTokens(db, record.partyAuthenticationInstanceReference, clientId, record.scopes, 'authorization_code', {
    nonce: record.nonce,
    tokenLifetimeSeconds: client.tokenLifetimeSeconds,
    refreshTokenLifetimeDays: client.refreshTokenLifetimeDays,
  });

  auditOAuth(db, 'oauth.token.issued', {
    clientId,
    merchantName: client.merchantName,
    sub: record.partyAuthenticationInstanceReference,
    state: record.state,
    scopes: record.scopes,
    grantType: 'authorization_code',
    outcome: 'verified',
  });

  // Upsert consent grant record (SD-16). Created on first exchange; lastUsedAt updated on refresh.
  const consentCol = db.collection<PartyAuthConsentRecord>(PARTY_AUTH_CONSENT_COLLECTION);
  const existing = await consentCol.findOne({ partyAuthenticationInstanceReference: record.partyAuthenticationInstanceReference, oauthClientId: clientId });
  const now = new Date();
  // v18 E-06/E-07: record.scopes carries the user's granular selection (applied at /authorize grant).
  // Compute the delta vs the prior grant so a broadening (new scopes) is captured explicitly rather
  // than being an opaque overwrite. Re-consent is enforced upstream (the consent page is always shown);
  // here we persist the freshly-consented set and audit added/removed scopes.
  const sub = record.partyAuthenticationInstanceReference;
  const granted = record.scopes;
  const prior = existing?.grantedScopes ?? [];
  const added = granted.filter((s) => !prior.includes(s));
  const removed = prior.filter((s) => !granted.includes(s));
  if (existing) {
    await consentCol.updateOne(
      { consentId: existing.consentId },
      { $set: { grantedScopes: granted, consentStatus: 'active', lastUsedAt: now, recordUpdatedDateTime: now } },
    );
    // Audit the (re)consent on the business ledger (SD-16). Attribution ties it to the merchant client.
    emitProcessEvent(db, {
      entityType: 'customer',
      entityId: sub,
      processType: 'consent_management',
      processAction: added.length || removed.length ? 'oauth.consent.updated' : 'oauth.consent.reused',
      processOutcome: 'approved',
      performedByPartyReference: sub,
      performedByRole: 'customer',
      eventSummary: { clientId, consentId: existing.consentId, grantedScopes: granted, addedScopes: added, removedScopes: removed },
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'ConsentGrant',
      attribution: attributionFromMerchantContext({ clientId, merchantId: client.merchantAgreementInstanceReference, sub }),
    });
  } else {
    const consentId = uuidv4();
    await consentCol.insertOne({
      consentId,
      partyAuthenticationInstanceReference: record.partyAuthenticationInstanceReference,
      oauthClientId: clientId,
      merchantAgreementInstanceReference: client.merchantAgreementInstanceReference,
      merchantName: client.merchantName,
      grantedScopes: record.scopes,
      consentStatus: 'active',
      consentGrantedAt: now,
      lastUsedAt: now,
      bianServiceDomain: 'PartyAuthentication',
      bianBehaviorQualifier: 'ConsentGrant',
      recordCreatedDateTime: now,
      recordUpdatedDateTime: now,
      schemaVersion: 1,
    });
    // Fire oauth.authorization_granted webhook for this merchant (non-blocking)
    new WebhookService(db).dispatch( client.merchantAgreementInstanceReference, 'oauth.authorization_granted', {
      consentId,
      clientId,
      subject: record.partyAuthenticationInstanceReference,
      scopes: record.scopes,
      grantedAt: now.toISOString(),
    }).catch(() => {});
    // v18 E-07: audit the first-time consent grant on the business ledger (SD-16).
    emitProcessEvent(db, {
      entityType: 'customer',
      entityId: sub,
      processType: 'consent_management',
      processAction: 'oauth.consent.granted',
      processOutcome: 'approved',
      performedByPartyReference: sub,
      performedByRole: 'customer',
      eventSummary: { clientId, consentId, grantedScopes: granted, addedScopes: granted, removedScopes: [] },
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'ConsentGrant',
      attribution: attributionFromMerchantContext({ clientId, merchantId: client.merchantAgreementInstanceReference, sub }),
    });
  }

  return tokens;
}

// v18 E-10: scopes already granted to this client by this user (for re-consent highlighting).
// Empty array = no prior active grant → first-time consent (no "additional permissions" banner).
export async function getPriorConsentScopes(db: Db, sub: string, clientId: string): Promise<string[]> {
  const grant = await db
    .collection<PartyAuthConsentRecord>(PARTY_AUTH_CONSENT_COLLECTION)
    .findOne({ partyAuthenticationInstanceReference: sub, oauthClientId: clientId, consentStatus: 'active' });
  return grant?.grantedScopes ?? [];
}

// ── Client Credentials ────────────────────────────────────────────────────────

export async function issueClientCredentialsToken(
  db: Db,
  clientId: string,
  requestedScopes: string[],
): Promise<TokenResponse> {
  const client = await resolveOAuthClient(db, clientId);

  if (!client.grantTypes.includes('client_credentials')) {
    throw oauthError(400, 'unauthorized_client', 'client_credentials grant not permitted');
  }

  const allowedScopes = requestedScopes.length
    ? requestedScopes.filter((s) => client.scopes.includes(s))
    : client.scopes;

  const tokens = await issueTokens(db, clientId, clientId, allowedScopes, 'client_credentials', {
    tokenLifetimeSeconds: client.tokenLifetimeSeconds,
    refreshTokenLifetimeDays: client.refreshTokenLifetimeDays,
    isClientCredentials: true,
  });

  auditOAuth(db, 'oauth.token.issued', {
    clientId,
    merchantName: client.merchantName,
    scopes: allowedScopes,
    grantType: 'client_credentials',
    outcome: 'verified',
  });

  return tokens;
}

// ── Refresh Token ─────────────────────────────────────────────────────────────

export async function refreshAccessToken(
  db: Db,
  clientId: string,
  refreshTokenId: string,
): Promise<TokenResponse> {
  const col = db.collection<PartyIssuedTokenRecord>(PARTY_ISSUED_TOKEN_COLLECTION);
  const record = await col.findOne({ tokenId: refreshTokenId, tokenType: 'refresh', clientId });

  if (!record) throw oauth401('invalid_grant', 'Refresh token not found');
  if (record.revokedAt) throw oauth401('invalid_grant', 'Refresh token has been revoked');
  if (record.expiresAt < new Date()) throw oauth401('invalid_grant', 'Refresh token has expired');

  const client = await resolveOAuthClient(db, clientId);
  const tokens = await issueTokens(db, record.sub, clientId, record.scopes, 'refresh_token', {
    tokenLifetimeSeconds: client.tokenLifetimeSeconds,
    refreshTokenLifetimeDays: client.refreshTokenLifetimeDays,
  });

  auditOAuth(db, 'oauth.token.refreshed', {
    clientId,
    merchantName: client.merchantName,
    sub: record.sub,
    scopes: record.scopes,
    grantType: 'refresh_token',
    outcome: 'verified',
  });

  return tokens;
}

// ── Subject → Party resolution (SD-91 → SD-13) ─────────────────────────────────
// An OAuth/session token `sub` is the SD-91 login-record id (customerAuthenticationInstanceReference).
// Domain data (payout accounts, counterparties, executions) is keyed by the SD-13 partyInstanceReference.
// This bridges the two so merchant on-behalf-of endpoints (which bind on `sub`) can query domain data.
// Returns null when the sub is unknown (handled gracefully by callers — empty results, no throw).
export async function resolvePartyInstanceReference(db: Db, sub: string): Promise<string | null> {
  if (!sub) return null;
  const rec = await db
    .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .findOne(
      { customerAuthenticationInstanceReference: sub },
      { projection: { _id: 0, partyInstanceReference: 1 } },
    );
  return rec?.partyInstanceReference ?? null;
}

// ── Userinfo ──────────────────────────────────────────────────────────────────

export async function getUserinfo(db: Db, accessToken: string): Promise<Record<string, unknown>> {
  const payload = await verifyAccessToken(accessToken);
  const scopes: string[] = Array.isArray(payload.scope) ? payload.scope : (payload.scope as string ?? '').split(' ');

  const user = await db
    .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
    .findOne({ customerAuthenticationInstanceReference: payload.sub });

  if (!user) throw oauth401('invalid_token', 'User not found');

  const claims: Record<string, unknown> = { sub: payload.sub };
  if (scopes.includes('profile')) {
    claims.name = user.customerAuthenticationUserName;
    claims.preferred_username = user.customerAuthenticationEmailAddress;
  }
  if (scopes.includes('email')) {
    claims.email = user.customerAuthenticationEmailAddress;
  }

  auditOAuth(db, 'oauth.userinfo.accessed', {
    clientId: payload.aud as string | undefined,
    sub: payload.sub,
    scopes,
    outcome: 'verified',
  });

  return claims;
}

// ── Revoke Token ──────────────────────────────────────────────────────────────

export async function revokeToken(db: Db, token: string): Promise<void> {
  const col = db.collection<PartyIssuedTokenRecord>(PARTY_ISSUED_TOKEN_COLLECTION);
  // Try opaque refresh token first, then jti from JWT
  const byId = await col.findOne({ tokenId: token });
  if (byId) {
    await col.updateOne({ tokenId: token }, { $set: { revokedAt: new Date() } });
    auditOAuth(db, 'oauth.token.revoked', { clientId: byId.clientId, sub: byId.sub, scopes: byId.scopes, outcome: 'approved' });
    return;
  }
  // Try as access token jti
  try {
    const payload = await verifyAccessToken(token);
    await col.updateOne({ tokenId: payload.jti as string }, { $set: { revokedAt: new Date() } });
    auditOAuth(db, 'oauth.token.revoked', { clientId: payload.aud as string | undefined, sub: payload.sub, outcome: 'approved' });
  } catch {
    // RFC 7009: always return 200, no error for unknown tokens
  }
}

// ── Internal: Issue Tokens ────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  id_token?: string;
  refresh_token?: string;
}

interface IssueOptions {
  nonce?: string;
  tokenLifetimeSeconds: number;
  refreshTokenLifetimeDays: number;
  isClientCredentials?: boolean;
}

// Exported for reuse by the CIBA grant, which mints tokens on an approved backchannel request.
export async function issueTokens(
  db: Db,
  sub: string,
  clientId: string,
  scopes: string[],
  grantType: OAuthGrantType,
  opts: IssueOptions,
): Promise<TokenResponse> {
  const provider = getOAuthKeyProvider();
  const kid = provider.getKid();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + opts.tokenLifetimeSeconds;
  const jti = uuidv4();
  const issuer = process.env.PSP_BASE_URL ?? 'http://localhost:8081';

  const accessPayload = {
    iss: issuer,
    sub,
    aud: clientId,
    exp,
    iat: now,
    jti,
    scope: scopes.join(' '),
    token_type: 'Bearer',
  };

  // RS256 sign using the key provider
  const headerAndPayload = [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url'),
    Buffer.from(JSON.stringify(accessPayload)).toString('base64url'),
  ].join('.');

  const sigBuffer = await provider.sign(Buffer.from(headerAndPayload));
  const access_token = `${headerAndPayload}.${sigBuffer.toString('base64url')}`;

  // Store access token record for revocation tracking
  const col = db.collection<PartyIssuedTokenRecord>(PARTY_ISSUED_TOKEN_COLLECTION);
  await col.insertOne({
    tokenId: jti,
    tokenType: 'access',
    clientId,
    sub,
    scopes,
    grantType,
    expiresAt: new Date(exp * 1000),
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'IssuedToken',
    recordCreatedDateTime: new Date(),
  });

  const response: TokenResponse = {
    access_token,
    token_type: 'Bearer',
    expires_in: opts.tokenLifetimeSeconds,
    scope: scopes.join(' '),
  };

  // ID token — only for user-bearing flows (not client_credentials) with openid scope
  if (!opts.isClientCredentials && scopes.includes('openid')) {
    const idPayload: Record<string, unknown> = {
      iss: issuer,
      sub,
      aud: clientId,
      exp,
      iat: now,
      ...(opts.nonce && { nonce: opts.nonce }),
    };
    const user = await db
      .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
      .findOne({ customerAuthenticationInstanceReference: sub });

    if (user) {
      if (scopes.includes('email')) idPayload.email = user.customerAuthenticationEmailAddress;
      if (scopes.includes('profile')) {
        idPayload.name = user.customerAuthenticationUserName;
        idPayload.preferred_username = user.customerAuthenticationEmailAddress;
      }
    }

    const idHeaderAndPayload = [
      Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url'),
      Buffer.from(JSON.stringify(idPayload)).toString('base64url'),
    ].join('.');
    const idSig = await provider.sign(Buffer.from(idHeaderAndPayload));
    response.id_token = `${idHeaderAndPayload}.${idSig.toString('base64url')}`;
  }

  // Refresh token — not for client_credentials
  if (!opts.isClientCredentials && grantType !== 'client_credentials') {
    const refreshId = uuidv4();
    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + opts.refreshTokenLifetimeDays);

    await col.insertOne({
      tokenId: refreshId,
      tokenType: 'refresh',
      clientId,
      sub,
      scopes,
      grantType,
      accessTokenJti: jti,
      expiresAt: refreshExpiry,
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'IssuedToken',
      recordCreatedDateTime: new Date(),
    });

    response.refresh_token = refreshId;
  }

  return response;
}

// ── Token Verification ────────────────────────────────────────────────────────

export async function verifyAccessToken(token: string): Promise<jwt.JwtPayload> {
  const [headerB64] = token.split('.');
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  const kid = header.kid as string;

  const provider = getOAuthKeyProvider();
  // Resolve the public key for this token's kid — active OR a deprecated key still in
  // its grace period (ADR-036). Revoked/unknown kids return null and are rejected.
  const pubPem = await provider.getPublicPemByKid(kid);
  if (!pubPem) {
    throw oauth401('invalid_token', `Unknown or revoked kid: ${kid}`);
  }

  try {
    return jwt.verify(token, pubPem, { algorithms: ['RS256'] }) as jwt.JwtPayload;
  } catch (err) {
    throw oauth401('invalid_token', (err as Error).message);
  }
}

// ── Consent Grant Management (SD-16) ─────────────────────────────────────────

// v18: consent grant enriched with the merchant's OIDC logo (branding on the "Authorized Apps" list).
export type ConsentGrantWithBranding = PartyAuthConsentRecord & { oauthLogoUri?: string };

export async function listUserConsentGrants(
  db: Db,
  sub: string,
  status: 'active' | 'revoked' | 'all' = 'all',
): Promise<ConsentGrantWithBranding[]> {
  // Revoked grants are kept (soft-revoke) so the user can review past apps/operations and re-approve.
  const filter: Record<string, unknown> = { partyAuthenticationInstanceReference: sub };
  if (status !== 'all') filter.consentStatus = status;
  const grants = await db
    .collection<PartyAuthConsentRecord>(PARTY_AUTH_CONSENT_COLLECTION)
    .find(filter)
    .sort({ consentGrantedAt: -1 })
    .toArray();
  if (grants.length === 0) return [];

  // Batch-fetch the merchants to attach oauthLogoUri (OIDC logo_uri) without a per-grant round-trip.
  const clientIds = [...new Set(grants.map((g) => g.oauthClientId))];
  const merchants = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .find({ 'merchantOAuthClient.oauthClientId': { $in: clientIds } }, { projection: { 'merchantOAuthClient.oauthClientId': 1, 'merchantOAuthClient.oauthLogoUri': 1 } })
    .toArray();
  const logoByClient = new Map(merchants.map((m) => [m.merchantOAuthClient?.oauthClientId, m.merchantOAuthClient?.oauthLogoUri]));

  return grants.map((g) => ({ ...g, oauthLogoUri: logoByClient.get(g.oauthClientId) }));
}

// v18 D-01: detail of ONE consent grant owned by the calling user. Enriches the grant with the
// merchant's OIDC branding (logo_uri/client_uri) and expands each granted scope into a human-readable
// descriptor (SCOPE_CATALOG). Returns null when the grant does not belong to `sub` (the controller
// maps this to 404 so a foreign consentId does not leak existence). Self-scoped by construction.
export interface ConsentGrantDetail {
  consentId: string;
  oauthClientId: string;
  merchantAgreementInstanceReference: string;
  merchantName: string;
  oauthLogoUri?: string;
  oauthClientUri?: string;
  grantedScopes: ScopeDescriptor[];
  consentStatus: PartyAuthConsentRecord['consentStatus'];
  consentGrantedAt: Date;
  lastUsedAt?: Date;
  cibaEnabled?: boolean; // this client may initiate CIBA (passwordless/backchannel) on the user's behalf
}

export async function getUserConsentGrantDetail(
  db: Db,
  sub: string,
  consentId: string,
): Promise<ConsentGrantDetail | null> {
  const grant = await db
    .collection<PartyAuthConsentRecord>(PARTY_AUTH_CONSENT_COLLECTION)
    .findOne({ consentId, partyAuthenticationInstanceReference: sub });
  if (!grant) return null;

  // Attach the merchant's OIDC branding (logo_uri/client_uri) — same source as the list view.
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne(
      { 'merchantOAuthClient.oauthClientId': grant.oauthClientId },
      { projection: { 'merchantOAuthClient.oauthLogoUri': 1, 'merchantOAuthClient.oauthClientUri': 1, 'merchantOAuthClient.oauthGrantTypes': 1 } },
    );
  const cfg = merchant?.merchantOAuthClient;
  const cibaEnabled = (cfg?.oauthGrantTypes ?? []).includes('urn:openid:params:grant-type:ciba');

  return {
    consentId: grant.consentId,
    oauthClientId: grant.oauthClientId,
    merchantAgreementInstanceReference: grant.merchantAgreementInstanceReference,
    merchantName: grant.merchantName,
    oauthLogoUri: cfg?.oauthLogoUri,
    oauthClientUri: cfg?.oauthClientUri,
    grantedScopes: grant.grantedScopes.map(describeScope),
    consentStatus: grant.consentStatus,
    consentGrantedAt: grant.consentGrantedAt,
    lastUsedAt: grant.lastUsedAt,
    cibaEnabled,
  };
}

// v18 B-10: users who authorized a given merchant (cross-merchant audit for L1/L2/auditor).
// Reads partyAuthConsent filtered by merchantAgreementInstanceReference, joins the user's display
// name/email (SD-13) for a display-safe row. Search matches the user name/email/party ref. Paginated.
export interface MerchantAuthorizationRow {
  consentId: string;
  partyAuthenticationInstanceReference: string;
  userName?: string;
  userEmail?: string;
  grantedScopes: string[];
  consentStatus: ConsentGrantStatusLike;
  consentGrantedAt: Date;
  lastUsedAt?: Date;
}
type ConsentGrantStatusLike = PartyAuthConsentRecord['consentStatus'];

export async function listMerchantAuthorizations(
  db: Db,
  merchantId: string,
  opts: { q?: string; page?: number; limit?: number },
): Promise<{ authorizations: MerchantAuthorizationRow[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(opts.limit ?? 20, 100);

  const grants = await db
    .collection<PartyAuthConsentRecord>(PARTY_AUTH_CONSENT_COLLECTION)
    .find({ merchantAgreementInstanceReference: merchantId })
    .sort({ consentGrantedAt: -1 })
    .toArray();

  // Resolve display-safe user identity (SD-13) in one batch — no CHD, no IBAN.
  const subs = [...new Set(grants.map((g) => g.partyAuthenticationInstanceReference))];
  const users = subs.length
    ? await db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
        .find({ customerAuthenticationInstanceReference: { $in: subs } })
        .toArray()
    : [];
  const userById = new Map(users.map((u) => [u.customerAuthenticationInstanceReference, u]));

  let rows: MerchantAuthorizationRow[] = grants.map((g) => {
    const u = userById.get(g.partyAuthenticationInstanceReference);
    return {
      consentId: g.consentId,
      partyAuthenticationInstanceReference: g.partyAuthenticationInstanceReference,
      userName: u?.customerAuthenticationUserName,
      userEmail: u?.customerAuthenticationEmailAddress,
      grantedScopes: g.grantedScopes,
      consentStatus: g.consentStatus,
      consentGrantedAt: g.consentGrantedAt,
      lastUsedAt: g.lastUsedAt,
    };
  });

  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter((r) =>
      (r.userName ?? '').toLowerCase().includes(q) ||
      (r.userEmail ?? '').toLowerCase().includes(q) ||
      r.partyAuthenticationInstanceReference.toLowerCase().includes(q));
  }

  const total = rows.length;
  const authorizations = rows.slice((page - 1) * limit, page * limit);
  return { authorizations, total, page, limit };
}

export async function revokeConsentGrant(
  db: Db,
  sub: string,
  consentId: string,
  revokedBy: 'user' | 'merchant' | 'psp' = 'user',
): Promise<void> {
  const consent = await db
    .collection<PartyAuthConsentRecord>(PARTY_AUTH_CONSENT_COLLECTION)
    .findOne({ consentId, partyAuthenticationInstanceReference: sub });

  if (!consent) throw Object.assign(new Error('Consent grant not found'), { statusCode: 404 });
  if (consent.consentStatus === 'revoked') return;

  const now = new Date();
  await db.collection<PartyAuthConsentRecord>(PARTY_AUTH_CONSENT_COLLECTION).updateOne(
    { consentId },
    { $set: { consentStatus: 'revoked', consentRevokedAt: now, consentRevokedBy: revokedBy, recordUpdatedDateTime: now } },
  );

  // Revoke all active tokens for this user+client
  await db.collection<PartyIssuedTokenRecord>(PARTY_ISSUED_TOKEN_COLLECTION).updateMany(
    { sub, clientId: consent.oauthClientId, revokedAt: { $exists: false } },
    { $set: { revokedAt: now } },
  );

  // Fire oauth.authorization_revoked webhook (non-blocking)
  new WebhookService(db).dispatch( consent.merchantAgreementInstanceReference, 'oauth.authorization_revoked', {
    consentId,
    clientId: consent.oauthClientId,
    subject: sub,
    scopes: consent.grantedScopes,
    revokedAt: now.toISOString(),
    revokedBy,
  }).catch(() => {});
}

// Re-approve a previously revoked consent grant, reverting the user's earlier revocation from the
// Authorized Applications view. Self-scoped (must belong to `sub`). Idempotent when already active.
// This restores the CONSENT record + its prior scopes only; it mints NO tokens — the merchant still
// runs the OAuth authorization_code flow to obtain fresh tokens (the prior scopes now count as granted,
// so re-consent is smooth). Fires oauth.authorization_granted so the merchant learns access is back.
export async function reactivateConsentGrant(
  db: Db,
  sub: string,
  consentId: string,
): Promise<void> {
  const consent = await db
    .collection<PartyAuthConsentRecord>(PARTY_AUTH_CONSENT_COLLECTION)
    .findOne({ consentId, partyAuthenticationInstanceReference: sub });

  if (!consent) throw Object.assign(new Error('Consent grant not found'), { statusCode: 404 });
  if (consent.consentStatus === 'active') return; // already active — no-op

  const now = new Date();
  await db.collection<PartyAuthConsentRecord>(PARTY_AUTH_CONSENT_COLLECTION).updateOne(
    { consentId },
    {
      $set: { consentStatus: 'active', recordUpdatedDateTime: now },
      $unset: { consentRevokedAt: '', consentRevokedBy: '' },
    },
  );

  // Fire oauth.authorization_granted webhook (non-blocking) so the merchant knows access was restored.
  new WebhookService(db).dispatch(consent.merchantAgreementInstanceReference, 'oauth.authorization_granted', {
    consentId,
    clientId: consent.oauthClientId,
    subject: sub,
    scopes: consent.grantedScopes,
    grantedAt: now.toISOString(),
    reinstated: true,
  }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function oauth401(error: string, description: string): Error {
  return Object.assign(new Error(description), { statusCode: 401, oauthError: error });
}

export function oauthError(status: number, error: string, description: string): Error {
  return Object.assign(new Error(description), { statusCode: status, oauthError: error });
}

export interface IssueTokenOptions extends IssueOptions {}

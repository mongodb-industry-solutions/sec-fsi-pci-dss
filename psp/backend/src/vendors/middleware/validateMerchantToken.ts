/**
 * Middleware for OAuth-authenticated Merchant Portal requests (ADR-037)
 * Validates RS256 JWT, extracts client_id → resolves merchant, checks scopes.
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../security/tokenVerifier';
import { MERCHANT_AGREEMENT_COLLECTION, MerchantAgreementControlRecord } from '../../modules/gateway/models/merchantAgreement.model';
import { findClientById } from '../../modules/gateway/services/oauthClientRegistry.service';

export interface MerchantTokenContext {
  merchantId: string;
  merchantName: string;
  clientId: string;
  scopes: string[];
  sub: string;
  /**
   * The business record the token's subject owns, carried through from the `account_holder` claim.
   *
   * Dropping it was a silent data loss: the owner resolver reads the binding off this context, found
   * nothing, and every merchant-channel list answered with an empty page instead of the person's
   * records. An authorised caller being shown nothing is worse than being refused, because it reads
   * as "you have no accounts" rather than as a fault.
   */
  accountHolderRef?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    merchantContext?: MerchantTokenContext;
  }
}

// Defensive Authorization-header parse: case-insensitive "Bearer" prefix + trimmed token, so
// odd casing / extra whitespace does not leak the scheme into the token or mis-parse the header.
// A naive `replace('Bearer ', '')` would mishandle those and could pick up a later substring match.
export function extractBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(authorization);
  return match ? match[1] : undefined;
}

/**
 * The client that obtained the token, from the claim that names it.
 *
 * Read from `client_id`, never from `aud`. Since v39 the audience names the RESOURCE SERVER, per
 * RFC 9068, so reading a client out of it resolved the string "leafypay" as a client id, found no
 * such client, and silently reported that there was no merchant here. Every merchant-channel route
 * then fell through to the first-party session path, which is a different contract: it expects the
 * party in the URL rather than resolving the owner from the token, so a merchant asking for its
 * customer's accounts was told a party reference was required.
 */
function clientOf(payload: { client_id?: unknown; aud?: unknown }): string {
  if (typeof payload.client_id === 'string' && payload.client_id) return payload.client_id;
  // No fallback to `aud`: it does not name a client, and pretending it might would restore exactly
  // the confusion this replaces.
  return '';
}

export async function validateMerchantToken(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredScope?: string,
): Promise<void> {
  const bearer = extractBearerToken(request.headers.authorization);
  if (!bearer) {
    return reply.status(401).send({ error: 'invalid_token', error_description: 'Missing Bearer token' }) as any;
  }

  // The verifier answers null rather than throwing: an invalid token is a refusal, not an error.
  // Every refusal reads the same, so nothing here tells a caller WHY it was refused.
  const payload = await verifyAccessToken(bearer);
  if (!payload) {
    return reply.status(401).send({ error: 'invalid_token', error_description: 'The token is not valid.' }) as any;
  }

  const db = (request.server as any).db;
  const clientId = clientOf(payload);
  const scopes = Array.isArray(payload.scope) ? payload.scope : String(payload.scope ?? '').split(' ').filter(Boolean);

  if (requiredScope && !scopes.includes(requiredScope)) {
    return reply.status(403).send({
      error: 'insufficient_scope',
      error_description: `Required scope: ${requiredScope}`,
    }) as any;
  }

  const client = await findClientById(db, clientId);
  if (!client) {
    return reply.status(401).send({ error: 'invalid_token', error_description: 'Unknown OAuth client' }) as any;
  }
  if (client.oauthClientStatus !== 'active') {
    return reply.status(401).send({ error: 'invalid_token', error_description: 'OAuth client is not active' }) as any;
  }

  // The owner's commercial standing is still checked, so a suspended merchant's live token stops
  // working rather than running until it expires. Two reads until the registry moves out and the
  // client's own status becomes authoritative.
  const merchant = await (db as any)
    .collection(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ merchantAgreementInstanceReference: client.merchantAgreementInstanceReference }) as MerchantAgreementControlRecord | null;
  if (!merchant || merchant.merchantAgreementStatus !== 'active') {
    return reply.status(403).send({ error: 'access_denied', error_description: 'Merchant account is not active' }) as any;
  }

  request.merchantContext = {
    merchantId: merchant.merchantAgreementInstanceReference,
    merchantName: merchant.merchantName,
    clientId,
    scopes,
    sub: payload.sub as string,
  };
}

/**
 * Best-effort variant for PUBLIC endpoints (e.g. the hosted-checkout create route) that still want to
 * ATTRIBUTE an action to the merchant + acting user when a valid OAuth Bearer is present, but must not
 * fail the request when it is absent/invalid. Never sends a reply; returns undefined on any problem.
 */
export async function tryMerchantContext(request: FastifyRequest): Promise<MerchantTokenContext | undefined> {
  const bearer = extractBearerToken(request.headers.authorization);
  if (!bearer) return undefined;
  try {
    const payload = await verifyAccessToken(bearer);
    // No token, no merchant context. This function answers "is there a merchant here", and an
    // unverifiable token means there is not.
    if (!payload) return undefined;
    const db = (request.server as any).db;
    const clientId = clientOf(payload);
    const scopes = Array.isArray(payload.scope) ? payload.scope : String(payload.scope ?? '').split(' ').filter(Boolean);
    const client = await findClientById(db, clientId);
    if (!client) return undefined;
    // Same eligibility as validateMerchantToken: never attribute actions to an inactive client or a
    // non-active merchant (would pollute audit/activity data with suspended/revoked principals).
    if (client.oauthClientStatus !== 'active') return undefined;
    const merchant = await (db as any)
      .collection(MERCHANT_AGREEMENT_COLLECTION)
      .findOne({ merchantAgreementInstanceReference: client.merchantAgreementInstanceReference }) as MerchantAgreementControlRecord | null;
    if (!merchant || merchant.merchantAgreementStatus !== 'active') return undefined;
    return {
      merchantId: merchant.merchantAgreementInstanceReference,
      merchantName: merchant.merchantName,
      clientId,
      scopes,
      sub: payload.sub as string,
      ...(typeof payload.account_holder === 'string' && payload.account_holder
        ? { accountHolderRef: payload.account_holder }
        : {}),
    };
  } catch {
    return undefined;
  }
}

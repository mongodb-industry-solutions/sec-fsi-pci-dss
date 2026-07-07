/**
 * Middleware for OAuth-authenticated Merchant Portal requests (ADR-037)
 * Validates RS256 JWT, extracts client_id → resolves merchant, checks scopes.
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../../modules/identity/services/oauth.service';
import { MERCHANT_AGREEMENT_COLLECTION, MerchantAgreementControlRecord } from '../../modules/gateway/models/merchantAgreement.model';

export interface MerchantTokenContext {
  merchantId: string;
  merchantName: string;
  clientId: string;
  scopes: string[];
  sub: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    merchantContext?: MerchantTokenContext;
  }
}

export async function validateMerchantToken(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredScope?: string,
): Promise<void> {
  const bearer = request.headers.authorization?.replace('Bearer ', '');
  if (!bearer) {
    return reply.status(401).send({ error: 'invalid_token', error_description: 'Missing Bearer token' }) as any;
  }

  let payload;
  try {
    payload = await verifyAccessToken(bearer);
  } catch (err: any) {
    return reply.status(401).send({ error: 'invalid_token', error_description: err.message }) as any;
  }

  const db = (request.server as any).db;
  const clientId = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud as string;
  const scopes = (payload.scope as string ?? '').split(' ').filter(Boolean);

  if (requiredScope && !scopes.includes(requiredScope)) {
    return reply.status(403).send({
      error: 'insufficient_scope',
      error_description: `Required scope: ${requiredScope}`,
    }) as any;
  }

  const merchant = await (db as any)
    .collection(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ 'merchantOAuthClient.oauthClientId': clientId }) as MerchantAgreementControlRecord | null;

  if (!merchant || !merchant.merchantOAuthClient) {
    return reply.status(401).send({ error: 'invalid_token', error_description: 'Unknown OAuth client' }) as any;
  }
  if (merchant.merchantOAuthClient.oauthClientStatus !== 'active') {
    return reply.status(401).send({ error: 'invalid_token', error_description: 'OAuth client is not active' }) as any;
  }
  if (merchant.merchantAgreementStatus !== 'active') {
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
  const bearer = request.headers.authorization?.replace('Bearer ', '');
  if (!bearer) return undefined;
  try {
    const payload = await verifyAccessToken(bearer);
    const db = (request.server as any).db;
    const clientId = Array.isArray(payload.aud) ? payload.aud[0] : (payload.aud as string);
    const scopes = ((payload.scope as string) ?? '').split(' ').filter(Boolean);
    const merchant = await (db as any)
      .collection(MERCHANT_AGREEMENT_COLLECTION)
      .findOne({ 'merchantOAuthClient.oauthClientId': clientId }) as MerchantAgreementControlRecord | null;
    if (!merchant || !merchant.merchantOAuthClient) return undefined;
    return {
      merchantId: merchant.merchantAgreementInstanceReference,
      merchantName: merchant.merchantName,
      clientId,
      scopes,
      sub: payload.sub as string,
    };
  } catch {
    return undefined;
  }
}

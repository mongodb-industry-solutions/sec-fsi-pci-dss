/**
 * RFC 7662: OAuth 2.0 Token Introspection
 * Allows registered OAuth clients to verify any token without managing public keys.
 */
import { Db } from 'mongodb';
import { verifyAccessToken } from './oauth.service';
import { PARTY_ISSUED_TOKEN_COLLECTION, PartyIssuedTokenRecord } from '../models/partyIssuedToken.model';
import { CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord } from '../models/customerAuthentication.model';

export interface IntrospectionResult {
  active: boolean;
  sub?: string;
  scope?: string;
  client_id?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  email?: string;
  name?: string;
}

export async function introspectToken(
  db: Db,
  token: string,
  tokenTypeHint?: string,
): Promise<IntrospectionResult> {
  const inactive: IntrospectionResult = { active: false };
  const col = db.collection<PartyIssuedTokenRecord>(PARTY_ISSUED_TOKEN_COLLECTION);

  // Try opaque refresh token first (if hint suggests it or it's not a JWT)
  const isJwt = token.includes('.');
  if (!isJwt || tokenTypeHint === 'refresh_token') {
    const record = await col.findOne({ tokenId: token, tokenType: 'refresh' });
    if (!record) return inactive;
    if (record.revokedAt) return inactive;
    if (record.expiresAt < new Date()) return inactive;
    return {
      active: true,
      sub: record.sub,
      scope: record.scopes.join(' '),
      client_id: record.clientId,
      token_type: 'Bearer',
      exp: Math.floor(record.expiresAt.getTime() / 1000),
      iat: Math.floor(record.recordCreatedDateTime.getTime() / 1000),
    };
  }

  // Access token: verify JWT RS256 signature + expiry
  let payload;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    return inactive;
  }

  // Check revocation in DB
  if (payload.jti) {
    const record = await col.findOne({ tokenId: payload.jti, tokenType: 'access' });
    if (record?.revokedAt) return inactive;
  }

  // Resolve user claims
  const result: IntrospectionResult = {
    active: true,
    sub: payload.sub,
    scope: payload.scope as string,
    client_id: payload.aud as string,
    token_type: 'Bearer',
    exp: payload.exp,
    iat: payload.iat,
    iss: payload.iss,
  };

  if (payload.sub) {
    const user = await db
      .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
      .findOne({ customerAuthenticationInstanceReference: payload.sub });
    if (user) {
      result.email = user.customerAuthenticationEmailAddress;
      result.name = user.customerAuthenticationUserName;
    }
  }

  return result;
}

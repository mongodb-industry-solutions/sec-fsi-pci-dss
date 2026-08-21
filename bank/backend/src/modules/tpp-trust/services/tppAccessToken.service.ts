import jwt from 'jsonwebtoken';
import { config } from '../../../config';
import { TppRegistrationControlRecord, TppRole, TppScope } from '../models/tppRegistration.model';

// The bank issues its own access tokens and is the only party that can. The signing key is the bank's,
// never the shared platform secret: a token minted elsewhere on the platform must not open this API.
export const ACCESS_TOKEN_TTL_SECONDS = 300;
const ISSUER = 'bankcore';
const AUDIENCE = 'bankcore-open-banking';

export interface TppTokenClaims {
  clientId: string;
  scopes: TppScope[];
  roles: TppRole[];
  expiresInSeconds: number;
}

export function issueAccessToken(
  registration: TppRegistrationControlRecord,
  scopes: TppScope[],
): { accessToken: string; expiresIn: number; scope: string } {
  const accessToken = jwt.sign(
    {
      client_id: registration.tppRegistrationClientId,
      scope: scopes.join(' '),
      roles: registration.tppRegistrationRoles ?? [],
    },
    config.bank.accessTokenSecret,
    {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: registration.tppRegistrationClientId,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    },
  );
  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, scope: scopes.join(' ') };
}

/** Returns the claims of a token this bank issued, or null for anything else. */
export function verifyAccessToken(token: string): TppTokenClaims | null {
  try {
    const payload = jwt.verify(token, config.bank.accessTokenSecret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as jwt.JwtPayload;
    const clientId = (payload.client_id as string) ?? payload.sub;
    if (!clientId) return null;
    return {
      clientId,
      scopes: typeof payload.scope === 'string' ? (payload.scope.split(' ').filter(Boolean) as TppScope[]) : [],
      roles: Array.isArray(payload.roles) ? (payload.roles as TppRole[]) : [],
      expiresInSeconds: payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 0,
    };
  } catch {
    return null;
  }
}

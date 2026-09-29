import { Db } from 'mongodb';
import bcrypt from 'bcryptjs';
import {
  TPP_REGISTRATION_COLLECTION, TppRegistrationControlRecord, TppScope,
} from '../models/tppRegistration.model';

// Verification of a TPP's client credentials. The bank holds the verifier, never the credential.

export interface TppAuthenticationFailure {
  // RFC 6749 §5.2 error code, so a client reads a standard reason rather than prose.
  error: 'invalid_client' | 'invalid_scope';
  description: string;
}

export type TppAuthenticationResult =
  | { ok: true; registration: TppRegistrationControlRecord; scopes: TppScope[] }
  | { ok: false; failure: TppAuthenticationFailure };

export async function findRegistrationByClientId(
  db: Db,
  clientId: string,
): Promise<TppRegistrationControlRecord | null> {
  return db.collection<TppRegistrationControlRecord>(TPP_REGISTRATION_COLLECTION)
    .findOne({ tppRegistrationClientId: clientId }, { projection: { _id: 0 } });
}

/**
 * Authenticates a client credentials request and narrows the requested scope to what was granted.
 * A wrong secret and an unknown client are deliberately indistinguishable: telling them apart is how a
 * caller enumerates registered clients.
 */
export async function authenticateTpp(
  db: Db,
  clientId: string,
  clientSecret: string,
  requestedScopes: string[],
): Promise<TppAuthenticationResult> {
  const refused: TppAuthenticationFailure = {
    error: 'invalid_client',
    description: 'Unknown client, wrong secret, or the registration is not active',
  };

  const registration = clientId ? await findRegistrationByClientId(db, clientId) : null;
  if (!registration) return { ok: false, failure: refused };
  if (registration.tppRegistrationStatus !== 'active') return { ok: false, failure: refused };
  if (!clientSecret) return { ok: false, failure: refused };

  const matches = await bcrypt.compare(clientSecret, registration.tppRegistrationClientSecretHash ?? '');
  if (!matches) return { ok: false, failure: refused };

  const granted = registration.tppRegistrationGrantedScopes ?? [];
  // An omitted scope means "everything granted", per RFC 6749 §3.3.
  if (requestedScopes.length === 0) return { ok: true, registration, scopes: granted };

  const unknown = requestedScopes.filter((scope) => !granted.includes(scope as TppScope));
  if (unknown.length > 0) {
    return {
      ok: false,
      failure: { error: 'invalid_scope', description: `Not granted to this client: ${unknown.join(' ')}` },
    };
  }
  return { ok: true, registration, scopes: requestedScopes as TppScope[] };
}

export async function hashClientSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

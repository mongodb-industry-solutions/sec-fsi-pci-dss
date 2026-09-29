import { config } from '../../config';

/**
 * Registering an application at the identity authority.
 *
 * This service holds the commercial record of a merchant and the client id it was given. It does not
 * hold the credential, generate it, hash it, or store it in any form. That is not tidiness: a service
 * that generates client secrets has a credential store, a hashing decision and a rotation policy, and
 * it will get one of those subtly wrong in a way nobody notices until an audit.
 *
 * The secret is returned once, at registration and at rotation, and is never retrievable afterwards.
 * "We can look it up for you" and "anyone who reaches this can have it" are the same property.
 */

export interface RegisteredClient {
  client_id: string;
  client_secret: string;
}

async function call<T>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<T | null> {
  const token = config.giam.registrationToken;
  // No credential means this service was never authorised to register anything. Returning null lets
  // the caller fail honestly rather than inventing a client id nothing will recognise.
  if (!token) return null;

  try {
    const response = await fetch(`${config.giam.issuerUrl.replace(/\/+$/, '')}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return response.status === 204 ? ({} as T) : (await response.json() as T);
  } catch {
    return null;
  }
}

export function registerAuthorityClient(input: {
  client_name: string;
  redirect_uris?: string[];
  grant_types?: string[];
  scope?: string;
  owner_ref?: string;
}): Promise<RegisteredClient | null> {
  return call<RegisteredClient>('/clients', { method: 'POST', body: input });
}

export function updateAuthorityClient(
  clientId: string,
  patch: { client_name?: string; redirect_uris?: string[]; scope?: string; logo_uri?: string },
): Promise<Record<string, unknown> | null> {
  return call(`/clients/${encodeURIComponent(clientId)}`, { method: 'PATCH', body: patch });
}

/** The previous secret stops working immediately. There is deliberately no overlap window. */
export function rotateAuthorityClientSecret(clientId: string): Promise<RegisteredClient | null> {
  return call<RegisteredClient>(`/clients/${encodeURIComponent(clientId)}/rotate-secret`, { method: 'POST' });
}

export function revokeAuthorityClient(clientId: string): Promise<Record<string, unknown> | null> {
  return call(`/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
}

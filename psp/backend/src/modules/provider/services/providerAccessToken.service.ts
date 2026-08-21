import { Db } from 'mongodb';
import { IntegrationProviderType, OAuth2Config } from '../models/externalProviderArrangement.model';
import { getActiveProvidersForType } from './integrationRegistry.service';
import { getL1QEClient } from '../../../vendors/encryption/roleClients';
import { config } from '../../../config';

// The PSP as the credential HOLDER: the client credentials of an external provider live in that
// provider's arrangement record, which is where credentials for external providers already live. This
// is the OAuth 2.0 client credentials grant the Integration Hub already declares as `oauth2_cc`, put to
// use for the first time.
//
// There is no fallback. If the record carries no credential the call fails, because the alternative
// (minting a token with the shared platform secret) is exactly the hole this closes.

interface CachedToken {
  accessToken: string;
  // A margin before the real expiry, so a token is never presented in the second it lapses.
  expiresAtMs: number;
}

const REFRESH_MARGIN_MS = 15_000;
const TIMEOUT_MS = 4000;
const cache = new Map<string, CachedToken>();

export interface AccessTokenResult {
  accessToken?: string;
  error?: string;
}

export interface ProviderEndpointResult {
  // Absolute base URL of the provider, as the seeded record holds it.
  baseUrl?: string;
  error?: string;
}

function cacheKey(providerReference: string, scope: string): string {
  return `${providerReference}|${scope}`;
}

/** Clears the cached tokens. For tests and for a credential rotation taking effect without a restart. */
export function resetProviderTokenCache(): void {
  cache.clear();
}

async function resolveDb(db?: Db): Promise<Db> {
  if (db) return db;
  // The provider arrangements carry no encrypted field, so the lookup tier is enough.
  const client = await getL1QEClient();
  return client.db(config.mongodb.dbName);
}

function oauth2ConfigOf(
  provider: { externalProviderArrangementInstanceReference: string; authConfig?: { scheme: string; oauth2?: OAuth2Config } },
): OAuth2Config | undefined {
  if (provider.authConfig?.scheme !== 'oauth2_cc') return undefined;
  const oauth2 = provider.authConfig.oauth2;
  if (!oauth2?.clientId || !oauth2.tokenEndpoint) return undefined;
  return oauth2;
}

/**
 * Resolves where the provider of a capability lives, from the record rather than from the environment.
 *
 * This is what makes repointing the PSP at another bank a data change: the seeder writes the absolute
 * endpoint per environment, and nothing at runtime falls back to a variable, because a silent fallback is
 * how two environments end up disagreeing about which bank they are talking to.
 */
export async function getProviderBaseUrl(
  providerType: IntegrationProviderType,
  options: { db?: Db } = {},
): Promise<ProviderEndpointResult> {
  let providers;
  try {
    providers = await getActiveProvidersForType(await resolveDb(options.db), providerType);
  } catch (err) {
    return { error: `provider lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  // The credential and the address belong to the same record: a provider carrying one without the other
  // is misconfigured, and picking them from different records is how a token ends up at the wrong bank.
  const provider = providers.find((candidate) => (
    oauth2ConfigOf(candidate) && candidate.externalProviderBaseUrl?.startsWith('http')
  ));
  if (!provider) {
    return { error: `no active ${providerType} provider carries an absolute base URL with credentials` };
  }
  return { baseUrl: provider.externalProviderBaseUrl!.replace(/\/$/, '') };
}

/**
 * Obtains an access token for the active provider of a capability, caching it until shortly before it
 * expires. Returns an error rather than throwing: the callers are read paths that must degrade
 * visibly instead of failing the whole response.
 */
export async function getProviderAccessToken(
  providerType: IntegrationProviderType,
  options: { db?: Db; scope?: string; fetchImpl?: typeof fetch } = {},
): Promise<AccessTokenResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let providers;
  try {
    providers = await getActiveProvidersForType(await resolveDb(options.db), providerType);
  } catch (err) {
    return { error: `provider lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const provider = providers.find((candidate) => oauth2ConfigOf(candidate));
  const oauth2 = provider ? oauth2ConfigOf(provider) : undefined;
  if (!provider || !oauth2) {
    return { error: `no active ${providerType} provider carries client credentials` };
  }

  const scope = options.scope ?? (oauth2.scopes ?? []).join(' ');
  const key = cacheKey(provider.externalProviderArrangementInstanceReference, scope);
  const cached = cache.get(key);
  if (oauth2.tokenCachingEnabled !== false && cached && cached.expiresAtMs > Date.now()) {
    return { accessToken: cached.accessToken };
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: oauth2.clientId,
    client_secret: oauth2.clientSecretPlaintext ?? '',
  });
  if (scope) body.set('scope', scope);

  try {
    const response = await fetchImpl(oauth2.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({})) as {
      access_token?: string; expires_in?: number; error?: string; error_description?: string;
    };
    if (!response.ok || !payload.access_token) {
      return { error: `token request refused (HTTP ${response.status}): ${payload.error_description ?? payload.error ?? 'no access_token'}` };
    }
    const lifetimeMs = Math.max(0, (payload.expires_in ?? 60) * 1000 - REFRESH_MARGIN_MS);
    if (oauth2.tokenCachingEnabled !== false) {
      cache.set(key, { accessToken: payload.access_token, expiresAtMs: Date.now() + lifetimeMs });
    }
    return { accessToken: payload.access_token };
  } catch (err) {
    return { error: `token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

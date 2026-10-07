import { BANK_PERMISSION_CATALOG, BANK_PERMISSION_CATALOG_VERSION } from '../../shared/models/permissionCatalog';
import { authorityMachineToken } from '../security/machineToken';
import { discoverAuthority, fetchAuthorityJson } from '@leafypay/giam-client';
import { config } from '../../config';

/**
 * Registers this bank's enforcement points with the identity authority, at boot.
 *
 * Non-fatal, for the same reason it is non-fatal anywhere: an unreachable authority must not stop a
 * bank serving requests that carry already-valid tokens, because those verify against a cached key
 * set and need the authority for nothing. Refusing to start would turn a registration problem into
 * an outage of the ledger.
 */
export async function registerResourceServer(): Promise<{ registered: boolean; reason?: string }> {
  const issuer = config.giam.issuerUrl;
  if (!issuer) return { registered: false, reason: 'no authority issuer is configured' };

  // The issuer names a REALM; the administrative surface hangs off the authority's origin and the
  // realm travels in the body, so a deployment still configures one URL.
  let adminBase: string;
  let realm: string;
  try {
    const url = new URL(issuer);
    adminBase = url.origin;
    realm = url.pathname.split('/').filter(Boolean).pop() ?? config.giam.resourceServerName;
  } catch {
    return { registered: false, reason: 'the configured issuer is not a valid URL' };
  }

  const token = await authorityMachineToken();
  if (!token) {
    return { registered: false, reason: 'no client credentials configured for this service' };
  }

  try {
    /**
     * The REALM endpoint, with this service's OWN token, not the admin one.
     *
     * Both endpoints reach the identical, idempotent write. The `/admin` one is gated by the
     * authority's administration token, which this service held only in order to declare its own
     * enforcement points: a credential that administers the whole authority, presented for the
     * narrowest possible reason. The realm endpoint takes an ordinary access token and judges it,
     * so the authority decides whether this client may register a catalog, which is the question
     * that should have been asked all along.
     *
     * Requires the client to hold `permissions:manage` in the realm, granted by the authority's
     * own seeder. Absent, this answers 403 rather than registering, and the caller reports it.
     */
    const response = await fetch(
      `${adminBase}/api/v1/realms/${realm}/resource-servers/${config.giam.resourceServerName}/permissions`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: config.giam.resourceServerName,
          realm,
          audience: config.giam.audience,
          catalogVersion: BANK_PERMISSION_CATALOG_VERSION,
          permissions: BANK_PERMISSION_CATALOG,
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return { registered: false, reason: `authority answered ${response.status}` };
    return { registered: true };
  } catch (err) {
    return { registered: false, reason: err instanceof Error ? err.message : 'registration failed' };
  }
}

export interface IssuerCheck {
  ok: boolean;
  reason?: string;
  /** What was found, for the startup line. */
  detail?: string;
}

/**
 * Checks, at boot, that the authority is reachable on the configured address and says where its keys are.
 *
 * The configured address is only where this process calls the authority. The issuer tokens carry is
 * learned from discovery, so what is checked is that discovery answers, names the SAME realm, and that
 * the key set it points at can be fetched from here. Any of those failing returns 401 on every request
 * afterwards, which reads as an authorisation bug anywhere but here.
 */
export async function checkIssuerCoherence(): Promise<IssuerCheck> {
  const calling = config.giam.issuerUrl?.replace(/[/]+$/, '');
  if (!calling) return { ok: false, reason: 'no authority address is configured' };

  try {
    const found = await discoverAuthority(calling);
    await fetchAuthorityJson(found.jwksUri, 'key set');
    const rebased = found.jwksUri !== found.advertisedJwksUri ? ` (advertised as ${found.advertisedJwksUri})` : '';
    return { ok: true, detail: `calling ${calling}, tokens carry iss ${found.issuer}, keys at ${found.jwksUri}${rebased}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'discovery failed' };
  }
}

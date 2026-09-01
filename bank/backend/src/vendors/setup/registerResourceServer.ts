import { BANK_PERMISSION_CATALOG, BANK_PERMISSION_CATALOG_VERSION } from '../../shared/models/permissionCatalog';
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

  try {
    const response = await fetch(
      `${adminBase}/admin/resource-servers/${config.giam.resourceServerName}/permissions`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(config.giam.registrationToken ? { authorization: `Bearer ${config.giam.registrationToken}` } : {}),
        },
        body: JSON.stringify({
          name: config.giam.resourceServerName,
          realm,
          audience: config.giam.audience,
          permissionCatalogVersion: BANK_PERMISSION_CATALOG_VERSION,
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
}

/**
 * Checks, at boot, that the configured issuer is both reachable and the one the authority claims.
 *
 * The configured URL is where discovery is fetched from AND what every token's `iss` is compared
 * against. Satisfying only one of the two fails nothing at boot and returns 401 on every request
 * afterwards, which reads as an authorisation bug anywhere but here.
 */
export async function checkIssuerCoherence(): Promise<IssuerCheck> {
  const issuer = config.giam.issuerUrl?.replace(/\/+$/, '');
  if (!issuer) return { ok: false, reason: 'no authority issuer is configured' };

  try {
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, reason: `discovery answered ${response.status}` };
    const metadata = await response.json() as { issuer?: string };
    if (!metadata.issuer) return { ok: false, reason: 'discovery document carries no issuer' };
    if (metadata.issuer.replace(/\/+$/, '') !== issuer) {
      return { ok: false, reason: `the authority issues "${metadata.issuer}", this bank expects "${issuer}"` };
    }
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'discovery failed';
    return { ok: false, reason: `${issuer} is not reachable from this process (${reason})` };
  }
}

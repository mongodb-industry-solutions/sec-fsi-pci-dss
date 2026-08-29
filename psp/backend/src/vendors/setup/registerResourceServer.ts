import { PERMISSION_CATALOG, PERMISSION_CATALOG_VERSION } from '../../shared/models/permissionCatalog';
import { config } from '../../config';

/**
 * Registers this application's enforcement points with the identity authority, at boot.
 *
 * Idempotent and versioned: the same catalog registered twice is one registration, and a changed one
 * is visible as a version bump rather than as a permission that quietly stops resolving.
 *
 * NON-FATAL on failure, deliberately. An unreachable authority at boot must not stop this
 * application serving requests that carry already-valid tokens: those tokens verify against a cached
 * key set and need nothing from the authority at all. Refusing to start would convert a registration
 * problem into a total outage, which is a worse failure than the one it would be reporting.
 */
export async function registerResourceServer(): Promise<{ registered: boolean; reason?: string }> {
  const issuer = config.giam.issuerUrl;
  if (!issuer) {
    return { registered: false, reason: 'no authority issuer is configured' };
  }

  // The issuer names a REALM; the administrative surface is not part of a realm's protocol path, so
  // it hangs off the authority's origin and the realm travels in the body. Deriving it this way
  // means a deployment still configures one URL.
  let adminBase: string;
  let realm: string;
  try {
    const url = new URL(issuer);
    adminBase = url.origin;
    realm = url.pathname.split('/').filter(Boolean).pop() ?? config.giam.resourceServerName;
  } catch {
    return { registered: false, reason: 'the configured issuer is not a valid URL' };
  }

  const body = {
    name: config.giam.resourceServerName,
    realm,
    audience: config.giam.audience,
    permissionCatalogVersion: PERMISSION_CATALOG_VERSION,
    permissions: PERMISSION_CATALOG,
  };

  try {
    const response = await fetch(`${adminBase}/admin/resource-servers/${config.giam.resourceServerName}/permissions`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(config.giam.registrationToken ? { authorization: `Bearer ${config.giam.registrationToken}` } : {}),
      },
      body: JSON.stringify(body),
      // Bounded, because a boot step that can hang forever is a boot step that will.
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { registered: false, reason: `authority answered ${response.status}` };
    }
    return { registered: true };
  } catch (err) {
    return { registered: false, reason: err instanceof Error ? err.message : 'registration failed' };
  }
}

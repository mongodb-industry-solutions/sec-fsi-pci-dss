import {
  platformEnvironment,
  resolveLinks,
  type PlatformEnvironment,
} from '@leafypay/platform-links';
import type {
  ExternalProviderArrangement, ProviderBaseUrlByEnvironment,
} from '../models/externalProviderArrangement.model';

/**
 * Where a provider answers in THIS deployment.
 *
 * One function, because "which host is this provider on" is asked by the dispatcher, by the token
 * service, by the health probe and by the admin screens, and four answers to it is four ways for a
 * request, its credential, its health status and the screen describing it to disagree about which
 * institution is involved.
 *
 * Two shapes of declaration, in this order:
 *
 *  1. `externalProviderBaseUrlByEnvironment`, the provider's address in every environment, declared
 *     once on the record and indexed by the environment's own id. This is what lets one registration
 *     serve local, staging and production: the deployment names itself through `PSP_ENVIRONMENT` and
 *     the matching entry is used. A real vendor with a sandbox host and a production host is declared
 *     the same way as the bank with a loopback and an in-cluster name.
 *  2. `externalProviderBaseUrl`, one address for everywhere. Still the right answer for a provider
 *     that has one, and it may itself name a platform link.
 *
 * Either may hold a platform link NAME rather than an address, so a service whose hosts are already
 * declared centrally is not restated per provider.
 *
 * It THROWS on an environment or a link name this platform does not have. The alternative, falling
 * back to another environment's row, means dispatching a live payment at a sandbox (or at
 * production), which is worse than not dispatching.
 */
export function providerBaseUrl(
  provider: Pick<ExternalProviderArrangement, 'externalProviderBaseUrl' | 'externalProviderBaseUrlByEnvironment'>,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const declared = declaredFor(provider, platformEnvironment(env));
  if (!declared) return undefined;
  // A trailing slash never reaches a dispatch: the configured paths are absolute, so `.../` plus
  // `/v1/...` would produce a double slash that some gateways route differently.
  return resolveLinks(declared, env).replace(/\/$/, '');
}

/** `providerBaseUrl` for a caller that must not throw, such as a read-only admin view. */
export function tryProviderBaseUrl(
  provider: Pick<ExternalProviderArrangement, 'externalProviderBaseUrl' | 'externalProviderBaseUrlByEnvironment'>,
  env: NodeJS.ProcessEnv = process.env,
): { baseUrl?: string; error?: string } {
  try {
    return { baseUrl: providerBaseUrl(provider, env) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** The raw declaration for an environment, before any link is bound. Exported for the admin view. */
export function declaredFor(
  provider: Pick<ExternalProviderArrangement, 'externalProviderBaseUrl' | 'externalProviderBaseUrlByEnvironment'>,
  environmentId: PlatformEnvironment,
  /** A single route's own map, which overrides the provider's when it names this environment. */
  routeOverride?: ProviderBaseUrlByEnvironment,
): string | undefined {
  return routeOverride?.[environmentId]?.trim()
    || provider.externalProviderBaseUrlByEnvironment?.[environmentId]?.trim()
    || provider.externalProviderBaseUrl?.trim()
    || undefined;
}

/** The host the platform RECEIVES on, for an inbound callback that does not declare its own. */
const DEFAULT_INBOUND_HOST = '{{psp}}';

export interface ConfiguredUrl {
  /** The common path, when there is one. Empty when each environment declares its own full URL. */
  path?: string;
  /** The declaration used for this environment, before binding: a link name or a literal URL. */
  declared?: string;
  /** The full address for the environment asked about. */
  resolved?: string;
  error?: string;
}

/**
 * One configured URL, resolved for one environment.
 *
 * The single answer to "where does this actually go", for both directions. Outbound is what this
 * platform calls at the provider; inbound is what the provider calls back on here, so its default
 * host is this platform's own rather than the provider's.
 *
 * Two shapes, and which one applies is decided by whether a PATH was given:
 *
 *  - WITH a path, the environment entry is a host and the path is appended. This is the common case
 *    and the one worth preferring: the operation is the same operation everywhere, so stating it once
 *    means the environments cannot drift into calling different endpoints by accident.
 *  - WITHOUT a path, the environment entry IS the whole URL. Necessary because equivalent services do
 *    not always agree on their paths: a vendor's sandbox can expose `/sandbox/v2/score` where
 *    production exposes `/v2/score`, and forcing a shared path would make one of the two unreachable.
 *
 * So the path is optional, not missing. A route with neither is simply not configured for that
 * environment, which is reported as such rather than resolved to a host with nothing after it.
 */
export function resolveConfiguredUrl(
  provider: Pick<ExternalProviderArrangement, 'externalProviderBaseUrl' | 'externalProviderBaseUrlByEnvironment'>,
  direction: 'outbound' | 'inbound',
  path: string | undefined,
  routeOverride: ProviderBaseUrlByEnvironment | undefined,
  environmentId: PlatformEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredUrl {
  const scoped = { ...env, PSP_ENVIRONMENT: environmentId } as NodeJS.ProcessEnv;
  // Inbound never falls back to the PROVIDER's map. That map is the provider's host, and a callback
  // address is ours: inheriting it published the bank's own hostname as the place to deliver
  // notifications to this platform, so every callback would have been aimed back at the bank.
  const declared = direction === 'inbound'
    ? (routeOverride?.[environmentId]?.trim() || DEFAULT_INBOUND_HOST)
    : declaredFor(provider, environmentId, routeOverride);
  const trimmedPath = path?.trim();

  try {
    // No common path: this environment's entry is the complete URL, used as it stands.
    if (!trimmedPath) {
      if (!declared) return { declared };
      const whole = resolveLinks(declared, scoped);
      // A host with no path is not a URL to call, and resolving it as one would dispatch at the
      // service root. Reported as unconfigured, which is what it is.
      return /^https?:\/\/[^/]+\/?$/i.test(whole)
        ? { declared, error: `no path configured for ${environmentId}, and "${declared}" is a host with no path` }
        : { declared, resolved: whole.replace(/\/$/, '') };
    }

    // An absolute path needs no host at all, and overriding it with one would silently retarget a
    // route an operator deliberately pinned.
    const boundPath = resolveLinks(trimmedPath, scoped);
    if (/^https?:\/\//i.test(boundPath)) return { path: trimmedPath, declared, resolved: boundPath };
    const host = declared ? resolveLinks(declared, scoped).replace(/\/$/, '') : undefined;
    if (!host) return { path: trimmedPath, declared };
    return {
      path: trimmedPath,
      declared,
      resolved: `${host}${boundPath.startsWith('/') ? boundPath : `/${boundPath}`}`,
    };
  } catch (err) {
    return { path: trimmedPath, declared, error: (err as Error).message };
  }
}

/**
 * Discovery of the authority, from the address THIS process reaches it on.
 *
 * Two addresses name one authority and they are not the same string. The one a service calls is
 * whatever its deployment can route to (a cluster service, a compose host, a loopback). The one in
 * every token's `iss` is the authority's public origin, which differs per environment and is set by
 * the authority alone. Requiring them to be equal ties every consumer to the authority's public
 * address, so the issuer is learned from discovery instead, and only the realm is pinned: the path
 * of the advertised issuer must be the path of the configured one.
 */

export interface AuthorityDiscovery {
  /** The `iss` this authority stamps on its tokens, as it advertises it. */
  issuer: string;
  /** The key set address, rebased to be reachable from this process. */
  jwksUri: string;
  /** The key set address exactly as discovery advertised it, for the logs. */
  advertisedJwksUri: string;
}

/** Names the URL and the network cause, because a bare "fetch failed" says neither. */
export async function fetchAuthorityJson<T>(
  url: string,
  what: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const why = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : 'fetch failed');
    throw new Error(`${what} ${url} unreachable (${why})`);
  }
  if (!response.ok) throw new Error(`${what} ${url} answered ${response.status}`);
  return await response.json() as T;
}

function trimmed(url: string): string {
  return url.replace(/\/+$/, '');
}

function pathOf(url: string): string {
  try {
    return trimmed(new URL(url).pathname);
  } catch {
    return '';
  }
}

/**
 * An advertised address, moved onto the address this process calls.
 *
 * Under the advertised issuer (on a path boundary, so `<issuer>Other` does not count) it is moved under
 * the reachable issuer, which also covers an ingress that adds or drops a path prefix. Anywhere else on
 * the advertised origin it keeps its path and takes the reachable origin. An address on a third host is
 * left alone: it was never ours to move.
 */
export function rebaseAdvertised(advertised: string, advertisedIssuer: string, reachableIssuer: string): string {
  const reachable = trimmed(reachableIssuer);
  const rest = advertised.slice(advertisedIssuer.length);
  if (advertised.startsWith(advertisedIssuer) && (rest === '' || /^[/?#]/.test(rest))) {
    return `${reachable}${rest}`;
  }
  try {
    const target = new URL(advertised);
    if (target.origin !== new URL(advertisedIssuer).origin) return advertised;
    return `${new URL(reachable).origin}${target.pathname}${target.search}${target.hash}`;
  } catch {
    return advertised;
  }
}

export async function discoverAuthority(
  reachableIssuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthorityDiscovery> {
  const reachable = trimmed(reachableIssuer);
  const metadata = await fetchAuthorityJson<{ issuer?: string; jwks_uri?: string }>(
    `${reachable}/.well-known/openid-configuration`,
    'discovery',
    fetchImpl,
  );
  if (!metadata.issuer) throw new Error(`discovery ${reachable} carries no issuer`);
  if (!metadata.jwks_uri) throw new Error(`discovery ${reachable} carries no jwks_uri`);

  const issuer = trimmed(metadata.issuer);
  // The origin may differ, the realm may not: this is what keeps a token from another realm out.
  if (pathOf(issuer) !== pathOf(reachable)) {
    throw new Error(`discovery ${reachable} advertises issuer "${issuer}", which is a different realm from the configured one`);
  }
  return {
    issuer,
    jwksUri: rebaseAdvertised(metadata.jwks_uri, issuer, reachable),
    advertisedJwksUri: metadata.jwks_uri,
  };
}

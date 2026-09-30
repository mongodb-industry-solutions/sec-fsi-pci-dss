/**
 * A service's own token at the authority, obtained with its own client credentials.
 *
 * Not a token it mints: one it is ISSUED. A service that mints its own is trusted because it holds
 * a secret the receiver also holds, so either side could have produced it and neither can prove
 * which did. A service that is issued one is trusted because the authority said so, and the
 * authority holds the only private key.
 *
 * Shared rather than copied per service for the reason the verifier is: three implementations are
 * three opinions about renewal, caching and failure, and they will not stay the same.
 */

export interface MachineTokenOptions {
  /** The realm issuer. The token endpoint hangs off it, so it carries the realm. */
  issuerUrl: string;
  /** Absent credentials mean this service was never registered to act as itself. */
  clientId?: string;
  clientSecret?: string;
  /**
   * The same budget the platform gives every other authority call. Four seconds was not enough:
   * a client-credentials exchange needs about two at rest, went over under load, and the caller
   * then dispatched with no token at all.
   */
  timeoutMs?: number;
  /** Renewed slightly early, so a token never expires in flight on the receiving side. */
  renewMarginSeconds?: number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class MachineTokenSource {
  private readonly cache = new Map<string, CachedToken>();

  constructor(private readonly options: MachineTokenOptions) {}

  /**
   * The cached token for a scope, or a fresh one.
   *
   * Answers null rather than throwing: a service with no credential configured must degrade
   * honestly, not send a request that will be refused and blame the receiver for refusing it.
   */
  async token(scope?: string): Promise<string | null> {
    const key = scope ?? 'default';
    const held = this.cache.get(key);
    if (held && held.expiresAt > Date.now()) return held.token;

    const { issuerUrl, clientId, clientSecret } = this.options;
    if (!clientId || !clientSecret) return null;

    const margin = this.options.renewMarginSeconds ?? 30;
    try {
      const response = await fetch(`${issuerUrl.replace(/\/+$/, '')}/protocol/oidc/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          ...(scope ? { scope } : {}),
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
      if (!response.ok) return null;

      const body = await response.json() as { access_token?: string; expires_in?: number };
      if (!body.access_token) return null;

      this.cache.set(key, {
        token: body.access_token,
        expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 60) - margin) * 1000,
      });
      return body.access_token;
    } catch {
      return null;
    }
  }

  /** Drops the cache, for a test and for a credential rotation taking effect without a restart. */
  reset(): void {
    this.cache.clear();
  }
}

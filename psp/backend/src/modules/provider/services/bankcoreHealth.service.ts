import { config } from '../../../config';
import { linkKind } from '@leafypay/platform-links';

// Health of the bank as a service, for the admin service list. Same states the provider registry
// already uses, plus one this platform needs and did not have.
export type ServiceState = 'ok' | 'degraded' | 'unreachable' | 'misconfigured' | 'disabled' | 'unknown';

export interface ServiceHealth {
  serviceName: string;
  serviceState: ServiceState;
  // Why, in one line, because reporting a network outage as a configuration error sends whoever is
  // debugging in the wrong direction.
  serviceDetail: string;
  serviceEndpoint: string;
  observedLatencyMs?: number;
}

const PROBE_TIMEOUT_MS = 3000;

export async function probeBankcore(fetchImpl: typeof fetch = fetch): Promise<ServiceHealth> {
  const endpoint = config.bankcore.baseUrl;
  const base: Omit<ServiceHealth, 'serviceState' | 'serviceDetail'> = {
    serviceName: 'bankcore',
    serviceEndpoint: endpoint,
  };

  if (!config.bankcore.enabled) {
    return { ...base, serviceState: 'disabled', serviceDetail: 'PSP_BANKCORE_ENABLED is false' };
  }
  // A malformed or browser-facing endpoint is a configuration fault, and it fails as a timeout, which
  // is exactly the misdiagnosis this state exists to prevent.
  const kind = linkKind(endpoint);
  if (kind === 'invalid') {
    return { ...base, serviceState: 'misconfigured', serviceDetail: `not an absolute http(s) URL: "${endpoint}"` };
  }

  const startedAt = Date.now();
  try {
    const response = await fetchImpl(`${endpoint}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { Accept: 'application/health+json' },
    });
    const observedLatencyMs = Date.now() - startedAt;

    // A 404 on /health means something answers on that host, but it is not bankcore.
    if (response.status === 404) {
      return { ...base, observedLatencyMs, serviceState: 'misconfigured', serviceDetail: 'no /health at this endpoint; wrong host' };
    }
    if (response.status === 503) {
      const body = await response.json().catch(() => ({})) as { checks?: Record<string, Array<{ output?: string }>> };
      const output = body.checks?.['mongodb:connectivity']?.[0]?.output;
      return { ...base, observedLatencyMs, serviceState: 'degraded', serviceDetail: output ?? 'bankcore reports itself degraded' };
    }
    if (!response.ok) {
      return { ...base, observedLatencyMs, serviceState: 'degraded', serviceDetail: `unexpected status ${response.status}` };
    }
    return { ...base, observedLatencyMs, serviceState: 'ok', serviceDetail: `responded in ${observedLatencyMs}ms` };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      serviceState: 'unreachable',
      serviceDetail: reason.includes('timeout') || reason.includes('aborted')
        ? `no response within ${PROBE_TIMEOUT_MS}ms`
        : reason,
    };
  }
}

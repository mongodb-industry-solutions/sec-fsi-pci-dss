// v37 P1.9: the bank's service state must distinguish "bankcore unreachable" from "capability
// misconfigured". Reporting a network outage as a configuration error sends debugging the wrong way.
import { describe, it, expect, vi, afterEach } from 'vitest';

async function probeWith(
  overrides: { enabled?: boolean; baseUrl?: string },
  fetchImpl: typeof fetch,
) {
  vi.resetModules();
  if (overrides.enabled !== undefined) process.env.PSP_BANKCORE_ENABLED = String(overrides.enabled);
  if (overrides.baseUrl !== undefined) process.env.PSP_BANKCORE_BASE_URL = overrides.baseUrl;
  const { probeBankcore } = await import('../../../../backend/src/modules/provider/services/bankcoreHealth.service');
  return probeBankcore(fetchImpl);
}

function respondWith(status: number, body: unknown = {}): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  delete process.env.PSP_BANKCORE_ENABLED;
  delete process.env.PSP_BANKCORE_BASE_URL;
});

describe('v37 P1.9: bankcore service health', () => {
  it('reports disabled while the kill switch is off, not unreachable', async () => {
    const health = await probeWith({ enabled: false }, respondWith(200));
    expect(health.serviceState).toBe('disabled');
    expect(health.serviceDetail).toContain('PSP_BANKCORE_ENABLED');
  });

  it('reports ok with the observed latency', async () => {
    const health = await probeWith({ enabled: true, baseUrl: 'http://bank:80' }, respondWith(200, { status: 'pass' }));
    expect(health.serviceState).toBe('ok');
    expect(typeof health.observedLatencyMs).toBe('number');
  });

  it('reports degraded, with the bank\'s own reason, when the bank cannot reach its database', async () => {
    const health = await probeWith(
      { enabled: true, baseUrl: 'http://bank:80' },
      respondWith(503, { status: 'fail', checks: { 'mongodb:connectivity': [{ output: 'bad crypt_shared path' }] } }),
    );
    expect(health.serviceState).toBe('degraded');
    expect(health.serviceDetail).toBe('bad crypt_shared path');
  });

  it('reports misconfigured, not unreachable, when the host answers but is not bankcore', async () => {
    const health = await probeWith({ enabled: true, baseUrl: 'http://bank:80' }, respondWith(404));
    expect(health.serviceState).toBe('misconfigured');
  });

  it('reports misconfigured for an endpoint that is not an absolute URL', async () => {
    const health = await probeWith({ enabled: true, baseUrl: '/api/v1/modules/aspsp' }, respondWith(200));
    expect(health.serviceState).toBe('misconfigured');
    expect(health.serviceDetail).toContain('absolute');
  });

  it('reports unreachable when nothing answers', async () => {
    const failing = (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const health = await probeWith({ enabled: true, baseUrl: 'http://bank:80' }, failing);
    expect(health.serviceState).toBe('unreachable');
    expect(health.serviceDetail).toContain('ECONNREFUSED');
  });

  it('reports a timeout as unreachable with the budget named', async () => {
    const timingOut = (async () => { throw new Error('The operation was aborted due to timeout'); }) as unknown as typeof fetch;
    const health = await probeWith({ enabled: true, baseUrl: 'http://bank:80' }, timingOut);
    expect(health.serviceState).toBe('unreachable');
    expect(health.serviceDetail).toMatch(/no response within \d+ms/);
  });
});

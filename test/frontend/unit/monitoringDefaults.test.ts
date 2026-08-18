// v37: reconciling the operator's stored monitoring config with the shipped defaults.
//
// Both cases here were live bugs. A new service never reached anyone with a stored config, and after
// the health aliases moved to /health/<service> the stored copy kept the old path and reported a
// healthy service as unreachable, which is indistinguishable from an outage.
import { describe, it, expect } from 'vitest';
import { mergeMonitoringDefaults, type MonitoringServiceShape } from '../../../frontend/src/lib/monitoringDefaults';

function service(overrides: Partial<MonitoringServiceShape> & { id: string }): MonitoringServiceShape {
  return {
    name: 'A service',
    description: 'desc',
    type: 'http',
    url: '/health/x',
    method: 'GET',
    enabled: true,
    intervalMs: 30000,
    timeoutMs: 10000,
    expectedStatus: 200,
    useApiBase: false,
    ...overrides,
  };
}

describe('v37: monitoring defaults reconciliation', () => {
  it('uses the shipped defaults when nothing is stored', () => {
    const defaults = [service({ id: 'api-server' })];
    const merged = mergeMonitoringDefaults([], defaults, []);
    expect(merged.services).toEqual(defaults);
    expect(merged.changed).toBe(true);
  });

  it('adopts a newly shipped service for an operator who already has a config', () => {
    const stored = [service({ id: 'api-server' })];
    const defaults = [service({ id: 'api-server' }), service({ id: 'bankcore', url: '/health/bankcore' })];
    const merged = mergeMonitoringDefaults(stored, defaults, ['api-server']);
    expect(merged.services.map((s) => s.id)).toEqual(['api-server', 'bankcore']);
    expect(merged.changed).toBe(true);
  });

  it('does not resurrect a service the operator deliberately removed', () => {
    const stored = [service({ id: 'api-server' })];
    const defaults = [service({ id: 'api-server' }), service({ id: 'bankcore' })];
    // bankcore was offered before, so its absence is a decision, not a gap.
    const merged = mergeMonitoringDefaults(stored, defaults, ['api-server', 'bankcore']);
    expect(merged.services.map((s) => s.id)).toEqual(['api-server']);
    expect(merged.changed).toBe(false);
  });

  it('refreshes a moved endpoint, which is what stopped a healthy service reading as unreachable', () => {
    const stored = [service({ id: 'merchant-app', url: '/merchant-health' })];
    const defaults = [service({ id: 'merchant-app', url: '/health/merchant' })];
    const merged = mergeMonitoringDefaults(stored, defaults, ['merchant-app']);
    expect(merged.services[0].url).toBe('/health/merchant');
    expect(merged.changed).toBe(true);
  });

  it('keeps the operator\'s own tuning while refreshing how to reach the service', () => {
    const stored = [service({
      id: 'bankcore', url: '/bankcore-health',
      enabled: false, intervalMs: 5000, timeoutMs: 2000, expectedStatus: 204,
    })];
    const defaults = [service({ id: 'bankcore', url: '/health/bankcore', name: 'Bankcore (ASPSP)' })];
    const [reconciled] = mergeMonitoringDefaults(stored, defaults, ['bankcore']).services;
    // Shipped owns the transport and the labels.
    expect(reconciled.url).toBe('/health/bankcore');
    expect(reconciled.name).toBe('Bankcore (ASPSP)');
    // The operator owns their tuning, including having switched it off.
    expect(reconciled.enabled).toBe(false);
    expect(reconciled.intervalMs).toBe(5000);
    expect(reconciled.timeoutMs).toBe(2000);
    expect(reconciled.expectedStatus).toBe(204);
  });

  it('leaves a service the operator added entirely alone', () => {
    const stored = [service({ id: 'my-own-thing', url: 'https://example.internal/ping', name: 'Mine' })];
    const merged = mergeMonitoringDefaults(stored, [service({ id: 'api-server' })], ['api-server']);
    expect(merged.services[0]).toEqual(stored[0]);
  });

  it('reports no change when stored already matches, so storage is not rewritten on every load', () => {
    const defaults = [service({ id: 'api-server' }), service({ id: 'bankcore', url: '/health/bankcore' })];
    const merged = mergeMonitoringDefaults([...defaults], defaults, ['api-server', 'bankcore']);
    expect(merged.changed).toBe(false);
  });

  it('the shipped file and the proxy agree on every default path', async () => {
    // The reconciliation is worthless if the file itself points somewhere the proxy does not forward.
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const root = resolve(__dirname, '../../..');
    const shipped = JSON.parse(readFileSync(resolve(root, 'frontend/public/monitoring-defaults.json'), 'utf8')) as {
      services: MonitoringServiceShape[];
    };
    const nextConfig = readFileSync(resolve(root, 'frontend/next.config.js'), 'utf8');
    for (const svc of shipped.services) {
      if (svc.useApiBase || !svc.url.startsWith('/')) continue;
      // Either the backend proxy covers it (/api/*, /health) or there is an explicit rewrite for it.
      const covered = svc.url === '/health'
        || svc.url.startsWith('/api/')
        || nextConfig.includes(`source: '${svc.url}'`);
      expect(covered, `${svc.id} probes ${svc.url}, which no rewrite forwards`).toBe(true);
    }
  });
});

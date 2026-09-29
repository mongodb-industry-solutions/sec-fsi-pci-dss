// The identity authority appears in the admin monitoring panel, probed WITHOUT the browser leaving
// the frontend origin.
//
// Same reasoning as bankcore: a direct browser fetch to the authority would need a CORS entry that
// exists for the app flows, not for a health probe, and would depend on the authority being published
// at all. The Next.js rewrite keeps the probe server side, and this suite is the mechanical guard.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../..');
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

interface MonitoringService {
  id: string;
  name: string;
  url: string;
  detailUrl?: string;
  useApiBase: boolean;
  enabled: boolean;
  expectedStatus: number;
}

const DEFAULTS = JSON.parse(read('psp/frontend/public/monitoring-defaults.json')) as { services: MonitoringService[] };

describe('the identity authority in the admin monitoring panel', () => {
  it('is a monitored service, enabled by default', () => {
    const giam = DEFAULTS.services.find((s) => s.id === 'giam');
    expect(giam, 'the authority must appear in monitoring-defaults.json').toBeTruthy();
    expect(giam!.enabled).toBe(true);
    expect(giam!.expectedStatus).toBe(200);
  });

  it('is probed through the frontend proxy, never at its own origin', () => {
    const giam = DEFAULTS.services.find((s) => s.id === 'giam')!;
    expect(giam.useApiBase, 'the authority is not behind the PSP API base').toBe(false);
    expect(giam.url).toBe('/health/giam');
    // Its health body is IETF health+json with component checks, so the same path serves the detail.
    expect(giam.detailUrl).toBe('/health/giam');
  });

  it('the rewrite prefers the private in-cluster host', () => {
    const config = read('psp/frontend/next.config.js');
    expect(config).toContain("{ source: '/health/giam', destination: `${authorityUrl}/health` }");
    expect(config).toContain('NEXT_PUBLIC_PSP_URL_AUTHORITY_PRIVATE');
  });

  it('the frontend image is built knowing the private authority host', () => {
    // Without this the proxy has nothing to point at and the panel shows a permanent red light.
    expect(read('.drone.yml').match(/NEXT_PUBLIC_PSP_URL_AUTHORITY_PRIVATE=http:\/\/sec-giam-web-app:80/g)?.length).toBe(2);
  });

  it('compose wires the same variable to the in-network authority', () => {
    expect(read('docker-compose.yml')).toContain('NEXT_PUBLIC_PSP_URL_AUTHORITY_PRIVATE');
  });
});

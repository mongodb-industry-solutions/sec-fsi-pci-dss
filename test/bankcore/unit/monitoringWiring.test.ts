// v37 P1.9/P6.7e-f: bankcore appears in the admin monitoring panel, and it is probed WITHOUT the
// browser ever leaving the frontend origin.
//
// The property being protected is the one the design depends on: bankcore is a private service with
// no public ingress, so a direct browser fetch fails as a CORS error locally and as unreachable in
// staging. Same bug, two symptoms, neither pointing at the cause. The Next.js rewrite is the fix, and
// this suite is the mechanical guard the plan asks for.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../../..');
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

interface MonitoringService {
  id: string;
  name: string;
  url: string;
  useApiBase: boolean;
  enabled: boolean;
  expectedStatus: number;
}

const DEFAULTS = JSON.parse(read('frontend/public/monitoring-defaults.json')) as { services: MonitoringService[] };

describe('v37 P1.9: bankcore in the admin monitoring panel', () => {
  it('is a monitored service, enabled by default', () => {
    const bankcore = DEFAULTS.services.find((s) => s.id === 'bankcore');
    expect(bankcore, 'bankcore must appear in monitoring-defaults.json').toBeTruthy();
    expect(bankcore!.enabled).toBe(true);
    expect(bankcore!.expectedStatus).toBe(200);
  });

  it('is probed through the frontend proxy, never at its own origin', () => {
    const bankcore = DEFAULTS.services.find((s) => s.id === 'bankcore')!;
    expect(bankcore.useApiBase, 'bankcore is not behind the PSP API base').toBe(false);
    expect(bankcore.url).toBe('/bankcore-health');
    // A same-origin relative path is the whole point: no host, no scheme, no preflight.
    expect(bankcore.url.startsWith('/')).toBe(true);
  });

  it('the rewrite resolves the private in-cluster host, with no public fallback', () => {
    const config = read('frontend/next.config.js');
    expect(config).toContain("{ source: '/bankcore-health', destination: `${bankcoreUrl}/health` }");
    expect(config).toContain('NEXT_PUBLIC_PSP_URL_BANKCORE_PRIVATE');
    // There is no public bankcore hostname to fall back to, unlike the merchant.
    expect(config).not.toContain('NEXT_PUBLIC_PSP_URL_BANKCORE_PUBLIC');
  });

  it('no frontend source fetches a bankcore URL directly', () => {
    // The grep gate the plan asks for. next.config.js is excluded: its destination is resolved
    // server-side by the Next.js proxy, which is exactly the mechanism that keeps this true.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue;
        const text = readFileSync(full, 'utf8');
        for (const match of text.matchAll(/fetch\([^)]*bankcore[^)]*\)/gi)) offenders.push(`${full}: ${match[0]}`);
        if (/https?:\/\/[^'"`\s]*bankcore/i.test(text)) offenders.push(`${full}: absolute bankcore URL`);
      }
    };
    walk(resolve(ROOT, 'frontend/src'));
    expect(offenders, 'the browser must reach bankcore only through the PSP or the proxy').toEqual([]);
  });
});

describe('v37 P1.7b: bankcore is deployable, and private', () => {
  const drone = read('.drone.yml');

  it('has an image build and a deploy step in both pipelines', () => {
    expect(drone.match(/- name: publish-bankcore/g)?.length).toBe(2);
    expect(drone).toContain('- name: deploy-bankcore-staging');
    expect(drone).toContain('- name: deploy-bankcore-production');
    expect(drone).toContain('dockerfile: bankcore/Dockerfile');
  });

  it('is deployed with NO ingress in either environment', () => {
    // A bank API is not something you expose to a browser. The chart's probe uses the in-cluster
    // /health, which is why no public hostname is needed for monitoring to work.
    // Bound each step at the next one, or the slice would run on into deploy-frontend, which does
    // declare ingress hosts.
    const bankcoreSteps = drone
      .split('- name: deploy-bankcore-')
      .slice(1)
      .map((rest) => rest.split('\n  - name:')[0]);
    expect(bankcoreSteps).toHaveLength(2);
    for (const step of bankcoreSteps) {
      expect(step).toContain('ingress.enabled=false');
      expect(step).not.toMatch(/ingress\.hosts/);
    }
  });

  it('the frontend image is built knowing the private bankcore host', () => {
    // Without this the proxy has nothing to point at and the panel shows a permanent red light.
    expect(drone.match(/NEXT_PUBLIC_PSP_URL_BANKCORE_PRIVATE=http:\/\/sec-fsi-pci-dss-bankcore-web-app:80/g)?.length).toBe(2);
  });

  it('bankcore answers the health path the deploy platform probes', () => {
    // Kanopy's web-app chart probes the container's own /health, so the route must exist at the root
    // and must not sit behind the API prefix or any auth.
    const server = read('bankcore/bin/server.ts');
    expect(server).toContain("fastify.get('/health'");
    expect(server).toContain('application/health+json');
    // It reports degraded rather than failing to answer, so a database outage is diagnosable.
    expect(server).toContain("status: 'fail'");
  });
});

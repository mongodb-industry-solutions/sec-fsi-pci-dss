// v37 P1.9/P6.7e-f: bankcore appears in the admin monitoring panel, and it is probed WITHOUT the
// browser ever leaving the frontend origin.
//
// The bank publishes its Open Banking docs so the API can be reviewed and exercised, but the PSP and
// the panel still reach it over the private network: the panel must work in an environment that does
// not publish the bank at all, and a direct browser fetch would fail as a CORS error locally and as
// unreachable in staging, the same bug with two symptoms. The Next.js rewrite is what keeps that true,
// and this suite is the mechanical guard the plan asks for.
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
    expect(bankcore.url).toBe('/health/bankcore');
    // A same-origin relative path is the whole point: no host, no scheme, no preflight.
    expect(bankcore.url.startsWith('/')).toBe(true);
  });

  it('the rewrite resolves the private in-cluster host, with no public fallback', () => {
    const config = read('frontend/next.config.js');
    expect(config).toContain("{ source: '/health/bankcore', destination: `${bankcoreUrl}/health` }");
    // Semantic, per-service aliases; the bare /health on this origin stays the backend's.
    expect(config).toContain("{ source: '/health/merchant', destination: `${merchantUrl}/health` }");
    // The proxy always uses the PRIVATE host, even though the bank now has a public one: the panel
    // must work in an environment that does not publish the bank at all.
    expect(config).toContain('NEXT_PUBLIC_PSP_URL_BANKCORE_PRIVATE');
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

describe('v37 P1.7b: bankcore is deployable, and its API is reviewable', () => {
  const drone = read('.drone.yml');

  it('has an image build and a deploy step in both pipelines', () => {
    expect(drone.match(/- name: publish-bankcore/g)?.length).toBe(2);
    expect(drone).toContain('- name: deploy-bankcore-staging');
    expect(drone).toContain('- name: deploy-bankcore-production');
    expect(drone).toContain('dockerfile: bankcore/Dockerfile');
  });

  it('is published in both environments, so its API can be reviewed', () => {
    // Bound each step at the next one, or the slice runs on into the following deploy step.
    const bankcoreSteps = drone
      .split('- name: deploy-bankcore-')
      .slice(1)
      .map((rest) => rest.split('\n  - name:')[0]);
    expect(bankcoreSteps).toHaveLength(2);
    for (const step of bankcoreSteps) {
      expect(step).toContain('ingress.enabled=true');
      expect(step).toMatch(/ingress\.hosts\[0\]=sec-fsi-pci-dss-bankcore\./);
      // Same flag the backend uses: reachable without corp SSO, since the API itself is protected.
      expect(step).toContain('ingress.authenticated=false');
    }
  });

  it('the diagnostics endpoints are not published along with the docs', () => {
    // Being reachable made the log buffer world readable, and the TPP protection does not cover it
    // because that lands in P3.7b. The platform admin token does.
    const controller = read('bankcore/src/modules/system/controllers/system.controller.ts');
    expect(controller).toContain('preHandler: requireAdmin');
    expect(read('bankcore/src/vendors/middleware/adminAuth.ts')).toContain("payload.role !== 'admin'");
    // /health stays open: the deploy platform probes it and it carries no data. Check the ROUTE, not
    // the file, since the guard is imported at the top.
    const healthRoute = controller.split("fastify.get('/health'")[1].split("fastify.get('/logs'")[0];
    expect(healthRoute).not.toContain('preHandler');
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

// v37 P6.7e and P6.7f: the panel calls the PSP, never the bank, and the proxy is a window not a hole.
//
// Two failure modes are being closed. A screen that fetches the bank directly works on a developer's machine
// and fails in staging as a CORS error or an unreachable host, which is a long way from the cause: so it is
// caught mechanically here rather than in review. And a proxy that forwarded any path would let the browser
// reach the bank's Open Banking surface while holding an admin token, which is a worse thing than no panel.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join } from 'path';
import {
  isReadableResource, readBankcoreAdmin,
} from '../../../../../psp/backend/src/modules/provider/services/bankcoreAdmin.service';

const ROOT = resolve(__dirname, '../../../../..');

function sourceFiles(dir: string, extensions = ['.ts', '.tsx']): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) out.push(full);
  }
  return out;
}

// Line comments first: one containing `/*` would open a fake block comment and swallow real code, which in a
// negative assertion passes by deleting what it should be checking.
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('v37 P6.7f: the browser never calls the bank', () => {
  it('no frontend source targets a bankcore URL or port', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(ROOT, 'psp/frontend/src'))) {
      const text = code(file);
      // A bank base URL, the bank's port, or its environment variable reaching the browser bundle.
      if (/BANKCORE_BASE_URL|BANKCORE_PUBLIC_URL|localhost:8083|127\.0\.0\.1:8083/.test(text)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders, 'these would fail as CORS locally and as unreachable in staging').toEqual([]);
  });

  it('no frontend source fetches a path outside the PSP API', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(resolve(ROOT, 'psp/frontend/src'))) {
      const text = code(file);
      // The bank's own surface: its Open Banking prefix and its admin prefix, as absolute fetch targets.
      for (const match of text.matchAll(/fetch\(\s*[`'"]([^`'"]+)/g)) {
        const target = match[1];
        if (/^https?:\/\//.test(target) && /8083|bankcore/.test(target)) {
          offenders.push(`${file.slice(ROOT.length + 1)}: ${target}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the bank exposes no permissive CORS of its own', () => {
    // The PSP has a wildcard origin in staging deliberately. The bank must not: it has a public hostname, and
    // a wildcard there would make the browser able to reach it after all.
    const server = code(resolve(ROOT, 'bank/backend/bin/server.ts'));
    expect(server).not.toMatch(/origin:\s*true/);
    expect(server).not.toMatch(/origin:\s*['"`]\*/);
  });
});

describe('v37 P6.7e: the proxy is narrow', () => {
  it('allows exactly the administrable resources', () => {
    for (const resource of ['module/config', 'tpp/registrations', 'tpp/subscriptions', 'tpp/deliveries', 'consents', 'audit']) {
      expect(isReadableResource(resource), resource).toBe(true);
    }
    // A trailing segment belongs to the resource it extends.
    expect(isReadableResource('module/config/card-issuer')).toBe(true);
    expect(isReadableResource('consents/abc-123')).toBe(true);
  });

  it('refuses anything else, including the bank\'s Open Banking surface', () => {
    for (const resource of ['', 'v1/accounts', 'v1/payments/sepa-credit-transfers', 'health', 'admin', 'module']) {
      expect(isReadableResource(resource), resource).toBe(false);
    }
  });

  it('refuses a traversal, which is how an allowlist gets walked around', () => {
    expect(isReadableResource('consents/../../v1/accounts')).toBe(false);
    // The ENCODED form is refused too. It would not traverse anything here (the bank would receive a literal
    // segment and answer 404), but a resource name containing `..` in any form has no legitimate use, and
    // refusing the shape is cheaper to reason about than arguing about which encodings are harmless.
    expect(isReadableResource('audit/..%2f..%2fv1')).toBe(false);
    expect(isReadableResource('module/config/..')).toBe(false);
  });

  it('reports an unreachable bank as such, never as an empty result', async () => {
    const unreachable = (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const result = await readBankcoreAdmin('tpp/registrations', {}, 'tester', unreachable);
    expect(result.status).toBe(502);
    expect(result.error).toContain('unreachable');
    // A panel showing "no registrations" when the bank is down is the most misleading thing it could show.
    expect(result.body).toBeNull();
  });

  it('mints its own short-lived hop token rather than forwarding the caller\'s', async () => {
    let seen = '';
    const capture = (async (_url: string, init: Record<string, unknown>) => {
      seen = ((init.headers ?? {}) as Record<string, string>).Authorization ?? '';
      return { status: 200, json: async () => ({ results: [] }) };
    }) as unknown as typeof fetch;

    await readBankcoreAdmin('audit', { limit: 5 }, 'ops-1', capture);
    expect(seen.startsWith('Bearer ')).toBe(true);
    const payload = JSON.parse(Buffer.from(seen.slice(7).split('.')[1], 'base64url').toString());
    expect(payload.role).toBe('admin');
    expect(payload.sub).toBe('ops-1');
    // Sixty seconds: it only has to survive one call, and a long-lived service token in memory is a
    // credential with no expiry.
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(60);
  });

  it('passes the query through, dropping empties rather than sending blank filters', async () => {
    let seenUrl = '';
    const capture = (async (url: string) => {
      seenUrl = url;
      return { status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await readBankcoreAdmin('audit', { outcome: 'refused', actor: '', limit: 10 }, 'ops', capture);
    expect(seenUrl).toContain('/api/v1/admin/audit?');
    expect(seenUrl).toContain('outcome=refused');
    expect(seenUrl).toContain('limit=10');
    // A blank filter would be sent as `actor=` and match nothing, which reads as "there is no data".
    expect(seenUrl).not.toContain('actor=');
  });
});

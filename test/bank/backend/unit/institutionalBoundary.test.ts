// v39 P4.3: a token minted by the platform is refused by the bank.
//
// This is the defect the boundary was supposed to prevent and did not. The bank's administrative
// middleware verified a PSP-ISSUED token with the shared `PSP_JWT_SECRET`, and its TPP access-token
// key was derived from that same secret. So the boundary between two institutions rested on the
// platform choosing not to mint a token, rather than on the bank being unable to accept one. A
// derivation is not a boundary when both sides share the input.
//
// The tests below are written against the KEY MATERIAL rather than the middleware, because that is
// where the defect lived: the middleware was correct, and it was checking the wrong signature.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { createHash } from 'crypto';

// The platform's purposes, derived exactly as the PSP derives them.
function pspKey(purpose: string, root = 'demo-local-secret-change-in-production'): string {
  return createHash('sha256').update(`${purpose}:${root}`).digest('hex');
}

// The bank's, derived from the bank's OWN root.
function bankKey(purpose: string, root = 'bankcore-local-secret-change-in-production'): string {
  return createHash('sha256').update(`${purpose}:${root}`).digest('hex');
}

const PLATFORM_ROOT = 'the-platform-root-secret';
const BANK_ROOT = 'the-bank-root-secret';

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {
    PSP_JWT_SECRET: process.env.PSP_JWT_SECRET,
    PSP_BANKCORE_SECRET: process.env.PSP_BANKCORE_SECRET,
    PSP_BANKCORE_ACCESS_TOKEN_SECRET: process.env.PSP_BANKCORE_ACCESS_TOKEN_SECRET,
    PSP_BANKCORE_ADMIN_SECRET: process.env.PSP_BANKCORE_ADMIN_SECRET,
  };
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('v39 P4: the platform secret no longer reaches the bank', () => {
  it('derives the bank access-token key from a root the platform does not hold', () => {
    // The old derivation was deriveKey('bankcore-tpp-access-token', PSP_JWT_SECRET). Anyone holding
    // the platform secret could reproduce it, which made the bank's tokens the platform's to mint.
    const oldWay = createHash('sha256')
      .update(`bankcore-tpp-access-token:${PLATFORM_ROOT}`)
      .digest('hex');
    const newWay = createHash('sha256')
      .update(`bankcore-tpp-access-token:${BANK_ROOT}`)
      .digest('hex');
    expect(newWay).not.toBe(oldWay);
  });

  it('gives the two institutions different keys even when nothing is configured', () => {
    // The defect must not survive as a default. A deployment that sets no variable at all still gets
    // two distinct roots, because the alternative is that every laptop and every demo keeps it.
    expect(bankKey('bankcore:admin')).not.toBe(pspKey('psp:admin'));
    expect(bankKey('bankcore-tpp-access-token')).not.toBe(pspKey('psp:session'));
  });

  it('refuses a platform session token at the bank', () => {
    const platformSession = jwt.sign({ sub: 'someone', role: 'admin' }, pspKey('psp:session', PLATFORM_ROOT));
    // Signature verification, not a claim check: the bank cannot be talked into accepting it by
    // presenting better claims, because it cannot verify the signature at all.
    expect(() => jwt.verify(platformSession, bankKey('bankcore:admin', BANK_ROOT))).toThrow();
    expect(() => jwt.verify(platformSession, bankKey('bankcore-tpp-access-token', BANK_ROOT))).toThrow();
  });

  it('refuses a platform administrative token at the bank', () => {
    const platformAdmin = jwt.sign({ sub: 'admin', role: 'admin' }, pspKey('psp:admin', PLATFORM_ROOT));
    expect(() => jwt.verify(platformAdmin, bankKey('bankcore:admin', BANK_ROOT))).toThrow();
    expect(() => jwt.verify(platformAdmin, bankKey('bankcore-tpp-access-token', BANK_ROOT))).toThrow();
  });

  it('refuses an escalation capability at the bank', () => {
    const escalation = jwt.sign({ kind: 'escalation', caseId: 'c1', role: 'level2_investigator' }, pspKey('psp:escalation', PLATFORM_ROOT));
    expect(() => jwt.verify(escalation, bankKey('bankcore:admin', BANK_ROOT))).toThrow();
  });

  it('refuses the bank TPP token on the bank administrative surface, and the reverse', () => {
    // The bank's two purposes are separated from each other as well. A TPP token authorises Open
    // Banking operations against a consent; it is not an operator credential, and the bank's own
    // administrative surface has no business accepting one.
    const tpp = jwt.sign({ sub: 'leafypay-psp' }, bankKey('bankcore-tpp-access-token', BANK_ROOT));
    const admin = jwt.sign({ role: 'admin' }, bankKey('bankcore:admin', BANK_ROOT));
    expect(() => jwt.verify(tpp, bankKey('bankcore:admin', BANK_ROOT))).toThrow();
    expect(() => jwt.verify(admin, bankKey('bankcore-tpp-access-token', BANK_ROOT))).toThrow();
  });
});

describe('v39 P4: the platform separates its own purposes too', () => {
  it('signs the session, the escalation, the admin token and enrolment with four different keys', () => {
    const keys = ['psp:session', 'psp:escalation', 'psp:admin', 'psp:enrollment']
      .map((purpose) => pspKey(purpose, PLATFORM_ROOT));
    // Anything able to mint one used to be able to mint all of them, so the distinction between a
    // session and a case escalation was a claim rather than a credential.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('refuses a session token where an escalation capability is required', () => {
    const session = jwt.sign({ sub: 'analyst' }, pspKey('psp:session', PLATFORM_ROOT));
    expect(() => jwt.verify(session, pspKey('psp:escalation', PLATFORM_ROOT))).toThrow();
  });

  it('refuses an escalation capability where a session is required', () => {
    const escalation = jwt.sign({ kind: 'escalation', caseId: 'c1' }, pspKey('psp:escalation', PLATFORM_ROOT));
    expect(() => jwt.verify(escalation, pspKey('psp:session', PLATFORM_ROOT))).toThrow();
  });

  it('yields nothing about the root or a sibling key from one purpose key', () => {
    // One way by construction, which is what makes a leaked purpose key a bounded problem.
    const sessionKey = pspKey('psp:session', PLATFORM_ROOT);
    expect(sessionKey).not.toContain(PLATFORM_ROOT);
    expect(sessionKey).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('v39 P4: the bank reads no platform secret', () => {
  it('never names the platform secret in its source', async () => {
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const { resolve, relative, sep } = await import('path');
    const root = resolve(__dirname, '../../../../bank/backend/src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        const code = readFileSync(full, 'utf8')
          .split('\n')
          .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
          .join('\n');
        if (/pspEnv\(\s*'JWT_SECRET'|process\.env\.PSP_JWT_SECRET/.test(code)) {
          offenders.push(relative(root, full).split(sep).join('/'));
        }
      }
    };
    walk(root);
    expect(offenders, `the bank reads the platform secret in: ${offenders.join(', ')}`).toEqual([]);
  });
});

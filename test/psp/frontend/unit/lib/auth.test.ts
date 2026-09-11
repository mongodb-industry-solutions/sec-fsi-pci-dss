/**
 * Unit tests: frontend/src/lib/auth.ts
 * Cookie-based JWT helpers for Application Mode.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Polyfill document.cookie for jsdom
let fakeCookieStore = '';
Object.defineProperty(global, 'document', {
  writable: true,
  value: {
    get cookie() { return fakeCookieStore; },
    set cookie(val: string) {
      // Parse Max-Age=0 to clear
      if (/Max-Age=0/.test(val)) {
        const name = val.split('=')[0].trim();
        fakeCookieStore = fakeCookieStore
          .split('; ')
          .filter((c) => !c.startsWith(`${name}=`))
          .join('; ');
      } else {
        const [pair] = val.split(';');
        const [name, value] = pair.split('=');
        if (name && value) {
          fakeCookieStore = fakeCookieStore
            .split('; ')
            .filter((c) => !c.startsWith(`${name.trim()}=`))
            .concat(`${name.trim()}=${value.trim()}`)
            .filter(Boolean)
            .join('; ');
        }
      }
    },
  },
});

// Re-import after polyfill
const { getToken, setToken, clearToken, decodeToken, isTokenExpired } = await import('../../../../../psp/frontend/src/lib/auth');

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

beforeEach(() => {
  fakeCookieStore = '';
});

describe('setToken / getToken / clearToken', () => {
  it('getToken returns undefined when no cookie is set', () => {
    expect(getToken()).toBeUndefined();
  });

  it('setToken stores the token so getToken returns it', () => {
    const token = buildJwt({ sub: 'u1', exp: 9999999999 });
    setToken(token);
    expect(getToken()).toBe(token);
  });

  it('clearToken removes the stored token', () => {
    setToken(buildJwt({ sub: 'u1', exp: 9999999999 }));
    clearToken();
    expect(getToken()).toBeUndefined();
  });
});

describe('decodeToken', () => {
  it('returns payload for a valid JWT', () => {
    // The claim is `roles`, an array, because a person may hold several. The screens are built
    // around one, so `decodeToken` collapses it to the first; the fixture must carry the claim the
    // authority actually issues, not the singular field the screens happen to read.
    const payload = { sub: 'usr-001', email: 'sarah.chen@back.es', roles: ['level1_analyst'], name: 'Sarah Chen', domain: 'local', iat: 0, exp: 9999999999 };
    const token = buildJwt(payload);
    const decoded = decodeToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.email).toBe('sarah.chen@back.es');
    expect(decoded!.role).toBe('level1_analyst');
  });

  it('collapses several held roles to the first, and survives the claim being absent', () => {
    /**
     * Both halves of the mapping, which the single fixture above could not show.
     *
     * The empty string matters: nearly forty screens read `user.role`, and `undefined` there would
     * turn a missing claim into a crash on every one of them rather than a person who is simply
     * shown nothing they are not entitled to.
     */
    const several = decodeToken(buildJwt({ sub: 'u1', roles: ['level2_analyst', 'auditor'], exp: 9999999999 }));
    expect(several!.role).toBe('level2_analyst');

    const none = decodeToken(buildJwt({ sub: 'u1', exp: 9999999999 }));
    expect(none!.role).toBe('');
  });

  it('returns null for malformed token (< 3 parts)', () => {
    expect(decodeToken('not.a.valid.jwt')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeToken('')).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('returns false for a future-expiry token', () => {
    const token = buildJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for an expired token', () => {
    const token = buildJwt({ exp: Math.floor(Date.now() / 1000) - 1 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true for a malformed token', () => {
    expect(isTokenExpired('invalid')).toBe(true);
  });
});

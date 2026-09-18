/**
 * The silent authentication flow, guarded at the source.
 *
 * These routes run inside the Next.js request lifecycle, so they cannot be exercised in a unit test.
 * What matters about them is structural and does not need a runtime: the flow must be a redirect and
 * never a browser call to the authority (its token endpoint publishes no cross-origin access, and a
 * credential must not be presented from a browser), the return path must be validated, and a refused
 * silent attempt must not surface as an error on a working payment page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');
// A line feed without writing the escape, which this repo's tooling has mangled before.
const NEWLINE = String.fromCharCode(10);

const SILENT_ROUTE = 'psp/frontend/src/app/api/auth/silent/route.ts';
const CALLBACK_ROUTE = 'psp/frontend/src/app/api/auth/callback/route.ts';
const AUTHORITY = 'psp/frontend/src/lib/authority.ts';
const CARDS = 'psp/frontend/src/components/gateway/SavedCardSelector.tsx';

describe('the route that starts the silent flow', () => {
  const src = read(SILENT_ROUTE);

  it('asks the authority not to prompt', () => {
    expect(src).toContain("prompt: 'none'");
  });

  it('validates the return path with the shared rule rather than its own', () => {
    expect(src).toContain('safeReturnTo');
  });

  it('refuses a call with no usable return path instead of stranding the browser', () => {
    expect(src).toMatch(/if \(!returnTo\) return NextResponse\.json\(/);
  });

  it('reuses the one sign-in flow, so PKCE cannot drift between the two entry points', () => {
    expect(src).toContain('startSignIn(');
    expect(src).not.toContain('code_challenge');
  });
});

describe('the callback', () => {
  const src = read(CALLBACK_ROUTE);

  it('treats a refused silent attempt as an ordinary outcome', () => {
    expect(src).toContain("error === 'login_required'");
    // The refusal returns to the page, and the page must not be told anything went wrong.
    const branch = src.split(NEWLINE).find((l) => l.includes("error === 'login_required'"));
    expect(branch).toContain('return NextResponse.redirect(home)');
    expect(branch).not.toContain('signin_error');
  });

  it('consumes the stored return path rather than reading one off the query', () => {
    expect(src).toContain('consumeReturnTo');
    expect(src).not.toContain("params.get('return_to')");
  });
});

describe('the authority module', () => {
  const src = read(AUTHORITY);

  it('revalidates the return path when reading it back', () => {
    const consume = src.slice(src.indexOf('export async function consumeReturnTo'));
    expect(consume).toContain('safeReturnTo(stored)');
  });

  it('clears the return path as it reads it, so it cannot be replayed', () => {
    const consume = src.slice(src.indexOf('export async function consumeReturnTo'));
    expect(consume).toContain('store.delete(name)');
  });
});

describe('the hosted payment pages', () => {
  const src = read(CARDS);

  it('go through the provider route, never to the authority from the browser', () => {
    expect(src).toContain('silentSignInUrl');
    expect(src).not.toContain('openid-connect/token');
  });

  it('replace the history entry, so the back button cannot re-enter the flow', () => {
    expect(src).toContain('window.location.replace(');
    expect(src).not.toContain('window.location.assign(');
  });

  it('spend the one attempt before leaving, not after coming back', () => {
    const fn = src.slice(src.indexOf('function attemptSilentSignIn'));
    const body = fn.slice(0, 500);

    expect(body.indexOf('sessionStorage.setItem')).toBeLessThan(body.indexOf('window.location.replace'));
  });

  it('still refuse to resolve cards from the payment session', () => {
    expect(src).not.toContain('actingParty');
    expect(src).not.toContain('sessionId');
  });
});

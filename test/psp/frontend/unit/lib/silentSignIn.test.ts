/**
 * Unit tests: psp/frontend/src/lib/silentSignIn.ts
 *
 * The hosted payment pages live on the provider origin, while a payer who arrived from a merchant
 * was authenticated at the authority and holds no session cookie here. These are the guards around
 * asking the authority who that payer is without prompting them.
 */
import { describe, it, expect } from 'vitest';
import {
  SILENT_SIGN_IN_PATH,
  safeReturnTo,
  shouldAttemptSilentSignIn,
  silentSignInUrl,
} from '../../../../../psp/frontend/src/lib/silentSignIn';

describe('safeReturnTo', () => {
  it('accepts a same-origin path, with its query', () => {
    expect(safeReturnTo('/gateway/checkout/abc')).toBe('/gateway/checkout/abc');
    expect(safeReturnTo('/gateway/pay/XYZ?card=tok_1')).toBe('/gateway/pay/XYZ?card=tok_1');
  });

  it('refuses an absolute URL, so the callback cannot be turned into an open redirect', () => {
    expect(safeReturnTo('http://evil.example/steal')).toBeNull();
    expect(safeReturnTo('https://evil.example/steal')).toBeNull();
  });

  it('refuses a protocol-relative URL, which a browser resolves as another origin', () => {
    expect(safeReturnTo('//evil.example/steal')).toBeNull();
    expect(safeReturnTo('/\evil.example/steal')).toBeNull();
    expect(safeReturnTo('/%2Fevil.example')).toBeNull();
  });

  it('refuses anything that is not a rooted path', () => {
    expect(safeReturnTo('gateway/checkout/abc')).toBeNull();
    expect(safeReturnTo('')).toBeNull();
    expect(safeReturnTo(undefined)).toBeNull();
    expect(safeReturnTo('javascript:alert(1)')).toBeNull();
  });

  it('refuses a path outside the hosted payment pages', () => {
    // The silent flow exists for the payment pages only. Anywhere else a person signs in normally,
    // so accepting other paths would only widen what this parameter can reach.
    expect(safeReturnTo('/system/investigation/case-1')).toBeNull();
    expect(safeReturnTo('/api/auth/silent')).toBeNull();
  });
});

describe('shouldAttemptSilentSignIn', () => {
  const base = { hasToken: false, framed: false, alreadyAttempted: false };

  it('attempts when nobody is signed in on this origin', () => {
    expect(shouldAttemptSilentSignIn(base)).toBe(true);
  });

  it('does not attempt when a session already exists here', () => {
    expect(shouldAttemptSilentSignIn({ ...base, hasToken: true })).toBe(false);
  });

  it('does not attempt twice, so a payer with no session is never trapped in a redirect loop', () => {
    expect(shouldAttemptSilentSignIn({ ...base, alreadyAttempted: true })).toBe(false);
  });

  it('does not attempt inside a frame', () => {
    // The authority's session cookie is third-party in a frame and modern browsers withhold it, so
    // the attempt could only fail, and its redirect would land inside the frame.
    expect(shouldAttemptSilentSignIn({ ...base, framed: true })).toBe(false);
  });
});

describe('silentSignInUrl', () => {
  it('carries the return path to the provider route, encoded', () => {
    const url = silentSignInUrl('/gateway/checkout/abc?card=tok_1');
    expect(url.startsWith(`${SILENT_SIGN_IN_PATH}?`)).toBe(true);
    const returnTo = new URLSearchParams(url.split('?')[1]).get('return_to');
    expect(returnTo).toBe('/gateway/checkout/abc?card=tok_1');
  });

  it('is a rooted path on this origin, never an absolute URL', () => {
    expect(silentSignInUrl('/gateway/pay/X')).toMatch(/^\/api\//);
  });
});

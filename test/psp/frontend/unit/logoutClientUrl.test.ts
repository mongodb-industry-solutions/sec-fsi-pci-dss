/**
 * Which client is named when this page leaves for the authority, and which address it is allowed to
 * land on. Security-sensitive: the authority checks a post-logout address against the registration of
 * the client it was told is asking, so naming the wrong one here either strands the browser (a real
 * registration, wrong owner) or, if the two registrations happened to overlap, would hand back an
 * address this page never verified.
 *
 * `buildAuthorityLogoutUrl` and `safeRedirect` take every input as a parameter rather than reading
 * `window.location` or `next/navigation`, so these are asserted directly instead of by rendering the
 * component.
 */
import { describe, it, expect } from 'vitest';
import {
  CONSOLE_CLIENT_ID, safeRedirect, buildAuthorityLogoutUrl,
} from '../../../../psp/frontend/src/app/auth/logout/LogoutClient';

const AUTHORITY = 'https://sec-giam-ui.industrysolutions.staging.corp.mongodb.com';
const APP_ORIGIN = 'https://sec-fsi-pci-dss-frontend.industrysolutions.staging.corp.mongodb.com';
const MERCHANT = 'https://sec-fsi-pci-dss-merchant.industrysolutions.staging.corp.mongodb.com';

describe('buildAuthorityLogoutUrl: an ordinary sign-out from this console', () => {
  it('names this console and sends no hint when nobody is signed in', () => {
    const url = new URL(buildAuthorityLogoutUrl(AUTHORITY, {
      appOrigin: APP_ORIGIN, requestedRedirect: null, merchantUrl: MERCHANT, onBehalfOf: null,
    }));
    expect(url.origin + url.pathname).toBe(`${AUTHORITY}/auth/logout`);
    expect(url.searchParams.get('client_id')).toBe(CONSOLE_CLIENT_ID);
    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(APP_ORIGIN);
  });

  it('attaches this console’s own ID token as the hint', () => {
    const url = new URL(buildAuthorityLogoutUrl(AUTHORITY, {
      appOrigin: APP_ORIGIN, requestedRedirect: null, merchantUrl: MERCHANT, onBehalfOf: null,
      idTokenHint: 'signed.jwt.here',
    }));
    expect(url.searchParams.get('client_id')).toBe(CONSOLE_CLIENT_ID);
    expect(url.searchParams.get('id_token_hint')).toBe('signed.jwt.here');
  });
});

describe('buildAuthorityLogoutUrl: a relying party relaying its own sign-out', () => {
  it('names the relying party, not this console, and never forwards this console’s hint', () => {
    const url = new URL(buildAuthorityLogoutUrl(AUTHORITY, {
      appOrigin: APP_ORIGIN, requestedRedirect: MERCHANT, merchantUrl: MERCHANT,
      onBehalfOf: 'oauth001-0000-4000-8000-000000000001',
      // Present because somebody also happens to be signed in to this console. Must not leak onto a
      // request made on another client's behalf: the token names this console, not the merchant.
      idTokenHint: 'this-consoles-own-token',
    }));
    expect(url.searchParams.get('client_id')).toBe('oauth001-0000-4000-8000-000000000001');
    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(MERCHANT);
  });
});

describe('safeRedirect: where the browser is allowed to land', () => {
  it('falls back to this origin when nothing was requested', () => {
    expect(safeRedirect(null, APP_ORIGIN, MERCHANT)).toBe(APP_ORIGIN);
  });

  it('falls back to this origin for a relative path, never forwarding one to the authority', () => {
    expect(safeRedirect('/system', APP_ORIGIN, MERCHANT)).toBe(APP_ORIGIN);
  });

  it('honours this origin itself', () => {
    expect(safeRedirect(APP_ORIGIN, APP_ORIGIN, MERCHANT)).toBe(APP_ORIGIN);
  });

  it('honours the merchant’s own origin, the only other one on the list', () => {
    expect(safeRedirect(`${MERCHANT}/some/deep/path`, APP_ORIGIN, MERCHANT)).toBe(MERCHANT);
  });

  it('refuses an origin that is neither this app nor the configured merchant', () => {
    expect(safeRedirect('https://attacker.example', APP_ORIGIN, MERCHANT)).toBe(APP_ORIGIN);
  });

  it('refuses a scheme that is neither http nor https', () => {
    expect(safeRedirect('javascript:alert(1)', APP_ORIGIN, MERCHANT)).toBe(APP_ORIGIN);
  });

  it('falls back to this origin when the merchant address itself is misconfigured', () => {
    expect(safeRedirect(`${MERCHANT}/x`, APP_ORIGIN, 'not a url')).toBe(APP_ORIGIN);
  });
});

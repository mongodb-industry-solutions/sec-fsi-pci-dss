// Stateless, encrypted httpOnly session cookie (AES-256-GCM). No DB, no server store.
// The browser never sees the Bearer/refresh token — only the encrypted blob.
import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { ENV } from './env';

const COOKIE_NAME = 'ew_session';
const ALG = 'aes-256-gcm';

export interface Session {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** Scopes actually granted by the user (may be a subset — granular consent, E-12). */
  grantedScopes: string[];
  sub: string;
  name?: string;
  email?: string;
}

// Short-lived cookie holding the transient OAuth login state (PKCE + CSRF).
interface LoginState {
  state: string;
  nonce: string;
  codeVerifier: string;
}

function key(): Buffer {
  // Derive a fixed 32-byte key from the configured secret.
  return createHash('sha256').update(ENV.sessionSecret()).digest();
}

function encrypt(payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${data.toString('base64url')}`;
}

function decrypt<T>(blob: string): T | null {
  try {
    const [ivB, tagB, dataB] = blob.split('.');
    if (!ivB || !tagB || !dataB) return null;
    const decipher = createDecipheriv(ALG, key(), Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]);
    return JSON.parse(out.toString('utf8')) as T;
  } catch {
    return null; // tampered or wrong key → treat as no session
  }
}

const secureCookie = () => ENV.baseUrl().startsWith('https');

// Shared cookie options. Kept identical between the next/headers path and the
// response-object path so behaviour does not drift.
const sessionCookieOpts = () =>
  ({ httpOnly: true, secure: secureCookie(), sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 8 });
const loginCookieOpts = () =>
  ({ httpOnly: true, secure: secureCookie(), sameSite: 'lax' as const, path: '/', maxAge: 600 });

// ── Auth session ──────────────────────────────────────────────────────────────
export async function getSession(): Promise<Session | null> {
  const c = (await cookies()).get(COOKIE_NAME);
  return c ? decrypt<Session>(c.value) : null;
}

export async function setSession(session: Session): Promise<void> {
  (await cookies()).set(COOKIE_NAME, encrypt(session), sessionCookieOpts());
}

// Attach the session cookie directly to a NextResponse. Use this in route
// handlers that return a redirect — mutating next/headers cookies() is not
// reliably merged into a returned NextResponse across Next versions.
export function attachSession(res: NextResponse, session: Session): void {
  res.cookies.set(COOKIE_NAME, encrypt(session), sessionCookieOpts());
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

// ── Transient login state (PKCE + CSRF) ─────────────────────────────────────────
const LOGIN_COOKIE = 'ew_login';

export async function setLoginState(s: LoginState): Promise<void> {
  (await cookies()).set(LOGIN_COOKIE, encrypt(s), loginCookieOpts());
}

// Attach the transient login-state cookie directly to a NextResponse (reliable
// on returned redirects — see attachSession).
export function attachLoginState(res: NextResponse, s: LoginState): void {
  res.cookies.set(LOGIN_COOKIE, encrypt(s), loginCookieOpts());
}

export async function consumeLoginState(): Promise<LoginState | null> {
  const jar = await cookies();
  const c = jar.get(LOGIN_COOKIE);
  if (!c) return null;
  jar.delete(LOGIN_COOKIE);
  return decrypt<LoginState>(c.value);
}

// Read the login-state from the incoming request (no mutation). Pair with
// clearLoginStateOn(res) to expire the cookie on the response you return.
export function readLoginState(req: NextRequest): LoginState | null {
  const c = req.cookies.get(LOGIN_COOKIE);
  return c ? decrypt<LoginState>(c.value) : null;
}

export function clearLoginStateOn(res: NextResponse): void {
  res.cookies.set(LOGIN_COOKIE, '', { ...loginCookieOpts(), maxAge: 0 });
}

export function hasScope(session: Session | null, scope: string): boolean {
  return !!session?.grantedScopes.includes(scope);
}

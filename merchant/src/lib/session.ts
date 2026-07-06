// Stateless, encrypted httpOnly session cookie (AES-256-GCM). No DB, no server store.
// The browser never sees the Bearer/refresh token — only the encrypted blob.
import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
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

// ── Auth session ──────────────────────────────────────────────────────────────
export async function getSession(): Promise<Session | null> {
  const c = (await cookies()).get(COOKIE_NAME);
  return c ? decrypt<Session>(c.value) : null;
}

export async function setSession(session: Session): Promise<void> {
  (await cookies()).set(COOKIE_NAME, encrypt(session), {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8h — refresh token rotates the access token within this window
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

// ── Transient login state (PKCE + CSRF) ─────────────────────────────────────────
const LOGIN_COOKIE = 'ew_login';

export async function setLoginState(s: LoginState): Promise<void> {
  (await cookies()).set(LOGIN_COOKIE, encrypt(s), {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min to complete the flow
  });
}

export async function consumeLoginState(): Promise<LoginState | null> {
  const jar = await cookies();
  const c = jar.get(LOGIN_COOKIE);
  if (!c) return null;
  jar.delete(LOGIN_COOKIE);
  return decrypt<LoginState>(c.value);
}

export function hasScope(session: Session | null, scope: string): boolean {
  return !!session?.grantedScopes.includes(scope);
}

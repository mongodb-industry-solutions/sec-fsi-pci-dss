'use client';

const COOKIE_NAME = 'demo_token';

export function getToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function setToken(token: string) {
  const maxAge = 60 * 60 * 24; // 24h
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAge}; path=/; SameSite=Strict`;
}

export function clearToken() {
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; path=/`;
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: string;
  name: string;
  domain: string;
  iat: number;
  exp: number;
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  return Date.now() / 1000 > payload.exp;
}

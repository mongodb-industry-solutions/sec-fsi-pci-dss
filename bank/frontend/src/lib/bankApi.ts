import 'server-only';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';

// The only place this app talks to the bank, and it is SERVER side.
//
// The browser never holds a token and never names the bank's host: it calls this app's own route handlers,
// which call the bank over the network the deployment gives them. That keeps one origin, no preflight, and no
// credential in a bundle, and it is why the bank needs no permissive CORS even though it has a public
// hostname.
//
// Before this app existed, the same screens lived in the provider's frontend and reached the bank through a
// proxy there. That was correct while the bank had no frontend of its own, and it is the wrong shape now: the
// provider was carrying the bank's administration for it.

const TIMEOUT_MS = 8000;

function baseUrl(): string {
  const raw = process.env.PSP_BANKCORE_BASE_URL
    ?? process.env.BANKCORE_BASE_URL
    ?? 'http://localhost:8083';
  return raw.replace(/\/$/, '');
}

// v39 P4: the BANK's own diagnostics credential, not the platform secret.
//
// This app administers a separate institution, so it presents a credential issued by that
// institution. Reading the platform secret here meant the bank trusted anything the platform could
// sign, which made the boundary between them a matter of documentation rather than of key material.
function adminCredential(): string {
  const configured = process.env.PSP_BANKCORE_ADMIN_SECRET ?? process.env.BANKCORE_ADMIN_SECRET;
  if (configured) return configured;
  const root = process.env.PSP_BANKCORE_SECRET ?? 'bankcore-local-secret-change-in-production';
  return createHash('sha256').update('bankcore:admin:' + root).digest('hex');
}

/**
 * A short-lived admin token for one hop.
 *
 * The bank verifies its OWN admin credential on its administrative API. Minted per request and valid for a
 * minute: a long-lived service token held in memory is a credential with no expiry, and this one only has to
 * survive a single call.
 */
function hopToken(actor = 'bank-admin-app'): string {
  return jwt.sign({ role: 'admin', sub: actor, act: 'bank-admin-app' }, adminCredential(), { expiresIn: 60 });
}

// Only the bank's ADMINISTRATIVE resources are reachable through this app. A generic forwarder would let the
// browser reach the Open Banking surface itself while holding an admin token, which is a different audience
// with a different authorisation model.
const ADMIN_RESOURCES = [
  'module/config',
  'tpp/registrations',
  'tpp/subscriptions',
  'tpp/deliveries',
  'consents',
  'audit',
  // The bank's own data: the cards it issued, the accounts it holds and the parties behind both, with their
  // lifecycle actions and their disclosures.
  'cards',
  'accounts',
  'holders',
];

export function isAdminResource(resource: string): boolean {
  // A traversal in any form has no legitimate use in a resource name, so the shape is refused rather than
  // argued about encoding by encoding.
  if (resource.includes('..')) return false;
  return ADMIN_RESOURCES.some((allowed) => resource === allowed || resource.startsWith(`${allowed}/`));
}

export interface BankResult {
  status: number;
  body: unknown;
  error?: string;
}

export async function callBankAdmin(
  resource: string,
  init: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<BankResult> {
  if (!isAdminResource(resource)) {
    return { status: 400, body: null, error: `not an administrable resource: ${resource}` };
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const url = `${baseUrl()}/api/v1/admin/${resource}${search.size ? `?${search.toString()}` : ''}`;

  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${hopToken()}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (err) {
    // Unreachable is reported as such, never as an empty result: a screen showing "no registrations" while
    // the bank is down is the most misleading thing it could show.
    return {
      status: 502,
      body: null,
      error: `the bank is unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface BankHealth {
  status: 'ok' | 'degraded' | 'unreachable';
  detail?: string;
}

/** The bank's own health, from the endpoint the deployment platform probes. */
export async function bankHealth(): Promise<BankHealth> {
  try {
    const response = await fetch(`${baseUrl()}/health`, {
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    const body = await response.json().catch(() => null) as { status?: string; checks?: unknown } | null;
    if (response.status >= 500 || body?.status === 'fail') {
      // Degraded, not unreachable: the bank answered, so this is a database or dependency problem and saying
      // "unreachable" would send whoever is debugging at the network instead.
      return { status: 'degraded', detail: 'the bank answered but reports a failing check' };
    }
    return { status: 'ok' };
  } catch (err) {
    return { status: 'unreachable', detail: err instanceof Error ? err.message : String(err) };
  }
}

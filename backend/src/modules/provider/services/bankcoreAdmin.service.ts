import jwt from 'jsonwebtoken';
import { config } from '../../../config';

// The PSP's window onto the bank's administrative API.
//
// v37 P6.7e: every panel screen goes through the PSP, never at the bank directly. The browser keeps one
// origin, one token and no preflight, and the bank registers no permissive CORS: a public bank hostname that
// accepted browser calls from anywhere would be a worse thing than an inconvenient panel.
//
// It is a NARROW proxy, not a pass-through. Only the paths listed here are reachable, because a generic
// forwarder would let the browser reach anything the bank exposes, including its Open Banking surface with an
// admin token, and the allowlist is the difference between a window and a hole.
const TIMEOUT_MS = 6000;

export type BankcoreAdminResource =
  | 'module/config'
  | 'tpp/registrations'
  | 'tpp/subscriptions'
  | 'tpp/deliveries'
  | 'consents'
  | 'audit';

const READABLE: BankcoreAdminResource[] = [
  'module/config', 'tpp/registrations', 'tpp/subscriptions', 'tpp/deliveries', 'consents', 'audit',
];

export function isReadableResource(resource: string): resource is BankcoreAdminResource {
  // A trailing segment is allowed (`module/config/card-issuer`), a traversal is not.
  if (resource.includes('..')) return false;
  return READABLE.some((allowed) => resource === allowed || resource.startsWith(`${allowed}/`));
}

export interface BankcoreAdminResult {
  status: number;
  body: unknown;
  error?: string;
}

// The bank verifies the PLATFORM admin token, so the PSP mints one for the hop rather than forwarding the
// caller's. Short-lived and minted per request: a long-lived service token sitting in memory is a credential
// with no expiry, and this one only ever has to survive one call.
function hopToken(actor: string): string {
  return jwt.sign({ role: 'admin', sub: actor, act: 'psp-admin-panel' }, config.app.jwtSecret, { expiresIn: 60 });
}

export async function readBankcoreAdmin(
  resource: string,
  query: Record<string, unknown>,
  actor: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BankcoreAdminResult> {
  if (!isReadableResource(resource)) {
    return { status: 400, body: null, error: `not an administrable resource: ${resource}` };
  }
  const base = config.bankcore.baseUrl;
  if (!base) return { status: 503, body: null, error: 'no bankcore base URL configured' };

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const url = `${base}/api/v1/admin/${resource}${search.size ? `?${search.toString()}` : ''}`;

  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${hopToken(actor)}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (err) {
    // Reported as unreachable rather than as an empty result: a panel showing "no registrations" when the
    // bank is down is the most misleading thing it could show.
    return { status: 502, body: null, error: `bankcore unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

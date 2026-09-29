'use client';

// The browser's single way of reaching the bank: this app's own route handlers.
//
// Every screen goes through here, which is what keeps the token server side and the bank's host out of the
// bundle. It is also the reason there is one error shape: a list, a form and a reveal all fail the same way,
// so no screen has to invent its own way of saying the bank refused.

export class AdminError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function queryString(query: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.size ? `?${search}` : '';
}

/** Announced when the bank refuses the session outright, so the gate can say so once, in one place. */
export const SESSION_ENDED_EVENT = 'bankcore:session-ended';

/**
 * What a renewal attempt established. Only the authority refusing the credential is proof that the
 * session is finished; nothing to renew with, or no way to ask, proves nothing.
 */
export type RenewOutcome = 'renewed' | 'session_over' | 'unavailable';

let renewing: Promise<RenewOutcome> | null = null;

/** One renewal at a time: the authority retires the presented refresh token as it redeems it. */
export function renew(): Promise<RenewOutcome> {
  if (!renewing) {
    renewing = fetch('/api/auth/refresh', { method: 'POST' })
      .then(async (r): Promise<RenewOutcome> => {
        if (r.ok) return 'renewed';
        const { reason } = await r.json().catch(() => ({})) as { reason?: string };
        return reason === 'refresh_refused' || reason === 'no_token' ? 'session_over' : 'unavailable';
      })
      .catch((): RenewOutcome => 'unavailable')
      .finally(() => { renewing = null; });
  }
  return renewing;
}

async function call<T>(
  resource: string,
  init: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  const send = () => fetch(`/api/admin/${resource}${queryString(init.query ?? {})}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  let response = await send();

  // The session, not the request. Renew once and ask again, because the common reason is an access
  // token that aged out between the page loading and the action being taken, and the credential
  // behind it is usually still good. Only when the renewal is refused is the session actually over,
  // and then the gate is told rather than each screen inventing its own way of saying so.
  if (response.status === 401) {
    const outcome = await renew();
    if (outcome === 'renewed') response = await send();
    else if (outcome === 'session_over') window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
  }

  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    // The bank's own refusal text is what an operator needs. A generic "request failed" would hide the one
    // useful sentence, the one naming the balance still on the account or the transition that is illegal.
    throw new AdminError(response.status, payload?.error ?? `the bank answered ${response.status}`);
  }
  return payload as T;
}

export interface PagedResult<T> {
  results: T[];
  total: number;
  page: number;
  limit: number;
  byStatus?: Record<string, number>;
}

export const admin = {
  list: <T>(resource: string, query: Record<string, string | number | undefined>) =>
    call<PagedResult<T>>(resource, { query }),
  read: <T>(resource: string) => call<T>(resource),
  /** A disclosure: the encrypted value behind a mask. A POST because it is an act, and it is audited as one. */
  disclose: <T>(resource: string) => call<T>(resource, { method: 'POST', body: {} }),
  create: <T>(resource: string, body: unknown) => call<T>(resource, { method: 'POST', body }),
  put: <T>(resource: string, body: unknown) => call<T>(resource, { method: 'PUT', body }),
  patch: <T>(resource: string, body: unknown) => call<T>(resource, { method: 'PATCH', body }),
  remove: <T>(resource: string) => call<T>(resource, { method: 'DELETE' }),
};

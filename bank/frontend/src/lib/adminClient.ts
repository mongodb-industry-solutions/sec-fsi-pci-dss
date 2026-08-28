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

async function call<T>(
  resource: string,
  init: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`/api/admin/${resource}${queryString(init.query ?? {})}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
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

import { FastifyRequest } from 'fastify';
import { config } from '../../config';

/**
 * Calling the identity authority on behalf of the caller.
 *
 * The caller's own token is forwarded, never a service credential of this application's. That is the
 * whole design in one line: the authority decides what this person may see, using the token they
 * presented, and this application cannot widen it by asking with more authority than it was given.
 *
 * Nothing here caches. A withdrawn authorisation has to be gone on the next render, and a cache is
 * precisely the thing that would keep a revoked authorisation alive on screen.
 */

export class AuthorityError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`The identity authority answered ${status}`);
  }
}

function bearerOf(request: FastifyRequest): string {
  const header = request.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export async function callAuthority<T>(
  request: FastifyRequest,
  path: string,
  init: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${config.giam.issuerUrl.replace(/\/+$/, '')}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${bearerOf(request)}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(request.id ? { 'x-correlation-id': String(request.id) } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Reported as the outage it is. A 401 here would send an operator hunting a credential problem
    // that does not exist.
    throw new AuthorityError(503, { error: 'The identity service is unreachable.' });
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  // The authority's refusal is propagated rather than reinterpreted: it made the decision, and
  // softening or hardening it here would make this application a second, quieter policy point.
  if (!response.ok) throw new AuthorityError(response.status, body);
  return body as T;
}

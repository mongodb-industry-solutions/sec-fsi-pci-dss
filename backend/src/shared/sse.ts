import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerResponse } from 'http';

const allowedOrigins: string[] = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Resolves the Access-Control-Allow-Origin value for a hijacked SSE response.
 * Validates the incoming Origin header against the configured CORS_ORIGIN list.
 * Falls back to the first allowed origin when no match is found.
 */
export function resolveSSEOrigin(requestOrigin: string | undefined): string {
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin;
  return allowedOrigins[0];
}

/**
 * Standard SSE response headers used across all hijacked streaming endpoints.
 * Includes CORS headers that would otherwise be skipped because reply.hijack()
 * bypasses Fastify's CORS plugin.
 */
export function sseHeaders(requestOrigin: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': resolveSSEOrigin(requestOrigin),
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

/**
 * Hijacks the Fastify reply, writes SSE headers, flushes them, and returns
 * the raw ServerResponse for direct streaming.
 */
export function beginSSE(reply: FastifyReply, request: FastifyRequest): ServerResponse {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, sseHeaders(request.headers.origin as string | undefined));
  raw.flushHeaders();
  return raw;
}

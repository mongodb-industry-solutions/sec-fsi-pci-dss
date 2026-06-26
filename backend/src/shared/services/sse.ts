import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerResponse } from 'http';

const DEFAULT_ORIGINS = ['http://localhost:8080', 'http://127.0.0.1:8080'];

const rawOrigin = (process.env.PSP_CORS_ORIGIN ?? '').trim();
const isWildcard = rawOrigin === '*';
const allowedOrigins: string[] = isWildcard
  ? DEFAULT_ORIGINS
  : rawOrigin.split(',').map((o) => o.trim()).filter(Boolean);
if (allowedOrigins.length === 0) allowedOrigins.push(...DEFAULT_ORIGINS);

/**
 * Resolves the Access-Control-Allow-Origin value for a hijacked SSE response.
 * When PSP_CORS_ORIGIN='*', reflects the request origin (credentials require a
 * specific origin, not the literal '*'). Falls back to the first allowed origin.
 */
export function resolveSSEOrigin(requestOrigin: string | undefined): string {
  if (requestOrigin && (isWildcard || allowedOrigins.includes(requestOrigin))) return requestOrigin;
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

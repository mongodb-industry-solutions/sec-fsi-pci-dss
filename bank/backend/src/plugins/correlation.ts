import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

// End to end tracking across the PSP and the bank, using the identifiers the standard already defines.
// Nothing proprietary is introduced:
//
//   · X-Request-ID          Berlin Group, mandatory on every TPP call. Per-call correlation, and the
//                           idempotency key on a retried write.
//   · endToEndIdentification Berlin Group PIS, maps to ISO 20022 EndToEndId. Per-PAYMENT identity, so
//                           it survives across the calls a single payment is made of.
//
// The PSP generates both and sends them; the bank echoes X-Request-ID back and stamps it on every
// record it writes, so investigating one payment is a query by the same id in either database.
declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

export const REQUEST_ID_HEADER = 'x-request-id';

// A TPP that sends no id still has to be traceable, so one is generated rather than left empty.
function resolveCorrelationId(request: FastifyRequest): string {
  const header = request.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || uuidv4();
}

async function correlationPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('correlationId', '');

  fastify.addHook('onRequest', async (request, reply) => {
    request.correlationId = resolveCorrelationId(request);
    // Echoed on the way out: the caller correlates its own logs without having to guess.
    reply.header(REQUEST_ID_HEADER, request.correlationId);
  });
}

export default fp(correlationPlugin, { name: 'correlation' });

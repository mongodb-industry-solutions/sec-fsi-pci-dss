import { FastifyInstance } from 'fastify';
import {
  validateCallback,
  processFdsCallback,
  processAmlCallback,
  processKycCallback,
  processKybCallback,
  processHrpCallback,
  processCardAuthorizationCallback,
  processCardIssuerCallback,
  processGenericCallback,
  type CallbackHandler,
} from '../services/integrationCallback.service';

// §7.7 per-event inbound callback:  POST /api/v1/providers/{group}/{vendorId}/{event}/callback
// The callback is per event+vendor (its own URL). `group` is the capability key; `event` selects the
// per-event inbound mapping/auth. Legacy `/providers/callback/{segment}/:id` stays as an alias.
const GROUP_HANDLER: Record<string, CallbackHandler> = {
  // canonical capability keys
  fds: processFdsCallback,
  aml: processAmlCallback,
  kyc: processKycCallback,
  kyb: processKybCallback,
  hrp: processHrpCallback,
  'card-authorization': processCardAuthorizationCallback,
  'card-issuer': processCardIssuerCallback,
  generic: processGenericCallback,
  // legacy provider-type aliases (robustness for older links)
  fraud_detection: processFdsCallback,
  aml_monitoring: processAmlCallback,
  kyc_identity: processKycCallback,
  kyb_business: processKybCallback,
  hrp_sanctions: processHrpCallback,
  card_authorization: processCardAuthorizationCallback,
  card_issuer: processCardIssuerCallback,
};

export async function providerEventCallbackController(fastify: FastifyInstance) {
  fastify.post<{ Params: { group: string; vendorId: string; event: string } }>(
    '/:group/:vendorId/:event/callback',
    {
      schema: {
        tags: ['providers'],
        params: {
          type: 'object',
          required: ['group', 'vendorId', 'event'],
          properties: { group: { type: 'string' }, vendorId: { type: 'string' }, event: { type: 'string' } },
        },
        headers: { type: 'object', properties: { 'x-webhook-signature': { type: 'string' } } },
        response: { 200: { type: 'object', properties: { received: { type: 'boolean' }, event: { type: 'string' } } } },
      },
    },
    async (request, reply) => {
      const { group, vendorId, event } = request.params;
      const handler = GROUP_HANDLER[group];
      if (!handler) return reply.code(404).send({ error: `Unknown provider group '${group}'` });

      const signature = request.headers['x-webhook-signature'] as string | undefined;
      const bodyRaw = JSON.stringify(request.body);
      const { valid, provider, errorCode } = await validateCallback(fastify.db, vendorId, bodyRaw, signature);
      if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

      // Decode a path-encoded event ('card.issuer.validation.requested' may arrive url-encoded).
      await handler(fastify.db, provider!, request.body as never, decodeURIComponent(event));
      return { received: true, event };
    },
  );
}

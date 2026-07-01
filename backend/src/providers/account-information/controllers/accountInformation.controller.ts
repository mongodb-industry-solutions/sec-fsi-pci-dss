// Account Information (AIS) builtin module controller (SD-36 Open Banking, ADR-029).
// POST /score — validates a payout account; called by integration router.
// GET/PUT /config — admin configuration.

import { FastifyInstance } from 'fastify';
import {
  resolveAccountInformationConfig,
  validateAccount,
} from '../services/accountInformation.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';
import { emitComplianceEvent } from '../../../modules/provider/services/businessProcessEvent.service';
import { PAYOUT_ACCOUNT_COLLECTION } from '../../../modules/gateway/models/payoutAccount.model';
import type { PayoutAccountArrangement } from '../../../modules/gateway/models/payoutAccount.model';

export async function accountInformationController(fastify: FastifyInstance) {
  const CAP = 'account-information';

  fastify.post('/score', {
    schema: {
      tags: ['modules:account-information'],
      summary: 'AIS account validation (internal builtin)',
      description: 'Validates a payout account status and returns PSP internal ledger balance. '
        + 'Called by the integration router. Not JWT-authenticated; requires X-Integration-Source header. '
        + 'IBAN is never present in the request — uses payoutAccountInstanceReference only.',
      headers: {
        type: 'object',
        required: ['x-integration-source'],
        properties: { 'x-integration-source': { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['payoutAccountInstanceReference', 'clientReference'],
        additionalProperties: true,
        properties: {
          payoutAccountInstanceReference: { type: 'string' },
          clientReference: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accountVerified:  { type: 'boolean' },
            accountStatus:    { type: 'string' },
            identityMatch:    { type: 'string' },
            balancePending:   { type: 'number' },
            balanceAvailable: { type: 'number' },
            currency:         { type: 'string' },
            providerReference:{ type: 'string' },
            clientReference:  { type: 'string' },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const payoutAccountRef = body.payoutAccountInstanceReference as string;
    const clientReference = body.clientReference as string;

    const stored = await getCapabilityModuleConfig(fastify.db, CAP);
    const config = resolveAccountInformationConfig(stored?.moduleConfig as Record<string, unknown> | undefined);

    const account = await fastify.db
      .collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
      .findOne({ payoutAccountInstanceReference: payoutAccountRef });

    const result = validateAccount({ payoutAccountInstanceReference: payoutAccountRef, clientReference }, account, config);

    emitComplianceEvent(fastify.db, {
      entityType: 'account',
      entityId: payoutAccountRef,
      processType: 'payment_processing',
      processAction: 'ais.account.validation.completed',
      processOutcome: result.accountVerified ? 'verified' : 'rejected',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: {
        module: CAP,
        payoutAccountRef,
        accountStatus: result.accountStatus,
        accountVerified: result.accountVerified,
      },
      bianServiceDomain: 'SD-36 Open Banking',
      bianControlRecordType: 'AccountInformationValidation',
    });

    return reply.send({ ...result, clientReference });
  });

  fastify.get('/config', {
    schema: {
      tags: ['modules:account-information'],
      summary: 'Get AIS module configuration',
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', {
    schema: {
      tags: ['modules:account-information'],
      summary: 'Update AIS module configuration',
      body: { type: 'object', properties: { moduleConfig: { type: 'object', additionalProperties: true } } },
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

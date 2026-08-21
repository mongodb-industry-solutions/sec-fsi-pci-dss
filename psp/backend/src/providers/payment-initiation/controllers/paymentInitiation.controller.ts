// Payment Initiation (PISP) builtin module controller (ADR-029).
// POST /score: submits a simulated bank transfer; schedules settled/failed callback on the bus.
// GET/PUT /config: admin configuration.

import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import {
  resolvePaymentInitiationConfig,
  initiateTransfer,
  buildSettledInbound,
  buildFailedInbound,
} from '../services/paymentInitiation.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';
import { emitComplianceEvent } from '../../../modules/provider/services/businessProcessEvent.service';
import { getEventBus, makeEvent } from '../../../vendors/eventbus';
import type { BankTransferSettled, BankTransferFailed } from '../../../shared/models/events/payoutOrchestration.events';

export async function paymentInitiationController(fastify: FastifyInstance) {
  const CAP = 'payment-initiation';

  fastify.post('/transfer', {
    schema: {
      tags: ['modules:payment-initiation'],
      summary: 'Payment initiation, submit bank transfer (internal builtin)',
      description: 'Submits a simulated bank transfer. Returns submitted immediately; '
        + 'fires bank.transfer.settled (or .failed) on the event bus after T+N delay. '
        + 'IBAN is never present: uses payoutAccountInstanceReference only. '
        + 'Not JWT-authenticated; requires X-Integration-Source header.',
      headers: {
        type: 'object',
        required: ['x-integration-source'],
        properties: { 'x-integration-source': { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['paymentExecutionInstanceReference', 'clientReference', 'amount', 'currency', 'settlementSchedule'],
        additionalProperties: true,
        properties: {
          paymentExecutionInstanceReference: { type: 'string' },
          clientReference: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          settlementSchedule: { type: 'string', enum: ['T+0', 'T+1', 'T+2', 'T+3'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            railRef:       { type: 'string' },
            status:        { type: 'string', enum: ['submitted'] },
            clientReference: { type: 'string' },
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
    const executionRef = body.paymentExecutionInstanceReference as string;
    const clientReference = body.clientReference as string;
    const amount = body.amount as number;
    const currency = body.currency as string;
    const settlementSchedule = (body.settlementSchedule as string) as 'T+0' | 'T+1' | 'T+2' | 'T+3';

    const stored = await getCapabilityModuleConfig(fastify.db, CAP);
    const config = resolvePaymentInitiationConfig(stored?.moduleConfig as Record<string, unknown> | undefined);

    const result = initiateTransfer({ clientReference, paymentExecutionInstanceReference: executionRef, amount, currency, settlementSchedule }, config);

    emitComplianceEvent(fastify.db, {
      entityType: 'execution',
      entityId: executionRef,
      processType: 'payment_processing',
      processAction: 'payment.initiation.submitted',
      processOutcome: 'submitted',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: { module: CAP, executionRef, railRef: result.railRef, settlementSchedule, amount, currency },
      bianServiceDomain: 'SD-66 Payment Initiation',
      bianControlRecordType: 'PaymentInitiationProcedure',
    });

    // Schedule the async settlement/failure callback on the in-process bus.
    // In a real PISP integration this callback arrives via HTTP from the bank's webhook.
    if (result.settlementDelayMs >= 0) {
      setTimeout(() => {
        try {
          const bus = getEventBus();
          if (result.willSucceed) {
            const settled: BankTransferSettled = {
              paymentExecutionInstanceReference: executionRef,
              railRef: result.railRef,
              completedAt: new Date().toISOString(),
              netAmount: amount,
              currency,
            };
            void bus.publish(makeEvent({
              eventType: 'bank.transfer.settled',
              businessProcess: 'payment_processing',
              correlationId: clientReference,
              causationId: clientReference,
              payload: settled,
            }));
          } else {
            const failed: BankTransferFailed = {
              paymentExecutionInstanceReference: executionRef,
              railRef: result.railRef,
              errorCode: 'RAIL_FAILURE',
              errorReason: 'Simulated rail failure (alwaysSucceed=false)',
            };
            void bus.publish(makeEvent({
              eventType: 'bank.transfer.failed',
              businessProcess: 'payment_processing',
              correlationId: clientReference,
              causationId: clientReference,
              payload: failed,
            }));
          }
        } catch {
          // Bus may be shut down if the server is stopping: ignore gracefully
        }
      }, result.settlementDelayMs);
    }

    return reply.send({ railRef: result.railRef, status: result.status, clientReference });
  });

  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
    schema: {
      tags: ['modules:payment-initiation'],
      summary: 'Get payment-initiation module configuration',
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', {
    preHandler: requirePermission('modules', 'manage'),
    schema: {
      tags: ['modules:payment-initiation'],
      summary: 'Update payment-initiation module configuration',
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

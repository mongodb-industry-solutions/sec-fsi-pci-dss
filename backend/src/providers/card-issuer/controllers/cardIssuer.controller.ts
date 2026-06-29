// Card Issuer capability module controller; STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { validateCardIssuer, resolveCardIssuerConfig } from '../services/cardIssuer.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';
import { emitComplianceEvent } from '../../../modules/provider/services/businessProcessEvent.service';

export async function cardIssuerController(fastify: FastifyInstance) {
  const CAP = 'card-issuer';

  fastify.post('/score', {
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Card issuer validation engine invocation (internal loopback)',
      description: 'Internal card-issuer (bank) validation engine. Called by the integration router (ADR-029) '
        + 'when no external card-issuer vendor is active. Validates the card format, network, and SAD (CVV check) '
        + 'without storing any CHD. PCI DSS Req 3.3: CVV is validated and immediately discarded. '
        + 'Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: {
        type: 'object',
        additionalProperties: true,
        description: 'Card validation payload. May include maskedPan, network, cvv (validated and immediately discarded — never stored). Forwarded by the integration router.',
      },
      response: {
        200: {
          type: 'object',
          description: 'Card issuer validation result.',
          properties: {
            actionConfirmed:     { type: 'boolean', description: 'True when the card passed all issuer checks.' },
            responseCode:        { type: 'string', description: 'ISO 8583-style response code.' },
            network:             { type: 'string', description: 'Resolved card network (e.g. VISA, MASTERCARD).' },
            cvvValidationResult: { type: 'string', enum: ['match', 'mismatch', 'not_provided', 'not_supported'], description: 'CVV check outcome.' },
            decisionReason:      { type: 'string', description: 'Human-readable reason for approval or rejection.' },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' } }, description: 'Missing X-Integration-Source header.' },
      },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;

    // Apply the admin-configured simulator rules (valid CVV, supported networks, format checks).
    const stored = await getCapabilityModuleConfig(fastify.db, CAP);
    const config = resolveCardIssuerConfig(stored?.moduleConfig as Record<string, unknown> | undefined);
    const result = validateCardIssuer(body, config);

    // Correlation keys for audit/monitoring (PCI DSS Req 10): link the validation to the
    // transaction and the fraud case when the caller provides them.
    const transactionId = (body.transactionId ?? body.cardTransactionInstanceReference) as string | undefined;
    const caseReference = (body.caseReference ?? body.fraudDiagnosisCaseReference ?? body.fraudDiagnosisInstanceReference) as string | undefined;

    // Complete, PCI-safe event log: the request and response payloads, correlated to the
    // transaction / case. NEVER includes the PAN or CVV; only masked PAN, network and whether a
    // CVV was supplied. The audit sanitizer also strips any CHD key as a second line of defence.
    const requestLog = {
      maskedPan: (body.maskedPan ?? body.cardTransactionMaskedPanDisplay) as string | undefined,
      networkHint: (body.network ?? body.cardNetwork) as string | undefined,
      cvvProvided: body.cvv !== undefined || body.cvv2 !== undefined || body.cvc !== undefined,
      integrationSource: request.headers['x-integration-source'] as string,
    };

    emitComplianceEvent(fastify.db, {
      entityType: transactionId ? 'transaction' : 'card',
      entityId: transactionId ?? (requestLog.maskedPan ?? 'card-issuer-module'),
      processType: 'card_management',
      // Single closing action (§9.1): the verdict lives in processOutcome + eventSummary.response,
      // not in the event name (no separate approved/declined names).
      processAction: 'card.issuer.validation.completed',
      processOutcome: result.actionConfirmed ? 'approved' : 'rejected',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: {
        module: CAP,
        request: requestLog,
        response: {
          approved: result.actionConfirmed,
          responseCode: result.responseCode,
          network: result.network,
          cvvValidationResult: result.cvvValidationResult,
          decisionReason: result.decisionReason,
        },
        transactionId,
        caseReference,
      },
      bianServiceDomain: 'SD-88 Payment Card',
      bianControlRecordType: 'PaymentCardValidation',
    });

    return reply.send(result);
  });

  fastify.get('/config', {
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Get card-issuer module configuration',
      description: 'Returns the active card-issuer validation engine configuration (valid CVV rules, supported networks, format checks).',
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', {
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Update card-issuer module configuration',
      description: 'Replaces the card-issuer engine configuration (CVV rules, network support, PAN format). Changes take effect on the next invocation.',
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

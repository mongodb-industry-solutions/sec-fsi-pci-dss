// Card Issuer capability module controller; STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { validateCardIssuer, resolveCardIssuerConfig } from '../services/cardIssuer.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../providers/services/capabilityModuleConfig.service';
import { emitComplianceEvent } from '../../providers/services/businessProcessEvent.service';

export async function cardIssuerController(fastify: FastifyInstance) {
  const CAP = 'card-issuer';

  fastify.post('/score', {
    schema: {
      tags: ['modules:card-issuer'],
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string' } } },
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
      // Dotted, module-prefixed action names for clear semantics across the audit trail.
      processAction: result.actionConfirmed ? 'card.issuer.validation.approved' : 'card.issuer.validation.declined',
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

  fastify.get('/config', { schema: { tags: ['modules:card-issuer'] } }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', { schema: { tags: ['modules:card-issuer'] } }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

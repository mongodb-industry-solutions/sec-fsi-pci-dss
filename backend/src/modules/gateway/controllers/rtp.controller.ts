// v28 BIAN SD-65: Request to Pay REST controller. Mounted at /gateway/rtp → /api/v1/gateway/rtp.
// RTP is a transfer that requires the payer's in-app approval (no CIBA). Request resources are strictly
// separate from payment (execution) resources. All mutating routes use dualPermission (session JWT/RBAC
// OR merchant OAuth scope) + idempotency keys + Fastify schemas. Providers only via dispatch (services).
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { dualPermission, resolveOwner } from '../../../vendors/middleware/dualAuth';
import { attributionFromMerchantContext, EventActivityAttribution } from '../../provider/services/businessProcessEvent.service';
import { getIdempotent, saveIdempotent } from '../services/idempotency.service';
import {
  createRtpRequest, getRtpRequest, listRtpRequests, presentRtpRequest,
  viewRtpRequest, cancelRtpRequest, rejectRtpRequest, RtpError,
} from '../services/rtpRequest.service';
import { approveRtpRequest } from '../services/rtpApproval.service';
import { verifyPayeeForRequest } from '../services/rtpScreening.service';
import { issueQr } from '../services/qrRepresentation.service';
import {
  PAYMENT_REQUEST_EVENT_COLLECTION, PaymentRequestEvent,
} from '../models/paymentRequestEvent.model';
import { PAYMENT_REQUEST_COLLECTION } from '../models/paymentRequest.model';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';
import { getCaseNotes } from '../../fraud/services/fraudDiagnosis.service';

// Statuses where the payer has consented (by approving/paying), so the payee may see the payer's name
// (SEPA/PSD2: debtor name is disclosed to the creditor on the credit transfer).
const PAYER_CONSENTED = ['accepted', 'payment_initiated', 'payment_processing', 'payment_settled', 'payment_failed', 'reversed', 'disputed'];

// Build a customer-safe security-case summary for an RTP request (case is keyed by the request ref).
// Authorized to BOTH parties of the request (transparency: both see the PSP/L1/L2 outcome on their funds).
async function buildSecurityCase(db: import('mongodb').Db, ref: string) {
  const fraudCase = await db.collection(FRAUD_DIAGNOSIS_COLLECTION).findOne({ cardTransactionInstanceReference: ref });
  if (!fraudCase) return null;
  const caseId = fraudCase['fraudDiagnosisInstanceReference'] as string;
  const notes = (await getCaseNotes(db, caseId, 'customer')).filter((n) => !n.isRetracted);
  return {
    caseInstanceReference: caseId,
    caseReference: fraudCase['fraudDiagnosisCaseReference'] ?? null,
    caseStatus: fraudCase['fraudDiagnosisCaseStatus'] ?? null,
    caseSeverity: fraudCase['fraudDiagnosisCaseSeverity'] ?? null,
    resolutionOutcome: (fraudCase['fraudDiagnosisResolutionRecord'] as Record<string, unknown> | null)?.resolutionOutcome ?? null,
    notes,
  };
}

function getUser(request: unknown): JwtUserPayload | undefined {
  return (request as { user?: JwtUserPayload }).user;
}

// Resolve the acting party from either the merchant OAuth context or the session JWT.
interface Actor { partyRef: string; role?: string; authMethod: 'session_jwt' | 'oauth_session'; attribution?: EventActivityAttribution; deviceUserAgent?: string }
async function resolveActor(request: FastifyRequest, reply: FastifyReply): Promise<Actor | undefined> {
  const deviceUserAgent = request.headers['user-agent'];
  if (request.merchantContext) {
    const owner = await resolveOwner(request, reply);
    if (!owner) return undefined;
    if (!owner.ownerPartyRef) { reply.code(404).send({ error: 'party_not_found' }); return undefined; }
    return { partyRef: owner.ownerPartyRef, role: 'customer', authMethod: 'oauth_session', attribution: attributionFromMerchantContext(request.merchantContext), deviceUserAgent };
  }
  const user = getUser(request);
  if (!user?.partyRef) { reply.code(401).send({ error: 'Unauthenticated' }); return undefined; }
  return { partyRef: user.partyRef, role: user.role, authMethod: 'session_jwt', deviceUserAgent };
}

function handleRtpError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof RtpError) return reply.code(err.httpStatus).send({ error: err.code, error_description: err.message });
  return reply.code(500).send({ error: 'internal_error', error_description: err instanceof Error ? err.message : 'Unexpected error' });
}

const remittanceSchema = { type: 'object', properties: { referenceType: { type: 'string' }, reference: { type: 'string' }, additionalInfo: { type: 'string' } } } as const;
const addressSchema = { type: 'object', properties: { streetName: { type: 'string' }, buildingNumber: { type: 'string' }, postCode: { type: 'string' }, townName: { type: 'string' }, countrySubDivision: { type: 'string' }, country: { type: 'string' } } } as const;

export async function rtpController(fastify: FastifyInstance) {

  // POST /requests: create an RTP request (payee). Idempotent on the session path.
  fastify.post('/requests', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'paymentRequests', action: 'manage', scope: 'write:rtp' }),
    schema: {
      tags: ['rtp'], summary: 'Create a Request to Pay (SD-65)', security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['amount'],
        properties: {
          amount: { type: 'number', exclusiveMinimum: 0 },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          purpose: { type: 'string', maxLength: 200 },
          payeeName: { type: 'string', maxLength: 140 },
          payeeAlias: { type: 'string', maxLength: 140 },
          payeeCounterpartyReference: { type: 'string' },
          payeeReceivingAccountReference: { type: 'string' },
          payerPartyReference: { type: 'string' },
          payerCounterpartyReference: { type: 'string' },
          payerAlias: { type: 'string', maxLength: 140 },
          invoiceReference: { type: 'string', maxLength: 60 },
          dueAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          supportedRails: { type: 'array', items: { type: 'string', enum: ['sepa', 'ach', 'swift', 'local_bank'] } },
          preferredRail: { type: 'string', enum: ['sepa', 'ach', 'swift', 'local_bank'] },
          structuredRemittance: remittanceSchema,
          unstructuredRemittance: { type: 'string', maxLength: 140 },
          structuredAddress: addressSchema,
          allowPartialPayment: { type: 'boolean' },
          allowMultiplePayments: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const actor = await resolveActor(request, reply);
    if (!actor) return;
    const b = request.body as Record<string, unknown>;
    const idemKey = request.headers['idempotency-key'] as string | undefined;
    if (idemKey) {
      const prior = await getIdempotent<{ paymentRequestInstanceReference: string }>(fastify.db, 'rtp.create', actor.partyRef, idemKey);
      if (prior) return reply.code(201).send(prior);
    }
    try {
      const req = await createRtpRequest(fastify.db, {
        requesterPartyReference: actor.partyRef,
        amount: b.amount as number,
        currency: b.currency as string | undefined,
        purpose: b.purpose as string | undefined,
        payeeName: b.payeeName as string | undefined,
        payeeAlias: b.payeeAlias as string | undefined,
        payeeCounterpartyReference: b.payeeCounterpartyReference as string | undefined,
        payeeReceivingAccountReference: b.payeeReceivingAccountReference as string | undefined,
        payerPartyReference: b.payerPartyReference as string | undefined,
        payerCounterpartyReference: b.payerCounterpartyReference as string | undefined,
        payerAlias: b.payerAlias as string | undefined,
        invoiceReference: b.invoiceReference as string | undefined,
        dueAt: b.dueAt ? new Date(b.dueAt as string) : undefined,
        expiresAt: b.expiresAt ? new Date(b.expiresAt as string) : undefined,
        supportedRails: b.supportedRails as never,
        preferredRail: b.preferredRail as never,
        structuredRemittance: b.structuredRemittance as never,
        unstructuredRemittance: b.unstructuredRemittance as string | undefined,
        structuredAddress: b.structuredAddress as never,
        allowPartialPayment: b.allowPartialPayment as boolean | undefined,
        allowMultiplePayments: b.allowMultiplePayments as boolean | undefined,
        idempotencyKey: idemKey,
        attribution: actor.attribution,
      });
      if (idemKey) await saveIdempotent(fastify.db, 'rtp.create', actor.partyRef, idemKey, { paymentRequestInstanceReference: req.paymentRequestInstanceReference });
      return reply.code(201).send(req);
    } catch (err) { return handleRtpError(err, reply); }
  });

  // GET /requests: list inbox (payerId) / outbox (requesterId). Defaults to the caller's own.
  fastify.get('/requests', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'paymentRequests', action: 'view', scope: 'read:rtp' }),
    schema: {
      tags: ['rtp'], summary: 'List Request to Pay records (inbox/outbox)', security: [{ bearerAuth: [] }],
      querystring: { type: 'object', properties: { requesterId: { type: 'string' }, payerId: { type: 'string' }, box: { type: 'string', enum: ['inbox', 'outbox'] }, status: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const actor = await resolveActor(request, reply);
    if (!actor) return;
    const q = request.query as { requesterId?: string; payerId?: string; box?: string; status?: string };
    // Non-staff callers are scoped to themselves (own): inbox = payer, outbox = requester.
    const staff = actor.role && actor.role !== 'customer';
    let requesterPartyReference = q.requesterId;
    let payerPartyReference = q.payerId;
    if (!staff) {
      if (q.box === 'inbox') { payerPartyReference = actor.partyRef; requesterPartyReference = undefined; }
      else { requesterPartyReference = actor.partyRef; payerPartyReference = undefined; }
    }
    const results = await listRtpRequests(fastify.db, { requesterPartyReference, payerPartyReference, status: q.status as never });
    return reply.send({ results });
  });

  // GET /requests/:ref, retrieve one.
  fastify.get('/requests/:ref', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'paymentRequests', action: 'view', scope: 'read:rtp' }),
    schema: { tags: ['rtp'], summary: 'Retrieve one Request to Pay', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } },
  }, async (request, reply) => {
    const actor = await resolveActor(request, reply);
    if (!actor) return;
    const { ref } = request.params as { ref: string };
    const req = await getRtpRequest(fastify.db, ref);
    if (!req) return reply.code(404).send({ error: 'not_found' });
    const staff = actor.role && actor.role !== 'customer';
    if (!staff && req.requesterPartyReference !== actor.partyRef && req.payerPartyReference !== actor.partyRef) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    // Enrich for the detail view:
    // - payeeName: the requester's real name (authorized to the payer, requesting is the consent).
    // - payerName: the payer's real name, only once they consented by approving/paying (SEPA/PSD2).
    // - payeeAccountDisplay: the destination (bank + masked IBAN) so the payer sees where the money goes.
    // - securityCase: visible to BOTH parties (transparency of the PSP/L1/L2 resolution on their funds).
    const nameOf = async (partyRef?: string) => partyRef
      ? (await fastify.db.collection<{ partyName?: string }>('party')
          .findOne({ partyInstanceReference: partyRef } as Record<string, unknown>, { projection: { partyName: 1 } }))?.partyName
      : undefined;

    const payeeName = req.payeeName ?? await nameOf(req.requesterPartyReference);
    const payerName = PAYER_CONSENTED.includes(req.status) ? await nameOf(req.payerPartyReference) : undefined;

    let payeeAccountDisplay: { bankName?: string; maskedIban?: string; alias?: string } | undefined;
    const acct = await fastify.db.collection<{ payoutAccountIban?: string; payoutAccountBankName?: string; payoutAccountAlias?: string }>('payoutAccountArrangement')
      .findOne({ payoutAccountInstanceReference: req.payeeReceivingAccountReference } as Record<string, unknown>,
        { projection: { payoutAccountIban: 1, payoutAccountBankName: 1, payoutAccountAlias: 1 } }).catch(() => null);
    if (acct) {
      const iban = acct.payoutAccountIban;
      payeeAccountDisplay = {
        bankName: acct.payoutAccountBankName,
        alias: acct.payoutAccountAlias,
        // Mask to the last 4 (GDPR minimisation): the payer sees the destination without the full IBAN.
        maskedIban: iban ? `••••${iban.slice(-4)}` : undefined,
      };
    }

    // Beneficiary link for the payee's view: the requester's SD-54 arrangement representing the payer.
    // Resolve on read (covers RTP created before the field existed) if not already stored.
    let payerCounterpartyReference = req.payerCounterpartyReference;
    if (!payerCounterpartyReference && req.payerPartyReference) {
      const arr = await fastify.db.collection<{ counterpartyArrangementReference?: string }>('counterpartyArrangement')
        .findOne({ ownerPartyReference: req.requesterPartyReference, counterpartyPartyReference: req.payerPartyReference } as Record<string, unknown>,
          { projection: { counterpartyArrangementReference: 1 } }).catch(() => null);
      payerCounterpartyReference = arr?.counterpartyArrangementReference;
    }

    const securityCase = await buildSecurityCase(fastify.db, ref).catch(() => null);
    return reply.send({ ...req, payeeName, payerName, payeeAccountDisplay, payerCounterpartyReference, securityCase });
  });

  // GET /requests/:ref/events, per-request timeseries trail.
  fastify.get('/requests/:ref/events', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'paymentRequests', action: 'view', scope: 'read:rtp' }),
    schema: { tags: ['rtp'], summary: 'Per-request event trail', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } },
  }, async (request, reply) => {
    const actor = await resolveActor(request, reply);
    if (!actor) return;
    const { ref } = request.params as { ref: string };
    const events = await fastify.db.collection<PaymentRequestEvent>(PAYMENT_REQUEST_EVENT_COLLECTION)
      .find({ paymentRequestInstanceReference: ref }).sort({ eventDateTime: 1 }).limit(200).toArray();
    return reply.send({ events });
  });

  // Mutating lifecycle actions. present/cancel by the requester; view/verify/accept/reject by the payer.
  const writeGuard = { config: { dualAuth: true }, preHandler: dualPermission({ resource: 'paymentRequests', action: 'manage', scope: 'write:rtp' }) };

  fastify.post('/requests/:ref/present', { ...writeGuard, schema: { tags: ['rtp'], summary: 'Present/deliver a request to the payer', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } } }, async (request, reply) => {
    const actor = await resolveActor(request, reply); if (!actor) return;
    const { ref } = request.params as { ref: string };
    try { return reply.send(await presentRtpRequest(fastify.db, ref, actor.partyRef)); } catch (err) { return handleRtpError(err, reply); }
  });

  fastify.post('/requests/:ref/view', { config: { dualAuth: true }, preHandler: dualPermission({ resource: 'paymentRequests', action: 'view', scope: 'read:rtp' }), schema: { tags: ['rtp'], summary: 'Mark a request viewed (payer)', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } } }, async (request, reply) => {
    const actor = await resolveActor(request, reply); if (!actor) return;
    const { ref } = request.params as { ref: string };
    try { return reply.send(await viewRtpRequest(fastify.db, ref, actor.partyRef)); } catch (err) { return handleRtpError(err, reply); }
  });

  fastify.post('/requests/:ref/verify-payee', { ...writeGuard, schema: { tags: ['rtp'], summary: 'Run Verification of Payee for a request', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } } }, async (request, reply) => {
    const actor = await resolveActor(request, reply); if (!actor) return;
    const { ref } = request.params as { ref: string };
    const req = await getRtpRequest(fastify.db, ref);
    if (!req) return reply.code(404).send({ error: 'not_found' });
    return reply.send(await verifyPayeeForRequest(fastify.db, req));
  });

  fastify.post('/requests/:ref/accept', { ...writeGuard, schema: { tags: ['rtp'], summary: 'Approve a request (in-app, payer) → create linked payment order', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } }, body: { type: 'object', properties: { fundingAccountRef: { type: 'string' } } } } }, async (request, reply) => {
    const actor = await resolveActor(request, reply); if (!actor) return;
    const { ref } = request.params as { ref: string };
    const b = (request.body ?? {}) as { fundingAccountRef?: string };
    const idemKey = request.headers['idempotency-key'] as string | undefined;
    if (idemKey) {
      const prior = await getIdempotent<{ status: string }>(fastify.db, 'rtp.accept', actor.partyRef, idemKey);
      if (prior) return reply.code(202).send(prior);
    }
    try {
      const result = await approveRtpRequest(fastify.db, ref, {
        actor: actor.partyRef, role: actor.role, fundingAccountRef: b.fundingAccountRef,
        deviceUserAgent: actor.deviceUserAgent, authMethod: actor.authMethod, attribution: actor.attribution,
      });
      if (idemKey) await saveIdempotent(fastify.db, 'rtp.accept', actor.partyRef, idemKey, result);
      return reply.code(result.status === 'accepted' ? 202 : 422).send(result);
    } catch (err) { return handleRtpError(err, reply); }
  });

  fastify.post('/requests/:ref/reject', { ...writeGuard, schema: { tags: ['rtp'], summary: 'Reject a request (payer)', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } } }, async (request, reply) => {
    const actor = await resolveActor(request, reply); if (!actor) return;
    const { ref } = request.params as { ref: string };
    try { return reply.send(await rejectRtpRequest(fastify.db, ref, { actor: actor.partyRef, role: actor.role, deviceUserAgent: actor.deviceUserAgent, authMethod: actor.authMethod, attribution: actor.attribution })); } catch (err) { return handleRtpError(err, reply); }
  });

  fastify.post('/requests/:ref/cancel', { ...writeGuard, schema: { tags: ['rtp'], summary: 'Cancel a request (requester)', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } } }, async (request, reply) => {
    const actor = await resolveActor(request, reply); if (!actor) return;
    const { ref } = request.params as { ref: string };
    try { return reply.send(await cancelRtpRequest(fastify.db, ref, actor.partyRef)); } catch (err) { return handleRtpError(err, reply); }
  });

  // POST /requests/:ref/qr, issue/get a QR for this request (shared QR capability).
  // v35 CH-3: state-changing → write-level, as POST /gateway/qr/represent (PCI DSS Req 7).
  fastify.post('/requests/:ref/qr', { config: { dualAuth: true }, preHandler: dualPermission({ resource: 'paymentRequests', action: 'manage', scope: 'write:rtp' }), schema: { tags: ['rtp'], summary: 'Issue/get a QR for this request', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } } }, async (request, reply) => {
    const actor = await resolveActor(request, reply); if (!actor) return;
    const { ref } = request.params as { ref: string };
    const req = await getRtpRequest(fastify.db, ref);
    if (!req) return reply.code(404).send({ error: 'not_found' });
    const qr = await issueQr(fastify.db, {
      subjectType: 'rtp_request', subjectReference: ref, expiresAt: req.expiresAt,
    });
    // Persist the QR link back on the request (best-effort; not on the write path so failures are non-fatal).
    await fastify.db.collection(PAYMENT_REQUEST_COLLECTION).updateOne(
      { paymentRequestInstanceReference: ref },
      { $set: { qrRepresentationReference: qr.qrRepresentationInstanceReference, recordUpdatedDateTime: new Date() } },
    ).catch(() => { /* non-fatal */ });
    return reply.send(qr);
  });
}

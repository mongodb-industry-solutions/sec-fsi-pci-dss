// v28 Shared QR capability REST controller. Mounted at /gateway/qr → /api/v1/gateway/qr.
// Reused by RTP, payment links, and redirect/checkout. Issue is scoped by subject (write on the
// owning resource); resolve is a lightweight public-ish read of the encoded payload (no PII beyond a
// signed deep link / EPC string). All provider-free; backend owns only the canonical payload.
import { FastifyInstance } from 'fastify';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { dualPermission } from '../../../vendors/middleware/dualAuth';
import { issueQr, resolveQr } from '../services/qrRepresentation.service';
import { QrSubjectType, QrPayloadFormat } from '../models/qrRepresentation.model';

function getUser(request: unknown): JwtUserPayload | undefined {
  return (request as { user?: JwtUserPayload }).user;
}

export async function qrController(fastify: FastifyInstance) {
  // POST /represent — issue a QR for any subject (rtp_request / payment_link / checkout_session).
  fastify.post('/represent', {
    config: { dualAuth: true },
    // State-changing (issues a new QR record) → write-level (PCI DSS Req 7 least privilege). Resolve
    // (GET /:ref below) stays read-level. Authorization is per subjectType so each caller uses its
    // natural scope: RTP requests → paymentRequests:manage / write:rtp; payment links & checkout
    // sessions → merchants:view / write:payments (same guard as their creation endpoints).
    preHandler: (request, reply) => {
      const subjectType = (request.body as { subjectType?: string } | undefined)?.subjectType;
      const guard = subjectType === 'rtp_request'
        ? dualPermission({ resource: 'paymentRequests', action: 'manage', scope: 'write:rtp' })
        : dualPermission({ resource: 'merchants', action: 'view', scope: 'write:payments' });
      return guard(request, reply);
    },
    schema: {
      tags: ['qr'], summary: 'Issue a QR representation for a payable subject', security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['subjectType', 'subjectReference'],
        properties: {
          subjectType: { type: 'string', enum: ['rtp_request', 'payment_link', 'checkout_session'] },
          subjectReference: { type: 'string' },
          payloadFormat: { type: 'string', enum: ['url', 'emvco', 'sepa_epc'] },
          amount: { type: 'number' }, currency: { type: 'string' },
          payeeName: { type: 'string' }, iban: { type: 'string' }, remittance: { type: 'string' },
          singleUse: { type: 'boolean' }, expiresAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body as Record<string, unknown>;
    const qr = await issueQr(fastify.db, {
      subjectType: b.subjectType as QrSubjectType,
      subjectReference: b.subjectReference as string,
      payloadFormat: b.payloadFormat as QrPayloadFormat | undefined,
      amount: b.amount as number | undefined,
      currency: b.currency as string | undefined,
      payeeName: b.payeeName as string | undefined,
      iban: b.iban as string | undefined,
      remittance: b.remittance as string | undefined,
      singleUse: b.singleUse as boolean | undefined,
      expiresAt: b.expiresAt ? new Date(b.expiresAt as string) : undefined,
    });
    return reply.send(qr);
  });

  // GET /:ref — resolve a QR payload (marks single-use consumed). Session or merchant OAuth.
  fastify.get('/:ref', {
    config: { dualAuth: true },
    preHandler: dualPermission({ resource: 'paymentRequests', action: 'view', scope: 'read:rtp' }),
    schema: { tags: ['qr'], summary: 'Resolve a QR payload', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' } } } },
  }, async (request, reply) => {
    void getUser(request);
    const { ref } = request.params as { ref: string };
    const qr = await resolveQr(fastify.db, ref);
    if (!qr) return reply.code(404).send({ error: 'not_found_or_expired' });
    return reply.send(qr);
  });
}

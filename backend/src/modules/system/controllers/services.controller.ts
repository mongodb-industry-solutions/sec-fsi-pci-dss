import { FastifyInstance } from 'fastify';
import { probeBankcore } from '../../provider/services/bankcoreHealth.service';
import { fetchBankcoreLogs } from '../../provider/services/bankcoreLogs.service';
import { readBankcoreAdmin } from '../../provider/services/bankcoreAdmin.service';
import { requirePermission } from '../../../vendors/middleware/acl';

// Platform service list for the admin panel. Authenticated: it names internal hosts, which is not
// something a public health endpoint should carry.
export async function servicesController(fastify: FastifyInstance) {
  fastify.get('/services', {
    preHandler: requirePermission('providers', 'view'),
    schema: {
      tags: ['system'],
      summary: 'Monitored platform services',
      description:
        'State of each platform service. `disabled` and `misconfigured` are distinguished from '
        + '`unreachable`, so a configuration fault is never reported as a network outage.',
      response: {
        200: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
  }, async () => {
    const bankcore = await probeBankcore();
    return { results: [bankcore] };
  });

  fastify.get('/services/bankcore/logs', {
    preHandler: requirePermission('providers', 'view'),
    schema: {
      tags: ['system'],
      summary: 'Recent bankcore log lines',
      description:
        "Pulls the bank's own ring buffer over the private network, so a broken bank setup is "
        + 'diagnosable from the panel instead of only from pod logs.',
      querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } },
      response: {
        200: {
          type: 'object',
          properties: {
            lines: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request) => {
    const { limit } = request.query as { limit?: number };
    return fetchBankcoreLogs(limit ?? 200);
  });
  // ── The bank's administration, read through the PSP ───────────────────────────────────────────
  fastify.get('/services/bankcore/admin/*', {
    preHandler: requirePermission('providers', 'view'),
    schema: {
      tags: ['system'],
      summary: "Read the bank's administrative resources",
      description:
        'v37 P6.7e: the Bankcore panel calls the PSP, never the bank. The browser keeps one origin, one token '
        + 'and no preflight, and the bank registers no permissive CORS, because a public bank hostname that '
        + 'accepted browser calls from anywhere would be worse than an inconvenient panel.\n\n'
        + 'A NARROW proxy, not a pass-through: only the administrable resources are reachable '
        + '(`module/config`, `tpp/registrations`, `tpp/subscriptions`, `tpp/deliveries`, `consents`, `audit`). '
        + 'A generic forwarder would let the browser reach anything the bank exposes, its Open Banking surface '
        + 'included, holding an admin token.\n\n'
        + 'An unreachable bank answers 502 with the reason rather than an empty result: a panel showing "no '
        + 'registrations" when the bank is down is the most misleading thing it could show.',
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        502: { type: 'object', properties: { error: { type: 'string' } } },
        503: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const resource = (request.params as { '*'?: string })['*'] ?? '';
    const actor = (request as { user?: { sub?: string } }).user?.sub ?? 'admin-panel';
    const result = await readBankcoreAdmin(resource, request.query as Record<string, unknown>, actor);
    // The bank's own status is passed through, including a refusal it decided: rewriting it would hide
    // whether the panel or the bank said no.
    const status = result.status as 200;
    if (result.error) return reply.status(status).send({ error: result.error });
    return reply.status(status).send(result.body as never);
  });
}

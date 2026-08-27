import { FastifyInstance } from 'fastify';
import { probeBankcore } from '../../provider/services/bankcoreHealth.service';
import { fetchBankcoreLogs } from '../../provider/services/bankcoreLogs.service';
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
}

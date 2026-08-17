import dotenv from 'dotenv';
import { resolve } from 'path';

// Same layout as the backend: .env at the repo root, two levels up from bankcore/bin/.
dotenv.config({ path: resolve(__dirname, '../../.env') });
import Fastify, { FastifyInstance } from 'fastify';
import mongodbPlugin from '../src/plugins/mongodb';
import swaggerPlugin from '../src/plugins/swagger';
import { appendLog, appendLogEntry, levelLabel, mirrorConsoleToLogBuffer } from '../src/shared/services/logBuffer';
import { systemModule } from '../src/modules/system';
import { config } from '../src/config';

export async function buildApp(): Promise<FastifyInstance> {
  mirrorConsoleToLogBuffer();

  const fastify = Fastify({
    logger: {
      // Mirror every warn/error/fatal into the ring buffer the PSP admin panel reads, whatever the
      // call site. A handler that logs and answers 500 without throwing skips the onError hook.
      hooks: {
        logMethod(args: unknown[], method: (...a: unknown[]) => void, level: number) {
          if (level >= 40) appendLogEntry(levelLabel(level), args);
          return method.apply(this, args);
        },
      },
    },
    pluginTimeout: 60000,
    ajv: { customOptions: { keywords: ['example'] } },
  });

  fastify.addSchema({ $id: 'Error', type: 'object', properties: { error: { type: 'string' } }, required: ['error'] });

  await fastify.register(swaggerPlugin);

  // Fault tolerant like the PSP's: the process still starts so /health can report why it is degraded.
  await fastify.register(mongodbPlugin);

  // No CORS plugin at all: bankcore is private and server to server. Registering a permissive origin
  // would create the browser-reachable surface the design deliberately avoids.

  fastify.addHook('preHandler', async (request, reply) => {
    const url = request.url;
    const isHealth = url === '/health' || url.startsWith('/api/v1/system/health');
    if (fastify.dbError !== null && url.startsWith('/api/') && !isHealth) {
      return reply.status(503).send({ error: 'Service unavailable', detail: fastify.dbError });
    }
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    appendLog(
      `[${new Date().toISOString()}] ${request.method} ${request.url} -> ${reply.statusCode}`
      + ` (${reply.elapsedTime.toFixed(0)}ms)`,
    );
    done();
  });

  // PCI DSS and GDPR: the error type and a length-capped message, never the full stack.
  fastify.addHook('onError', (request, reply, error, done) => {
    const status = (error as { statusCode?: number }).statusCode ?? reply.statusCode ?? 500;
    const message = (error.message || '').replace(/\s+/g, ' ').slice(0, 500);
    appendLog(
      `[${new Date().toISOString()}] ERROR ${request.method} ${request.url} -> ${status} `
      + `[${request.id}] ${error.name || 'Error'}: ${message}`,
    );
    done();
  });

  fastify.get('/', {
    schema: {
      tags: ['system'],
      summary: 'Redirect to Swagger UI',
      response: { 302: { type: 'null', description: 'Redirect to /doc' } },
    },
  }, async (_request, reply) => reply.redirect('/doc'));

  // Infra probes (k8s, Docker, LBs) expect this path.
  fastify.get('/health', {
    schema: {
      tags: ['system'],
      summary: 'Health check (standard alias)',
      description: 'IETF health+json with the `mongodb:connectivity` check. Public within the private network.',
      response: {
        200: { type: 'object', additionalProperties: true },
        503: { type: 'object', additionalProperties: true },
      },
    },
  }, async (_request, reply) => {
    const now = new Date().toISOString();
    reply.header('Content-Type', 'application/health+json; charset=utf-8');
    if (fastify.dbError) {
      return reply.status(503).send({
        status: 'fail',
        serviceId: 'fsi-pci-dss-bankcore',
        checks: { 'mongodb:connectivity': [{ status: 'fail', componentType: 'datastore', output: fastify.dbError, time: now }] },
      });
    }
    try {
      const t0 = Date.now();
      await fastify.db.command({ ping: 1 });
      return reply.send({
        status: 'pass',
        serviceId: 'fsi-pci-dss-bankcore',
        checks: { 'mongodb:connectivity': [{ status: 'pass', componentType: 'datastore', observedValue: Date.now() - t0, observedUnit: 'ms', time: now }] },
      });
    } catch (err) {
      return reply.status(503).send({
        status: 'fail',
        serviceId: 'fsi-pci-dss-bankcore',
        checks: { 'mongodb:connectivity': [{ status: 'fail', componentType: 'datastore', output: err instanceof Error ? err.message : 'ping failed', time: now }] },
      });
    }
  });

  await fastify.register(systemModule, { prefix: '/api/v1' });

  return fastify;
}

// Async errors thrown outside a request never reach the onError hook, so mirror them too.
function installProcessErrorHooks(): void {
  const record = (kind: string, err: unknown) => {
    const e = err as { name?: string; message?: string };
    const message = String(e?.message ?? err).replace(/\s+/g, ' ').slice(0, 500);
    appendLog(`[${new Date().toISOString()}] PROCESS ${kind}: ${e?.name ?? typeof err}: ${message}`);
  };
  process.on('unhandledRejection', (reason) => record('unhandledRejection', reason));
  process.on('warning', (w) => record('warning', w));
  process.on('uncaughtException', (err) => {
    record('uncaughtException', err);
    console.error(err);
    process.exit(1);
  });
}

async function start() {
  installProcessErrorHooks();
  const app = await buildApp();
  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    console.log(`.........................................................................`);
    console.log(`bankcore listening on http://${config.server.host}:${config.server.port}`);
    console.log(`Swagger UI: http://${config.server.host}:${config.server.port}/doc`);
    console.log(`database: ${config.mongodb.dbName}, key vault: ${config.kms.keyVaultNamespace}`);
    if (app.dbError !== null) {
      console.warn(`[bankcore/mongodb] Running in degraded mode: ${app.dbError}`);
    }
    console.log(`.........................................................................`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

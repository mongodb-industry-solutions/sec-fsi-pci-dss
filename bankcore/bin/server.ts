import dotenv from 'dotenv';
import { resolve } from 'path';

// Same layout as the backend: .env at the repo root, two levels up from bankcore/bin/.
dotenv.config({ path: resolve(__dirname, '../../.env') });
import Fastify, { FastifyInstance } from 'fastify';
import mongodbPlugin from '../src/plugins/mongodb';
import correlationPlugin from '../src/plugins/correlation';
import swaggerPlugin from '../src/plugins/swagger';
import { appendLog, appendLogEntry, levelLabel, mirrorConsoleToLogBuffer } from '../src/shared/services/logBuffer';
import { configurationReport, readinessReport, formatReport } from '../src/shared/services/startupReport';
import { systemModule } from '../src/modules/system';
import { adminModule } from '../src/modules/admin';
import { aispModule } from '../src/modules/aisp';
import { tppTrustModule } from '../src/modules/tpp-trust';
import { consentModule } from '../src/modules/consent';
import { pispModule } from '../src/modules/pisp';
import { paymentHubModule } from '../src/modules/payment-hub';
import { cardAuthorizationModule } from '../src/modules/card-authorization';
import { cardIssuerModule } from '../src/modules/card-issuer';
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

  // Before anything that logs or writes: every line and every record carries the caller's id.
  await fastify.register(correlationPlugin);

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

  // A schema validation failure must still look like this bank's API. Fastify answers with its own
  // {statusCode, error, message} body, and a route whose error schema declares `tppMessages` then strips
  // that to `{}`: the caller gets an empty 400 for the most common mistake there is. Rendering it here
  // means every route keeps its `required` and its types in the published contract without that cost.
  fastify.setErrorHandler((error, request, reply) => {
    const validation = (error as { validation?: Array<{ instancePath?: string; message?: string }> }).validation;
    if (validation?.length) {
      const detail = validation
        .map((issue) => `${issue.instancePath || 'body'} ${issue.message ?? 'is invalid'}`.trim())
        .join('; ');
      const isOpenBanking = request.url.startsWith('/v1/');
      return reply.status(400).send(isOpenBanking
        ? { tppMessages: [{ category: 'ERROR', code: 'FORMAT_ERROR', text: detail }] }
        : { error: 'Bad Request', detail });
    }
    const failure = error as { statusCode?: number; message?: string };
    const status = failure.statusCode ?? 500;
    // PCI DSS and GDPR: never the stack, and never an internal message on a 500.
    return reply.status(status).send(status >= 500
      ? { error: 'Internal Server Error' }
      : { error: failure.message ?? 'Request failed' });
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    appendLog(
      `[${new Date().toISOString()}] ${request.method} ${request.url} -> ${reply.statusCode}`
      + ` (${reply.elapsedTime.toFixed(0)}ms) [${request.correlationId}]`,
    );
    done();
  });

  // PCI DSS and GDPR: the error type and a length-capped message, never the full stack.
  fastify.addHook('onError', (request, reply, error, done) => {
    const status = (error as { statusCode?: number }).statusCode ?? reply.statusCode ?? 500;
    const message = (error.message || '').replace(/\s+/g, ' ').slice(0, 500);
    appendLog(
      `[${new Date().toISOString()}] ERROR ${request.method} ${request.url} -> ${status} `
      + `[${request.correlationId}] ${error.name || 'Error'}: ${message}`,
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

  // Open Banking surface, at the standard's own path. The token endpoint comes first: it is what every
  // other endpoint here requires.
  await fastify.register(tppTrustModule);
  // Consent before the reads it authorises: nothing in AIS answers with data without one.
  await fastify.register(consentModule);
  await fastify.register(aispModule);
  await fastify.register(pispModule);
  await fastify.register(paymentHubModule);
  await fastify.register(cardAuthorizationModule);
  await fastify.register(cardIssuerModule);
  // Diagnostics and administration, explicitly NOT part of the bank's Open Banking API.
  await fastify.register(systemModule, { prefix: '/api/v1' });
  await fastify.register(adminModule, { prefix: '/api/v1' });

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

    // The whole report goes through appendLog as well as stdout, so the PSP admin panel shows what this
    // bank is pointed at without anyone needing pod access.
    const report = [
      ...configurationReport(),
      ...await readinessReport(app.dbError === null ? app.db : undefined, app.dbError),
    ];
    const separator = '.........................................................................';
    for (const line of [separator, 'bankcore is up', ...formatReport(report), separator]) {
      console.log(line);
      appendLog(`[${new Date().toISOString()}] STARTUP ${line.trim()}`);
    }
    if (app.dbError !== null) {
      console.warn(`[bankcore/mongodb] Running in degraded mode: ${app.dbError}`);
      console.warn('[bankcore/mongodb] API routes return 503 until the database becomes reachable.');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

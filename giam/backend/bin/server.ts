import dotenv from 'dotenv';
import { resolve } from 'path';

// The repo root .env, two levels up from giam/bin/.
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import Fastify, { FastifyInstance } from 'fastify';
import corsPlugin from '../src/plugins/cors';
import correlationPlugin from '../src/plugins/correlation';
import mongodbPlugin from '../src/plugins/mongodb';
import swaggerPlugin from '../src/plugins/swagger';
import { appendLog, appendLogEntry, levelLabel, mirrorConsoleToLogBuffer } from '../src/shared/services/logBuffer';
import { configurationReport, readinessReport, formatReport } from '../src/shared/services/startupReport';
import { PROBLEM_SCHEMA, problem, isOAuthSurface, oauthError } from '../src/shared/models/problem';
import { realmModule } from '../src/modules/realm';
import { directoryModule } from '../src/modules/directory';
import { provisioningModule } from '../src/modules/provisioning';
import { authenticationModule } from '../src/modules/authentication';
import { oauthModule } from '../src/modules/oauth';
import { consentModule } from '../src/modules/consent';
import { authorizationModule } from '../src/modules/authorization';
import { workloadModule } from '../src/modules/workload';
import { privilegeModule } from '../src/modules/privilege';
import { keysModule } from '../src/modules/keys';
import { auditModule } from '../src/modules/audit';
import { adminModule } from '../src/modules/admin';
import { systemModule } from '../src/modules/system';
import { config } from '../src/config';

export async function buildApp(): Promise<FastifyInstance> {
  mirrorConsoleToLogBuffer();

  const fastify = Fastify({
    logger: {
      // Mirror every warn and above into the ring buffer whatever the call site: a handler that logs
      // and answers 500 without throwing never reaches the onError hook.
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

  // Referenced by every route that can fail on the REST surface, so the shape is declared once.
  fastify.addSchema(PROBLEM_SCHEMA);

  await fastify.register(correlationPlugin);
  await fastify.register(corsPlugin);
  await fastify.register(swaggerPlugin);
  await fastify.register(mongodbPlugin);

  // Protected routes refuse with 503 rather than 401 when the datastore is gone, so an operator reads
  // "the directory is unreachable" instead of chasing a credentials problem that does not exist.
  fastify.addHook('preHandler', async (request, reply) => {
    const url = request.url;
    const isProbe = url === '/health' || url.startsWith('/api/v1/system/health');
    if (fastify.dbError !== null && !isProbe && !url.startsWith('/doc') && !url.startsWith('/admin/posture')) {
      return reply.status(503).send(problem(503, 'Service unavailable', fastify.dbError));
    }
  });

  // Errors keep the shape of the surface they occurred on: the specification's own on a standard
  // endpoint, RFC 9457 problem+json everywhere else. A house envelope on an OAuth endpoint is a defect.
  fastify.setErrorHandler((error, request, reply) => {
    const validation = (error as { validation?: Array<{ instancePath?: string; message?: string }> }).validation;
    const failure = error as { statusCode?: number; message?: string };
    const status = validation?.length ? 400 : failure.statusCode ?? 500;

    if (isOAuthSurface(request.url)) {
      return reply.status(status).send(oauthError(status, validation?.length
        ? validation.map((i) => `${i.instancePath || 'body'} ${i.message ?? 'is invalid'}`.trim()).join('; ')
        : failure.message));
    }

    if (validation?.length) {
      const detail = validation
        .map((issue) => `${issue.instancePath || 'body'} ${issue.message ?? 'is invalid'}`.trim())
        .join('; ');
      reply.header('Content-Type', 'application/problem+json; charset=utf-8');
      return reply.status(400).send(problem(400, 'Bad Request', detail));
    }

    reply.header('Content-Type', 'application/problem+json; charset=utf-8');
    // Never a stack and never an internal message on a 500: this service's internals are its secrets.
    return reply.status(status).send(status >= 500
      ? problem(500, 'Internal Server Error')
      : problem(status, failure.message ?? 'Request failed'));
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    appendLog(
      `[${new Date().toISOString()}] ${request.method} ${request.url} -> ${reply.statusCode}`
      + ` (${reply.elapsedTime.toFixed(0)}ms) [${request.correlationId}]`,
    );
    done();
  });

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
      operationId: 'getRoot',
      tags: ['system'],
      summary: 'Redirect to the API documentation',
      description: 'No applicable standard. Convenience redirect to /doc.',
      response: { 302: { description: 'Redirect to /doc', type: 'null' } },
    },
  }, async (_request, reply) => reply.redirect('/doc'));

  // Infra probes expect this exact path, alongside the module's fuller report.
  fastify.get('/health', {
    schema: {
      operationId: 'getHealth',
      tags: ['system'],
      summary: 'Health check (standard alias)',
      description: 'No applicable standard for the enclosing API; the body follows IETF health+json.',
      response: {
        200: { description: 'Serving.', type: 'object', additionalProperties: true },
        503: { description: 'Degraded.', type: 'object', additionalProperties: true },
      },
    },
  }, async (_request, reply) => {
    reply.header('Content-Type', 'application/health+json; charset=utf-8');
    const now = new Date().toISOString();
    if (fastify.dbError) {
      return reply.status(503).send({
        status: 'fail',
        serviceId: 'giam',
        checks: { 'mongodb:connectivity': [{ status: 'fail', componentType: 'datastore', output: fastify.dbError, time: now }] },
      });
    }
    try {
      const started = Date.now();
      await fastify.db.command({ ping: 1 });
      return reply.send({
        status: 'pass',
        serviceId: 'giam',
        checks: { 'mongodb:connectivity': [{ status: 'pass', componentType: 'datastore', observedValue: Date.now() - started, observedUnit: 'ms', time: now }] },
      });
    } catch (err) {
      return reply.status(503).send({
        status: 'fail',
        serviceId: 'giam',
        checks: { 'mongodb:connectivity': [{ status: 'fail', componentType: 'datastore', output: err instanceof Error ? err.message : 'ping failed', time: now }] },
      });
    }
  });

  // Protocol surfaces first: they are what a consumer integrates against.
  await fastify.register(oauthModule);
  await fastify.register(authenticationModule);
  await fastify.register(consentModule);
  await fastify.register(keysModule);
  await fastify.register(workloadModule);
  await fastify.register(provisioningModule);
  // Then the administrative ones.
  await fastify.register(realmModule);
  await fastify.register(directoryModule);
  await fastify.register(authorizationModule);
  await fastify.register(privilegeModule);
  await fastify.register(auditModule);
  await fastify.register(adminModule);
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

    const report = [
      ...configurationReport(),
      ...await readinessReport(app.dbError === null ? app.db : undefined, app.dbError),
    ];
    const separator = '.........................................................................';
    for (const line of [separator, 'giam is up', ...formatReport(report), separator]) {
      console.log(line);
      appendLog(`[${new Date().toISOString()}] STARTUP ${line.trim()}`);
    }
    if (app.dbError !== null) {
      console.warn(`[giam/mongodb] Running in degraded mode: ${app.dbError}`);
      console.warn('[giam/mongodb] Protected routes answer 503 until the database becomes reachable.');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

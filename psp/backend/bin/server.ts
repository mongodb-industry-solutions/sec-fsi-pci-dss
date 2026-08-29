import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (two levels up from backend/bin/).
dotenv.config({ path: resolve(__dirname, '../../../.env') });
import Fastify, { FastifyInstance } from 'fastify';
import { config } from '../src/config';
import { registerResourceServer } from '../src/vendors/setup/registerResourceServer';
import corsPlugin from '../src/plugins/cors';
import mongodbPlugin from '../src/plugins/mongodb';
import { swaggerPlugin } from '../src/plugins/swagger';
import { authMiddleware } from '../src/vendors/middleware/auth';
import { appendLog, appendLogEntry, levelLabel, mirrorConsoleToLogBuffer } from '../src/shared/services/logBuffer';
import { identityModule }     from '../src/modules/identity';
import { customerModule }     from '../src/modules/customer';
import { transactionsModule } from '../src/modules/transaction';
import { fraudModule }        from '../src/modules/fraud';
import { gatewayModule }      from '../src/modules/gateway';
import { systemModule }       from '../src/modules/system';
import { adminModule }        from '../src/modules/admin';
import { providersModule } from '../src/modules/provider';
import { fdsModule }       from '../src/providers/fds';
import { hrpModule }       from '../src/providers/hrp';
import { amlModule }       from '../src/providers/aml';
import { vopModule }       from '../src/providers/vop';
import { kycModule }       from '../src/providers/kyc';
import { kybModule }       from '../src/providers/kyb';
import { creditBureauModule }      from '../src/providers/credit-bureau';
import { cardIssuerModule }         from '../src/providers/card-issuer';
import { accountInformationModule } from '../src/providers/account-information';
import { notificationsModule } from '../src/modules/notification';

export async function buildApp(): Promise<FastifyInstance> {
  // Background subsystems report through console.*; mirror them before anything can log.
  mirrorConsoleToLogBuffer();

  const fastify = Fastify({
    logger: {
      // Mirror every warn/error/fatal into the admin ring buffer, whatever the call site
      // (fastify.log, request.log, plugin internals). A catch block that logs and answers 500
      // without throwing skips the onError hook, so the panel used to show a bare "-> 500".
      // One numeric comparison per log call; info/debug lines are untouched.
      hooks: {
        logMethod(args: unknown[], method: (...a: unknown[]) => void, level: number) {
          if (level >= 40) appendLogEntry(levelLabel(level), args);
          return method.apply(this, args);
        },
      },
    },
    pluginTimeout: 60000,
    ajv: {
      customOptions: {
        keywords: ['example'],
      },
    },
  });

  // Shared schemas registered on the root scope so all controllers can resolve
  // $ref references. Must come before any plugin or route registration.
  fastify.addSchema({ $id: 'Error', type: 'object', properties: { error: { type: 'string' } }, required: ['error'] });
  fastify.addSchema({ $id: 'MonetaryAmount', type: 'object', properties: { amount: { type: 'number' }, currency: { type: 'string' } }, required: ['amount', 'currency'] });
  fastify.addSchema({ $id: 'TransactionSnapshot', type: 'object', properties: { cardTransactionAmount: { $ref: 'MonetaryAmount#' }, cardTransactionMerchantName: { type: 'string' }, cardTransactionDateTime: { type: 'string', format: 'date-time' }, cardTransactionStatus: { type: 'string' }, cardTransactionMaskedPanDisplay: { type: 'string' } }, required: ['cardTransactionAmount', 'cardTransactionMerchantName', 'cardTransactionDateTime', 'cardTransactionStatus', 'cardTransactionMaskedPanDisplay'] });
  fastify.addSchema({ $id: 'FraudDiagnosisAssessment', type: 'object', properties: { riskIndicators: { type: 'array', items: { type: 'string' } }, fraudDiagnosisScore: { type: 'number' }, fraudDiagnosisConclusion: { type: 'string' } }, required: ['riskIndicators'] });

  // OAuth2/OIDC token, introspection and revocation endpoints receive
  // application/x-www-form-urlencoded bodies (RFC 6749). Fastify only parses JSON by
  // default, so without this parser those POSTs fail with 415. Parse into a plain object.
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  // Swagger must be registered before routes so schemas are captured in the spec
  await fastify.register(swaggerPlugin);

  await fastify.register(corsPlugin);

  // MongoDB plugin is fault-tolerant: if connection fails the server still starts.
  // fastify.dbError is set to a non-null string on failure (credentials stripped).
  await fastify.register(mongodbPlugin);

  // v39: nothing is initialised here for signing. This application holds no key: it verifies
  // tokens against the authority published key set and issues none of its own.

  // Auth: skip JWT check for public routes and Swagger UI
  fastify.addHook('preHandler', authMiddleware);

  // DB availability guard: return 503 for all /api/* routes when the DB is down.
  // Excludes health endpoints so they can report degraded status even when Atlas is unreachable.
  fastify.addHook('preHandler', async (_request, reply) => {
    const url = _request.url;
    const isHealthCheck = url === '/health' || url.startsWith('/api/v1/system/health');
    const isAdminRoute = url.startsWith('/api/v1/admin');
    if (fastify.dbError !== null && url.startsWith('/api/') && !isHealthCheck && !isAdminRoute) {
      return reply.status(503).send({
        error: 'Service unavailable',
        detail: fastify.dbError,
      });
    }
  });

  // Populate the admin log buffer with request/response summaries. The elapsed time is included
  // so a slow endpoint is investigable from the panel without extra tooling.
  fastify.addHook('onResponse', (request, reply, done) => {
    const line = `[${new Date().toISOString()}] ${request.method} ${request.url} -> ${reply.statusCode}`
      + ` (${reply.elapsedTime.toFixed(0)}ms)`;
    appendLog(line);
    done();
  });

  // Surface handler exceptions in the admin log panel. Without this, a thrown error (e.g. a
  // MongoCryptError on a QE read) only reached pino/stdout, so the panel showed just "-> 500"
  // with no cause. We mirror the error into the SAME ring buffer the panel streams.
  // PCI DSS Req 10 / GDPR: we log the error TYPE and a length-capped MESSAGE only (never the
  // full stack), since a stack can carry request PII; driver messages carry field/namespace
  // names, not plaintext values.
  fastify.addHook('onError', (request, reply, error, done) => {
    const status = (error as { statusCode?: number }).statusCode ?? reply.statusCode ?? 500;
    const name = error.name || 'Error';
    const message = (error.message || '').replace(/\s+/g, ' ').slice(0, 500);
    appendLog(
      `[${new Date().toISOString()}] ERROR ${request.method} ${request.url} -> ${status} `
      + `[${request.id}] ${name}: ${message}`,
    );
    done();
  });

  // Root redirect -> /doc
  fastify.get('/', {
    schema: {
      tags: ['system'],
      summary: 'Redirect to Swagger UI',
      description: 'Redirects to `/doc` (Swagger UI).',
      response: { 302: { type: 'null', description: 'Redirect to /doc' } },
    },
  }, async (_request, reply) => reply.redirect('/doc'));

  // Public /health alias, infra probes (k8s, Docker, LBs) expect this path.
  fastify.get('/health', {
    schema: {
      tags: ['system'],
      summary: 'Health check (standard alias)',
      description: 'Lightweight alias for `/api/v1/system/health` (no `detail`). **Public — no JWT required.** Returns IETF health+json with only the `mongodb:connectivity` check.',
      response: {
        200: { type: 'object', additionalProperties: true, description: 'Healthy (status=pass)' },
        503: { type: 'object', additionalProperties: true, description: 'Degraded (status=fail)' },
      },
    },
  }, async (_request, reply) => {
    const now = new Date().toISOString();
    reply.header('Content-Type', 'application/health+json; charset=utf-8');
    if (fastify.dbError) {
      return reply.status(503).send({
        status: 'fail',
        version: undefined,
        serviceId: 'fsi-pci-dss-backend',
        checks: { 'mongodb:connectivity': [{ status: 'fail', componentType: 'datastore', output: fastify.dbError, time: now }] },
      });
    }
    try {
      const t0 = Date.now();
      await fastify.db.command({ ping: 1 });
      return reply.send({
        status: 'pass',
        serviceId: 'fsi-pci-dss-backend',
        checks: { 'mongodb:connectivity': [{ status: 'pass', componentType: 'datastore', observedValue: Date.now() - t0, observedUnit: 'ms', time: now }] },
      });
    } catch (err) {
      return reply.status(503).send({
        status: 'fail',
        serviceId: 'fsi-pci-dss-backend',
        checks: { 'mongodb:connectivity': [{ status: 'fail', componentType: 'datastore', output: err instanceof Error ? err.message : 'ping failed', time: now }] },
      });
    }
  });

  // v39: discovery and the key set are served by the identity authority. A relying party that
  // published its own would be asserting it is an issuer, which it is not.

  // API routes  -  each module registers its own routes internally
  await fastify.register(identityModule,     { prefix: '/api/v1' });
  await fastify.register(customerModule,     { prefix: '/api/v1' });
  await fastify.register(transactionsModule, { prefix: '/api/v1' });
  await fastify.register(fraudModule,        { prefix: '/api/v1' });
  await fastify.register(gatewayModule,      { prefix: '/api/v1' });
  await fastify.register(systemModule,       { prefix: '/api/v1' });
  await fastify.register(adminModule,        { prefix: '/api/v1' });
  await fastify.register(providersModule, { prefix: '/api/v1' });
  // Capability modules (internal engines, ADR-029)
  await fastify.register(fdsModule,          { prefix: '/api/v1' });
  await fastify.register(hrpModule,          { prefix: '/api/v1' });
  await fastify.register(amlModule,          { prefix: '/api/v1' });
  await fastify.register(vopModule,          { prefix: '/api/v1' });
  await fastify.register(kycModule,          { prefix: '/api/v1' });
  await fastify.register(kybModule,          { prefix: '/api/v1' });
  await fastify.register(creditBureauModule, { prefix: '/api/v1' });
  await fastify.register(cardIssuerModule,         { prefix: '/api/v1' });
  await fastify.register(accountInformationModule, { prefix: '/api/v1' });
  // Internal Module without a Provider counterpart (ADR-029).
  // v39 P6.4: the authentication-domain administration surface moved to the identity authority,
  // where those records now live. Nothing here can administer a realm it does not own.
  // Customer notifications (pending fraud-investigation questions to answer).
  await fastify.register(notificationsModule, { prefix: '/api/v1' });

  return fastify;
}

// Process-level safety net: async errors thrown outside a request (event-bus reactors, sagas,
// timers, SSE streams) never hit the Fastify onError hook, so they used to vanish from the admin
// panel. Mirror them into the SAME ring buffer. PCI DSS Req 10 / GDPR: type + capped message only.
function installProcessErrorHooks(): void {
  const record = (kind: string, err: unknown) => {
    const e = err as { name?: string; message?: string };
    const name = e?.name || (typeof err === 'string' ? 'Error' : typeof err);
    const message = String(e?.message ?? err).replace(/\s+/g, ' ').slice(0, 500);
    appendLog(`[${new Date().toISOString()}] PROCESS ${kind}: ${name}: ${message}`);
  };
  process.on('unhandledRejection', (reason) => record('unhandledRejection', reason));
  process.on('warning', (w) => record('warning', w));
  process.on('uncaughtException', (err) => {
    record('uncaughtException', err);
    // Preserve Node's default crash semantics: state is undefined after an uncaught throw, so let
    // the pod restart cleanly (k8s) rather than continue in a corrupted state.
    console.error(err);
    process.exit(1);
  });
}

async function start() {
  installProcessErrorHooks();
  const app = await buildApp();
  const port = parseInt(process.env.PORT ?? '8081', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`.........................................................................`);
    console.log(`Backend listening on http://${host}:${port}`);
    console.log(`Swagger UI: http://${host}:${port}/doc`);
    if (app.dbError !== null) {
      console.warn(`[mongodb] Running in degraded mode: ${app.dbError}`);
      console.warn('[mongodb] API routes will return 503 until the database becomes reachable.');
    }
    // v39 P6.3: register this application enforcement points with the identity authority.
    //
    // After listening, and non-fatal. The catalog is what the authority grants FROM; failing to
    // register it does not stop this application serving requests carrying already-valid tokens,
    // because those verify against a cached key set and need the authority for nothing.
    const registration = await registerResourceServer();
    console.log(registration.registered
      ? `  permission catalog registered with ${config.giam.issuerUrl}`
      : `  ! permission catalog NOT registered: ${registration.reason}`);
    console.log(`.........................................................................`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

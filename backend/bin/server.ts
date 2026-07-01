import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from project root (two levels up from backend/bin/).
dotenv.config({ path: resolve(__dirname, '../../.env') });
import Fastify, { FastifyInstance } from 'fastify';
import corsPlugin from '../src/plugins/cors';
import mongodbPlugin from '../src/plugins/mongodb';
import { swaggerPlugin } from '../src/plugins/swagger';
import { authMiddleware } from '../src/vendors/middleware/auth';
import { appendLog }          from '../src/shared/services/logBuffer';
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
import { kycModule }       from '../src/providers/kyc';
import { kybModule }       from '../src/providers/kyb';
import { creditBureauModule }      from '../src/providers/credit-bureau';
import { cardAuthorizationModule }  from '../src/providers/card-authorization';
import { cardIssuerModule }         from '../src/providers/card-issuer';
import { accountInformationModule } from '../src/providers/account-information';
import { paymentInitiationModule }  from '../src/providers/payment-initiation';
import { domainModule }       from '../src/modules/domain';
import { notificationsModule } from '../src/modules/notification';
import { oidcDiscoveryController } from '../src/modules/identity/controllers/oidcDiscovery.controller';
import { initOidcKeys } from '../src/modules/identity/services/oidcKeys.service';
import { merchantPortalController } from '../src/modules/gateway/controllers/merchantPortal.controller';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: true,
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

  // Swagger must be registered before routes so schemas are captured in the spec
  await fastify.register(swaggerPlugin);

  await fastify.register(corsPlugin);

  // MongoDB plugin is fault-tolerant: if connection fails the server still starts.
  // fastify.dbError is set to a non-null string on failure (credentials stripped).
  await fastify.register(mongodbPlugin);

  // v16: initialise OAuth key provider after DB is connected (registers public key in Atlas)
  fastify.addHook('onReady', async () => {
    if (!fastify.dbError && fastify.db) {
      try {
        await initOidcKeys(fastify.db);
      } catch (err) {
        fastify.log.warn({ err }, '[oauth-keys] Key init failed — OIDC endpoints unavailable until fixed');
      }
    }
  });

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

  // Populate the admin log buffer with request/response summaries
  fastify.addHook('onResponse', (request, reply, done) => {
    const line = `[${new Date().toISOString()}] ${request.method} ${request.url} -> ${reply.statusCode}`;
    appendLog(line);
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

  // v16: OIDC Discovery at root (/.well-known/openid-configuration) + JWKS (/api/v1/auth/jwks)
  // These MUST be registered at root level — oidcDiscovery handles both paths internally.
  await fastify.register(oidcDiscoveryController);

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
  await fastify.register(kycModule,          { prefix: '/api/v1' });
  await fastify.register(kybModule,          { prefix: '/api/v1' });
  await fastify.register(creditBureauModule, { prefix: '/api/v1' });
  await fastify.register(cardAuthorizationModule,  { prefix: '/api/v1' });
  await fastify.register(cardIssuerModule,         { prefix: '/api/v1' });
  await fastify.register(accountInformationModule, { prefix: '/api/v1' });
  await fastify.register(paymentInitiationModule,  { prefix: '/api/v1' });
  // Internal Module without a Provider counterpart (ADR-029).
  await fastify.register(domainModule,  { prefix: '/api/v1' });
  // Customer notifications (pending fraud-investigation questions to answer).
  await fastify.register(notificationsModule, { prefix: '/api/v1' });
  // v16: Merchant Portal — OAuth-authenticated programmatic access (ADR-037)
  await fastify.register(merchantPortalController, { prefix: '/api/v1/merchant/portal' });

  return fastify;
}

async function start() {
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
    console.log(`.........................................................................`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

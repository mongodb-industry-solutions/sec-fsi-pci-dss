import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { getQEClient } from '../vendors/encryption/qeClient';
import { config } from '../config';

declare module 'fastify' {
  interface FastifyInstance {
    // Always typed as Db; use fastify.dbError to check connection health.
    // A preHandler guard in server.ts prevents API routes from executing when null.
    db: Db;
    // null = connected; non-null string = error reason (credentials stripped)
    dbError: string | null;
  }
}

function sanitizeUri(uri: string): { server: string; database: string } {
  const dbName = config.mongodb.dbName ?? 'unknown';
  try {
    // Strip username:password before parsing; never log credentials
    const clean = uri.replace(/^(mongodb(?:\+srv)?:\/\/)([^@]+@)/, '$1');
    const parsed = new URL(clean);
    return {
      server: parsed.hostname || 'unknown',
      database: dbName || parsed.pathname.replace(/^\//, '') || 'unknown',
    };
  } catch {
    return { server: 'unknown', database: dbName };
  }
}

// Timers created by the runtime wiring, tracked so they can be cleared on shutdown OR hot reload
// (otherwise a reload would leak duplicate intervals).
let activeTimers: NodeJS.Timeout[] = [];

/**
 * Connect the QE (Level 2) client, publish it as fastify.db, and wire the full event-driven
 * runtime (bus + projections + sagas + retention sweeps + schedulers) against that connection.
 *
 * Extracted so both first-time startup and the hot-reload path (/admin/reload) run identical
 * wiring — the reload rebuilds the QE client so a fresh key-vault/DEK set is picked up after a
 * drop + setup + seed, WITHOUT restarting the process.
 */
async function connectAndWire(fastify: FastifyInstance): Promise<void> {
  const client = await getQEClient();
  const db = client.db(config.mongodb.dbName);

  fastify.db = db;
  fastify.dbError = null;

  // dev.v8: EventBus vendor (in-process adapter + Mongo event store). initEventBus creates a fresh
  // instance; getEventBus() returns the latest — so a reload swaps to a clean bus + subscribers.
  const { initEventBus, getEventBus } = await import('../vendors/eventbus');
  await initEventBus(db).start();

  // dev.v8 P6 (§9.2): audit ledger PROJECTION. Register BEFORE any publisher so no event is missed.
  const { LedgerProjection } = await import('../modules/provider/services/businessProcessEvent.service');
  new LedgerProjection(db, getEventBus()).register();

  // Provider Group reactors: perform the actual provider call on each *.requested.
  const { ProviderGroups } = await import('../providers/groups/providerGroups');
  new ProviderGroups(db, getEventBus()).register();

  // dev.v8 F3/F4: event-driven payment-authorization saga (issuer + FDS + sanctions gate).
  const { PaymentAuthorizationSaga } = await import('../modules/transaction/services/paymentAuthorization.saga');
  new PaymentAuthorizationSaga(db, getEventBus()).register();

  // dev.v8 F5: post-authorization process (AML monitoring + investigation-case enrichment).
  const { PostAuthorizationProcess } = await import('../modules/transaction/services/postAuthorization.process');
  new PostAuthorizationProcess(db, getEventBus()).register();

  // v17: payout orchestration (merchant settlement, SD-65/SD-66/SD-36).
  const { PayoutOrchestrationProcess } = await import('../modules/gateway/services/payoutOrchestration.process');
  new PayoutOrchestrationProcess(db, getEventBus()).register();

  // P2P compliance: FDS + HRP + AML screening for peer-to-peer transfers (SD-83, PCI DSS Req 10).
  const { P2PComplianceProcess } = await import('../modules/gateway/services/p2pCompliance.process');
  new P2PComplianceProcess(db, getEventBus()).register();

  // dev.v8 P5 (§7.7): periodic sweep of lapsed pending-correlation entries.
  const { sweepExpiredCorrelations } = await import('../modules/provider/services/pendingCorrelation.service');
  const sweepTimer = setInterval(() => { sweepExpiredCorrelations(); }, 5 * 60 * 1000);
  sweepTimer.unref();
  activeTimers.push(sweepTimer);

  // dev.v8 P7 (§8): purge the encrypted `chd` carrier when a journey closes + periodic safety sweep.
  const { ChdRetention, sweepAbandonedChd } = await import('../modules/transaction/services/chdRetention.service');
  new ChdRetention(db, getEventBus()).register();
  const chdSweepTimer = setInterval(() => { sweepAbandonedChd(db).catch(() => {}); }, 5 * 60 * 1000);
  chdSweepTimer.unref();
  activeTimers.push(chdSweepTimer);

  // v17.1: recurring-mandate scheduler (config-gated). Each run reuses executeBankTransfer.
  const { config: appConfig } = await import('../config');
  if (appConfig.payout.mandateSchedulerMs > 0) {
    const { runDueMandates } = await import('../modules/gateway/services/recurringMandate.service');
    const mandateTimer = setInterval(() => { runDueMandates(db).catch(() => {}); }, appConfig.payout.mandateSchedulerMs);
    mandateTimer.unref();
    activeTimers.push(mandateTimer);
  }
}

/**
 * Tear down the event-driven runtime (timers + bus + QE client) so it can be rebuilt cleanly.
 * Used by graceful shutdown and by the hot-reload path.
 */
async function teardownRuntime(): Promise<void> {
  for (const t of activeTimers) clearInterval(t);
  activeTimers = [];
  try {
    const { getEventBus } = await import('../vendors/eventbus');
    await getEventBus().stop().catch(() => {});
  } catch { /* bus not initialised */ }
  const { closeQEClient } = await import('../vendors/encryption/qeClient');
  await closeQEClient();
}

/**
 * Hot-reload the DB runtime WITHOUT restarting the process:
 *   1. reload .env (override) so runtime-read env vars refresh,
 *   2. tear down timers + bus + the cached QE client,
 *   3. reconnect + re-wire everything against a fresh QE client.
 *
 * This rebuilds the Queryable Encryption client, so after a drop + setup:db + seed the new
 * key-vault/DEK set is picked up (fixes "not all keys requested were satisfied" without a restart).
 * Cross-platform: pure Node, no OS-specific calls.
 */
export async function reloadDbRuntime(fastify: FastifyInstance): Promise<{ steps: string[] }> {
  const steps: string[] = [];
  const started = Date.now();

  // 1. Reload env from the repo-root .env (override so edited values take effect for anything read
  //    from process.env at use-time). A MISSING .env is NOT an error: the process may run purely on
  //    injected environment variables (containers/k8s), so we log it and continue.
  const envPath = resolve(__dirname, '../../.env');
  const envResult = dotenv.config({ path: envPath, override: true });
  if (envResult.error) {
    steps.push(`.env not found at ${envPath} — continuing with current process environment (non-blocking)`);
  } else {
    steps.push(`.env reloaded (${Object.keys(envResult.parsed ?? {}).length} vars) from ${envPath}`);
  }

  // 2. Tear down + rebuild the QE client and event-driven runtime.
  await teardownRuntime();
  steps.push('torn down: schedulers/sweeps, event bus, cached QE client');
  await connectAndWire(fastify);
  steps.push(`QE client + event bus re-wired against db "${config.mongodb.dbName}"`);

  // 3. Report the key vault the rebuilt client is bound to + how many DEKs it holds (best effort).
  try {
    const { getKmsConfig } = await import('../vendors/encryption/kms');
    const { getQEClient } = await import('../vendors/encryption/qeClient');
    const kms = getKmsConfig();
    const dekCount = await getQEClient().then((c) => c.db(kms.database).collection(kms.collection).countDocuments());
    steps.push(`key vault ${kms.namespace}: ${dekCount} DEK(s) available`);
  } catch (err) {
    steps.push(`key vault check skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  steps.push(`reload complete in ${Date.now() - started}ms`);
  return { steps };
}

async function mongodbPlugin(fastify: FastifyInstance) {
  // Decorators must be registered synchronously before any async work.
  fastify.decorate('db', null as unknown as Db);
  fastify.decorate('dbError', null as string | null);

  if (!config.mongodb.uri) {
    const msg = 'MONGODB_URI is not set; server starting in degraded mode';
    console.error(`[mongodb] ${msg}`);
    fastify.dbError = msg;
    return;
  }

  try {
    await connectAndWire(fastify);

    fastify.addHook('onClose', async () => {
      await teardownRuntime();
    });
  } catch (err) {
    const { server, database } = sanitizeUri(config.mongodb.uri);
    const reason = err instanceof Error ? err.message : String(err);

    console.error(`[mongodb] Connection failed: server=${server} database=${database}. ${reason}`);
    // Surface the underlying reason, not just "Connection failed". A wrong/invalid
    // MONGODB_CRYPT_SHARED_LIB_PATH makes the QE-enabled client fail to initialize and manifests here
    // as a connection failure — without the reason it looks like a network/Atlas problem and is
    // misdiagnosed. The reason is a driver/crypt_shared message (no credentials; the URI is sanitized).
    fastify.dbError = `Connection failed: server=${server} database=${database}. ${reason}`;
    // Server continues to start; Swagger UI and /health remain accessible.
  }
}

export default fp(mongodbPlugin, { name: 'mongodb' });

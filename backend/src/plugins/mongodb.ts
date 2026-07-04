import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';
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

async function mongodbPlugin(fastify: FastifyInstance) {
  // Decorators must be registered synchronously before any async work.
  // Cast null to Db so callers don't need type guards; the 503 guard in
  // server.ts prevents route handlers from executing when the DB is down.
  fastify.decorate('db', null as unknown as Db);
  fastify.decorate('dbError', null as string | null);

  if (!config.mongodb.uri) {
    const msg = 'MONGODB_URI is not set; server starting in degraded mode';
    console.error(`[mongodb] ${msg}`);
    fastify.dbError = msg;
    return;
  }

  try {
    const client = await getQEClient();
    const db = client.db(config.mongodb.dbName);

    // Reassign decorated properties now that we have a live connection
    fastify.db = db;
    fastify.dbError = null;

    // dev.v8: initialize the EventBus vendor (in-process adapter + Mongo event store) now that the
    // DB is live. The rest of the system depends only on getEventBus(); swapping to a broker adapter
    // is a one-line change here. Initialized but inert until publishers/subscribers are wired (F2+).
    const { initEventBus, getEventBus } = await import('../vendors/eventbus');
    await initEventBus(db).start();

    // dev.v8 P6 (§9.2): the audit ledger is a PROJECTION. Register the bus subscriber that writes
    // businessProcessEvent/complianceProcessEvent from published domain events BEFORE any publisher,
    // so no ledger event is missed.
    const { LedgerProjection } = await import('../modules/provider/services/businessProcessEvent.service');
    new LedgerProjection(db, getEventBus()).register();

    // Provider Group reactors: subscribe to each payment gate's *.requested and perform the actual
    // provider call, publishing *.completed. Registered before any publisher so no request is missed.
    const { ProviderGroups } = await import('../providers/groups/providerGroups');
    new ProviderGroups(db, getEventBus()).register();

    // dev.v8 F3/F4: register the event-driven payment-authorization saga (issuer + FDS + sanctions gate).
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

    // dev.v8 P5 (§7.7): periodic sweep of lapsed pending-correlation entries (abandoned async
    // callbacks). In-memory registry; the sweep keeps it bounded.
    const { sweepExpiredCorrelations } = await import('../modules/provider/services/pendingCorrelation.service');
    const sweepTimer = setInterval(() => { sweepExpiredCorrelations(); }, 5 * 60 * 1000);
    sweepTimer.unref();

    // dev.v8 P7 (§8): purge the encrypted `chd` carrier when a payment journey closes, plus a periodic
    // safety sweep for abandoned journeys so SAD/CVV is never retained after authorization (PCI Req 3.2).
    const { ChdRetention, sweepAbandonedChd } = await import('../modules/transaction/services/chdRetention.service');
    new ChdRetention(db, getEventBus()).register();
    const chdSweepTimer = setInterval(() => { sweepAbandonedChd(db).catch(() => {}); }, 5 * 60 * 1000);
    chdSweepTimer.unref();

    // v17.1: recurring-mandate scheduler — periodically run due ACH SDD / SEPA SDD collections.
    // Config-gated (PAYOUT_MANDATE_SCHEDULER_MS=0 disables). Each run reuses executeBankTransfer.
    const { config: appConfig } = await import('../config');
    let mandateTimer: NodeJS.Timeout | undefined;
    if (appConfig.payout.mandateSchedulerMs > 0) {
      const { runDueMandates } = await import('../modules/gateway/services/recurringMandate.service');
      mandateTimer = setInterval(() => { runDueMandates(db).catch(() => {}); }, appConfig.payout.mandateSchedulerMs);
      mandateTimer.unref();
    }

    fastify.addHook('onClose', async () => {
      clearInterval(sweepTimer);
      clearInterval(chdSweepTimer);
      if (mandateTimer) clearInterval(mandateTimer);
      await getEventBus().stop().catch(() => {}); // drains/disconnects the broker engine cleanly
      const { closeQEClient } = await import('../vendors/encryption/qeClient');
      await closeQEClient();
    });
  } catch (err) {
    const { server, database } = sanitizeUri(config.mongodb.uri);
    const reason = err instanceof Error ? err.message : String(err);

    console.error(`[mongodb] Connection failed: server=${server} database=${database}. ${reason}`);
    fastify.dbError = `Connection failed: server=${server} database=${database}`;
    // Server continues to start; Swagger UI and /health remain accessible.
  }
}

export default fp(mongodbPlugin, { name: 'mongodb' });

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';
import { getQEClient } from '../vendors/encryption/qeClient';

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
  const dbName = process.env.MONGODB_DB_NAME ?? 'unknown';
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

  if (!process.env.MONGODB_URI) {
    const msg = 'MONGODB_URI is not set; server starting in degraded mode';
    console.error(`[mongodb] ${msg}`);
    fastify.dbError = msg;
    return;
  }

  try {
    const client = await getQEClient();
    const db = client.db(process.env.MONGODB_DB_NAME!);

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
    const { ProviderGroups } = await import('../providers/_groups/providerGroups');
    new ProviderGroups(db, getEventBus()).register();

    // dev.v8 F3/F4: register the event-driven payment-authorization saga (issuer + FDS + sanctions gate).
    const { PaymentAuthorizationSaga } = await import('../modules/transaction/services/paymentAuthorization.saga');
    new PaymentAuthorizationSaga(db, getEventBus()).register();

    // dev.v8 F5: post-authorization process (AML monitoring + investigation-case enrichment).
    const { PostAuthorizationProcess } = await import('../modules/transaction/services/postAuthorization.process');
    new PostAuthorizationProcess(db, getEventBus()).register();

    // dev.v8 P5 (§7.7): periodic sweep of lapsed pending-correlation entries (abandoned async
    // callbacks). In-memory registry; the sweep keeps it bounded.
    const { sweepExpiredCorrelations } = await import('../modules/provider/services/pendingCorrelation.service');
    const sweepTimer = setInterval(() => sweepExpiredCorrelations(), 5 * 60 * 1000);
    sweepTimer.unref();

    // dev.v8 P7 (§8): purge the encrypted `chd` carrier when a payment journey closes, plus a periodic
    // safety sweep for abandoned journeys so SAD/CVV is never retained after authorization (PCI Req 3.2).
    const { ChdRetention, sweepAbandonedChd } = await import('../modules/transaction/services/chdRetention.service');
    new ChdRetention(db, getEventBus()).register();
    const chdSweepTimer = setInterval(() => { void sweepAbandonedChd(db); }, 5 * 60 * 1000);
    chdSweepTimer.unref();

    fastify.addHook('onClose', async () => {
      clearInterval(sweepTimer);
      clearInterval(chdSweepTimer);
      await getEventBus().stop().catch(() => {}); // drains/disconnects the broker engine cleanly
      const { closeQEClient } = await import('../vendors/encryption/qeClient');
      await closeQEClient();
    });
  } catch (err) {
    const { server, database } = sanitizeUri(process.env.MONGODB_URI);
    const reason = err instanceof Error ? err.message : String(err);

    console.error(`[mongodb] Connection failed: server=${server} database=${database}. ${reason}`);
    fastify.dbError = `Connection failed: server=${server} database=${database}`;
    // Server continues to start; Swagger UI and /health remain accessible.
  }
}

export default fp(mongodbPlugin, { name: 'mongodb' });

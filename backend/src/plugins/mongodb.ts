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
    const { initEventBus } = await import('../vendors/eventbus');
    await initEventBus(db).start();

    fastify.addHook('onClose', async () => {
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

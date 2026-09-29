import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';
import { getQEClient, closeQEClient } from '../vendors/encryption/qeClient';
import { initEventBus, getEventBus } from '../vendors/eventbus';
import { config } from '../config';

declare module 'fastify' {
  interface FastifyInstance {
    // Always typed as Db; check fastify.dbError for connection health.
    db: Db;
    // null = connected; non-null string = reason, credentials stripped.
    dbError: string | null;
  }
}

// Never log credentials: the reason is echoed in the health response.
function sanitizeUri(uri: string): { server: string; database: string } {
  try {
    const clean = uri.replace(/^(mongodb(?:\+srv)?:\/\/)([^@]+@)/, '$1');
    return { server: new URL(clean).hostname || 'unknown', database: config.mongodb.dbName };
  } catch {
    return { server: 'unknown', database: config.mongodb.dbName };
  }
}

async function connectAndWire(fastify: FastifyInstance): Promise<void> {
  const client = await getQEClient();
  const db = client.db(config.mongodb.dbName);
  fastify.db = db;
  fastify.dbError = null;

  // Own bus instance against its own database, from the package the PSP also uses. The two buses
  // never see each other, which is why the boundary between the services is a webhook.
  await initEventBus(db).start();
}

async function teardownRuntime(): Promise<void> {
  try {
    await getEventBus().stop().catch(() => {});
  } catch { /* bus not initialised */ }
  await closeQEClient();
}

async function mongodbPlugin(fastify: FastifyInstance) {
  fastify.decorate('db', null as unknown as Db);
  fastify.decorate('dbError', null as string | null);

  if (!config.mongodb.uri) {
    const msg = 'PSP_BANKCORE_DB_URI / MONGODB_URI is not set; bankcore starting in degraded mode';
    console.error(`[bankcore/mongodb] ${msg}`);
    fastify.dbError = msg;
    return;
  }

  try {
    await connectAndWire(fastify);
    fastify.addHook('onClose', teardownRuntime);
  } catch (err) {
    const { server, database } = sanitizeUri(config.mongodb.uri);
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[bankcore/mongodb] Connection failed: server=${server} database=${database}. ${reason}`);
    const base = `Connection failed: server=${server} database=${database}`;
    // The health response is readable by the PSP, so keep production generic.
    fastify.dbError = config.nodeEnv === 'production' ? base : `${base}. ${reason}`;
  }
}

export default fp(mongodbPlugin, { name: 'mongodb' });

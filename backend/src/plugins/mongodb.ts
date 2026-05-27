import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Db } from 'mongodb';
import { getQEClient } from '../vendors/encryption/qeClient';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

async function mongodbPlugin(fastify: FastifyInstance) {
  const client = await getQEClient();
  const db = client.db(process.env.MONGODB_DB_NAME!);

  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    const { closeQEClient } = await import('../vendors/encryption/qeClient');
    await closeQEClient();
  });
}

export default fp(mongodbPlugin, { name: 'mongodb' });

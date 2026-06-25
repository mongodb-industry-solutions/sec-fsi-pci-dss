import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { FastifyInstance } from 'fastify';

function buildOrigin(): string | string[] | boolean {
  const env = process.env.CORS_ORIGIN;

  if (!env || env === '*') return true;

  const origins = env.split(',').map((o) => o.trim());
  if (origins.length === 1) return origins[0];
  return origins;
}

async function corsPlugin(fastify: FastifyInstance) {
  await fastify.register(cors, {
    origin: buildOrigin(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Role', 'X-Escalation-Token'],
    credentials: true,
  });
}

export default fp(corsPlugin, { name: 'cors' });

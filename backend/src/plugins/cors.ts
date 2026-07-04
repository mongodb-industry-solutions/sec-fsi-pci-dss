import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { FastifyInstance } from 'fastify';
import { config } from '../config';

function buildOrigin(): string | string[] | boolean {
  const env = config.server.corsOrigin;

  if (!env || env === '*') return true;

  const origins = env.split(',').map((o) => o.trim()).filter(Boolean);

  // Always allow requests from the API's own origin (Swagger UI is co-hosted)
  const port = String(config.server.port);
  const self = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  for (const s of self) {
    if (!origins.includes(s)) origins.push(s);
  }

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

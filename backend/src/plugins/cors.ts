import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { FastifyInstance } from 'fastify';

async function corsPlugin(fastify: FastifyInstance) {
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Demo-Role'],
    credentials: true,
  });
}

export default fp(corsPlugin, { name: 'cors' });

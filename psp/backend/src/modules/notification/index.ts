import { FastifyInstance } from 'fastify';
import { notificationsController } from './controllers/notifications.controller';

// Customer-facing notifications (pending actions such as fraud-investigation questions to answer).
export async function notificationsModule(fastify: FastifyInstance) {
  await fastify.register(notificationsController, { prefix: '/notifications' });
}

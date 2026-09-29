import { FastifyInstance } from 'fastify';
import { fraudDiagnosisController } from './controllers/fraudDiagnosis.controller';

export async function fraudModule(fastify: FastifyInstance) {
  await fastify.register(fraudDiagnosisController, { prefix: '/fraud' });
}

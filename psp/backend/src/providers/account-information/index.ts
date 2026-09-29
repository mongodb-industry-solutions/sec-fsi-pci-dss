import { FastifyInstance } from 'fastify';
import { accountInformationController } from './controllers/accountInformation.controller';

export async function accountInformationModule(fastify: FastifyInstance) {
  await fastify.register(accountInformationController, { prefix: '/modules/account-information' });
}

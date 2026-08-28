import { FastifyInstance } from 'fastify';

// The principal store: identities of every kind, their credentials, and the agent, tool, MCP server
// and tenant registries. A human and a workload are the same kind of record here on purpose.
export async function directoryModule(_fastify: FastifyInstance) {
  // Routes arrive with the module's own phase.
}

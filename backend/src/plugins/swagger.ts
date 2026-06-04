import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

// fp() removes encapsulation so @fastify/swagger's onRoute hook
// captures routes registered in the root scope.
export const swaggerPlugin = fp(async function (fastify: FastifyInstance) {
  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'FSI PCI DSS Payment Security Demo API',
        version: '1.0.0',
        description: `
## Overview

REST API for the **LeafyBank FSI PCI DSS Payment Security Demo**. It demonstrates how
[MongoDB Queryable Encryption (QE)](https://www.mongodb.com/docs/manual/core/queryable-encryption/)
enables a PCI DSS-aligned fraud investigation workflow for digital banks and card issuers:
encrypted sensitive fields are searchable client-side without the plaintext ever reaching
the database server.

## Data model: BIAN Service Domains

All collections map to [BIAN (Banking Industry Architecture Network)](https://bian.org/)
Service Domains. Field names follow the BIAN compound naming convention
\`<ControlRecord><Qualifier><AttributeType>\` (e.g. \`cardTransactionAccountReference\`).

| BIAN Service Domain | SD # | Collection | QE |
|---|---|---|---|
| Party Authentication | SD-16 | \`partyAuthentication\` | Yes |
| Customer Agreement | SD-53 | \`customerAgreement\` | Yes |
| Payment Card | SD-88 | \`paymentCard\` | Yes |
| Card Transaction | SD-254 | \`cardTransaction\` | Yes |
| Fraud Diagnosis | SD-83 | \`fraudDiagnosisCase\` | No |

## Authentication

All routes except \`POST /api/v1/auth/login\` and \`GET /health\` require a
**Bearer JWT** in the \`Authorization\` header:

\`\`\`
Authorization: Bearer <token>
\`\`\`

Obtain a token via \`POST /api/v1/auth/login\`.

## Role-based access

| Role | Read QE:equality | Read QE:none (sensitive) | Open fraud cases |
|---|---|---|---|
| \`customer\` | Own records only | No | No |
| \`level1_analyst\` | Yes | No | Yes |
| \`level2_investigator\` | Yes | Yes | Yes |
| \`security_auditor\` | Read-only | Read-only | No |

## Encryption tiers

- **QE:equality**: encrypted client-side, searchable by exact match (email, phone, account ref).
- **QE:none**: encrypted client-side, not searchable; returned only with the correct DEK
  (Data Encryption Key). Requires \`level2_investigator\` role.
        `.trim(),
        contact: {
          name: 'LeafyBank IST Demo Team',
          email: 'antonio.membrides@mongodb.com',
        },
        license: {
          name: 'MIT',
        },
      },
      servers: [
        {
          url: 'http://localhost:3001',
          description: 'Local development',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT token obtained from POST /api/v1/auth/login',
          },
          adminAuth: {
            type: 'http',
            scheme: 'basic',
            description: 'Admin credentials. Use username and password from ADM_USER / ADM_PASS env vars (dev default: admin / admin).',
          },
        },
        // Shared schemas (Error, MonetaryAmount, TransactionSnapshot,
        // FraudDiagnosisAssessment) are registered via fastify.addSchema()
        // above. @fastify/swagger includes them here automatically.
      },
      tags: [
        { name: 'auth',         description: 'module:identity · SD-16 Party Authentication. /api/v1/auth. Public routes, no JWT required.' },
        { name: 'customer',     description: 'module:customer · SD-53 Customer Agreement. /api/v1/customer. QE:equality search on email, phone, account reference.' },
        { name: 'cards',        description: 'module:customer · SD-88 Payment Card. /api/v1/customer/:customerId/cards. Cards as sub-resource of Customer Agreement.' },
        { name: 'transactions', description: 'module:transactions · SD-254 Card Transaction. /api/v1/transactions. QE:equality on account reference. Auto-triggers fraud case.' },
        { name: 'fraud',        description: 'module:fraud · SD-83 Fraud Diagnosis. /api/v1/fraud. Investigation lifecycle: open > under_review > escalated > resolved > closed.' },
        { name: 'merchants',    description: 'module:gateway · SD-89 Merchant Relations. /api/v1/merchants. Merchant onboarding, configuration, and webhook registration. Prototype (v5 roadmap).' },
        { name: 'gateway',      description: 'module:gateway · SD-64 Payment Order · SD-65 Payment Execution · SD-57 Card Token. /api/v1/gateway/payments · /api/v1/gateway/tokens. Prototype (v5 roadmap).' },
        { name: 'system',       description: 'module:system · /api/v1/system. Health check (public) + raw document viewer (non-production, JWT required).' },
        { name: 'admin',        description: 'module:admin · /api/v1/admin. Administration panel: setup commands, terminal, log streaming, system info. Login via POST /admin/login.' },
      ],
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/doc',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
    uiHooks: {
      onRequest: (_request, _reply, done) => done(),
      preHandler: (_request, _reply, done) => done(),
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
    transformSpecification: (spec) => spec,
    transformSpecificationClone: true,
  });
});

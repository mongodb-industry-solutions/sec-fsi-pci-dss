import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { join } from 'path';
import { config } from '../config';

// PSP_PROJECT_ROOT=/app is set in Docker (compiled: dist/plugins → wrong relative path).
// Local dev: PSP_PROJECT_ROOT is unset, __dirname is src/plugins so ../../public is correct.
const PUBLIC = config.server.projectRoot
  ? join(config.server.projectRoot, 'backend/public')
  : join(__dirname, '../../public');

// fp() removes encapsulation so @fastify/swagger's onRoute hook
// captures routes registered in the root scope.
export const swaggerPlugin = fp(async function (fastify: FastifyInstance) {
  // Serve backend/public/ at /public/ (auth whitelist includes /public).
  await fastify.register(fastifyStatic, { root: PUBLIC, prefix: '/public/' });

  // Rewrite the /doc/ HTML response to inject the app favicon in <head>.
  // Replaces swagger's default icon links before the browser parses them,
  // so the tab icon updates reliably without any JavaScript dependency.
  fastify.addHook('onSend', async function (request, reply, payload) {
    const ct = reply.getHeader('content-type') as string | undefined;
    if (typeof payload === 'string' && ct?.includes('text/html') && request.url.startsWith('/doc')) {
      const patched = payload
        .replace(/<link rel="icon"[^>]*>/g, '')
        .replace('</head>',
          '<link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32x32.png?v=1" />\n' +
          '<link rel="icon" type="image/png" sizes="16x16" href="/public/favicon-16x16.png?v=1" />\n' +
          '</head>'
        );
      reply.header('content-length', Buffer.byteLength(patched));
      return patched;
    }
    return payload;
  });

  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Leafy Pay (PSP Platform API)',
        version: '1.0.0',
        description: `
## Overview

REST API for the **Leafy Pay** (PSP Platform Demo). It demonstrates how
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
          name: 'MongoDB IST Cybersecurity & Integration Team',
          email: 'antonio.membrides@mongodb.com',
        },
        license: {
          name: 'MIT',
        },
      },
      servers: [
        {
          url: '/',
          description: 'Current server (relative)',
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
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Admin JWT obtained from POST /api/v1/admin/login. Provide as Bearer token.',
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
        { name: 'merchants',    description: 'module:psp-platform · SD-89 Merchant Relations. /api/v1/merchants. Merchant onboarding, configuration, and webhook registration. Prototype (v5 roadmap).' },
        { name: 'gateway',          description: 'module:psp-platform · SD-64 Payment Order · SD-65 Payment Execution · SD-57 Card Token. /api/v1/gateway/payments · /api/v1/gateway/tokens. Prototype (v5 roadmap).' },
        { name: 'payment:checkout', description: 'module:psp-platform · SD-64 · Redirect checkout sessions. /api/v1/gateway/checkout. Hosted-payment-page flow for merchants.' },
        { name: 'payment:links',    description: 'module:psp-platform · SD-64 · Payment links. /api/v1/gateway/pay. Shareable pay-by-link flow for merchants.' },
        { name: 'system',       description: 'module:system · /api/v1/system. Health check (public) + raw document viewer (non-production, JWT required).' },
        { name: 'admin',        description: 'module:admin · /api/v1/admin. Administration panel: setup commands, terminal, log streaming, system info. Login via POST /admin/login.' },
        { name: 'providers',    description: 'module:providers · SD-193 External Provider Arrangements (ADR-029). /api/v1/providers. Vendors (external integrations), routing groups, and inbound callbacks (/providers/callback/<capability>/:id).' },
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
    theme: {
      title: 'Leafy Pay API',
      css: [{
        filename: 'leafy-topbar.css',
        content: [
          /* Replace Fastify SVG logo with app icon */
          '.topbar-wrapper .link img { content: url("/public/app-icon.png"); height: 38px; width: auto; }',
          /* Hide any leftover "fastify" text node next to the logo */
          '.topbar-wrapper .link span:not([class]) { display: none; }',
          /* Append "Leafy Pay" label after the icon */
          '.topbar-wrapper .link::after { content: "Leafy Pay"; font-size: 1.15rem; font-weight: 700; color: #00ED64; margin-left: 8px; letter-spacing: 0.01em; }',
        ].join('\n'),
      }],
    },
    uiHooks: {
      onRequest: (_request, _reply, done) => done(),
      preHandler: (_request, _reply, done) => done(),
    },
    staticCSP: true,
    transformStaticCSP: (header) => {
      const port = String(config.server.port);
      return `${header}; connect-src 'self' http://localhost:${port} http://127.0.0.1:${port}`;
    },
    transformSpecification: (spec) => spec,
    transformSpecificationClone: true,
  });
});

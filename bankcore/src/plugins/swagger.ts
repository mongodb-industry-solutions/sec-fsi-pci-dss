import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from '../config';

// The bank's API documentation, mirroring the backend's: same UI options, same themed topbar, same
// /doc prefix. bankcore is published so its Open Banking contract can be reviewed and exercised; the
// API itself is protected, since operating on it requires a registered TPP's client credentials.
async function swaggerPlugin(fastify: FastifyInstance) {
  // Public first when there is one: Try it out posts to the first server, and a private in-cluster
  // hostname is unreachable from the browser reading these docs.
  const servers = [
    ...(config.server.publicUrl ? [{ url: config.server.publicUrl, description: 'public, for reviewing and testing this API' }] : []),
    { url: config.server.baseUrl, description: 'private, service to service (the PSP uses this one)' },
  ];

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'bankcore (Open Banking ASPSP)',
        version: '1.0.0',
        description: `
## Overview

Open Banking API of the demo **ASPSP** behind Leafy Pay. The bank owns what a bank owns: the account
ledger and its balances, the card issuer vault with the only copy of a PAN, and the PSD2 consent
records. Leafy Pay is a registered **TPP** against it, playing three roles at once: AISP when it reads
accounts, PISP when it initiates a credit transfer, and CBPII when it asks for funds confirmation.

The external contract is [Berlin Group NextGenPSD2](https://www.berlin-group.org/nextgenpsd2-downloads)
shaped. BIAN control records stay internal, so nothing proprietary leaks into a caller's payloads.

## Authorisation

Every operation requires an access token obtained with \`grant_type=client_credentials\` by a
**registered TPP**, and AIS/PIS calls additionally require a consent whose \`consentStatus\` is
\`valid\`. A TPP that is not registered, not active, or lacks the scope for the endpoint is refused.
Reading these docs is open; operating on the API is not.

## Deliberately not implemented

Stated rather than silently absent, because this is a demo of the contracts and not a licensed bank:
**SCA** (PSD2 and the RTS would require it, with Berlin Group's Redirect, Decoupled or Embedded
approach), mTLS, eIDAS certificates and FAPI. The consent record, its status enumeration, its scope,
its revocability, its enforcement on every call and its audit trail are all real; only the human
authentication ceremony is absent, and only on the bank side.

## Encryption

Personal data is encrypted with
[MongoDB Queryable Encryption](https://www.mongodb.com/docs/manual/core/queryable-encryption/): the
account IBAN and the holder's name and contact on this side, and the full PAN in the issuer vault.
The key vault is shared with the PSP, so both services decrypt with the same DEKs.
`,
      },
      servers,
      tags: [
        { name: 'system', description: 'health and diagnostics. `/health` is open for infrastructure probes; the log buffer needs the platform admin token' },
        { name: 'oauth', description: 'TPP authentication. `client_credentials` against a registered TPP' },
        { name: 'consent', description: 'PSD2 consent lifecycle: create, read, revoke, status' },
        { name: 'accounts', description: 'account information (AIS): accounts, balances, transactions. Consent enforced' },
        { name: 'payments', description: 'payment initiation (PIS): initiate, status, cancel. Consent enforced' },
        { name: 'cards', description: 'card issuing and authorisation. ISO 8583 response codes, not Open Banking: no standard covers a card rail' },
        { name: 'admin', description: "bank administration, reached through the PSP: TPP registrations, consent mode, delivery inspector" },
      ],
      components: {
        securitySchemes: {
          // The Open Banking surface: a scoped token issued to a registered TPP.
          tppToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          // Diagnostics only, not a way into the banking API.
          adminAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/doc',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
    theme: {
      title: 'bankcore API',
      css: [{
        filename: 'bankcore-topbar.css',
        content: [
          '.topbar-wrapper .link span:not([class]) { display: none; }',
          '.topbar-wrapper .link svg { display: none; }',
          '.topbar-wrapper .link::after { content: "bankcore"; font-size: 1.15rem; font-weight: 700; color: #00ED64; margin-left: 8px; letter-spacing: 0.01em; }',
          '.swagger-ui .topbar { background-color: #001E2B; }',
        ].join('\n'),
      }],
    },
    staticCSP: true,
    transformStaticCSP: (header) => {
      const port = String(config.server.port);
      return `${header}; connect-src 'self' http://localhost:${port} http://127.0.0.1:${port}`;
    },
    transformSpecification: (spec) => spec,
    transformSpecificationClone: true,
  });
}

export default fp(swaggerPlugin, { name: 'swagger' });

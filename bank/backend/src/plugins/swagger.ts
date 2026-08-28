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
        title: 'BankCore (Open Banking ASPSP)',
        version: '1.0.0',
        description: `
## Overview

Open Banking API of the demo **ASPSP** behind LeafyPay. The bank owns what a bank owns: the account
ledger and its balances, the card issuer vault with the only copy of a PAN, and the PSD2 consent
records. LeafyPay is a registered **TPP** against it, playing three roles at once: AISP when it reads
accounts, PISP when it initiates a credit transfer, and CBPII when it asks for funds confirmation.

The external contract is [Berlin Group NextGenPSD2](https://www.berlin-group.org/nextgenpsd2-downloads)
shaped. BIAN control records stay internal, so nothing proprietary leaks into a caller's payloads.

## Authorisation

Every operation requires an access token obtained with \`grant_type=client_credentials\` by a
**registered TPP**, and AIS/PIS calls additionally require a consent whose \`consentStatus\` is
\`valid\`. A TPP that is not registered, not active, or lacks the scope for the endpoint is refused.
Reading these docs is open; operating on the API is not.

## Standard headers

Berlin Group defines these on the XS2A interface, and they are declared on the operations that use them:

| Header | Where | Behaviour here |
|---|---|---|
| \`X-Request-ID\` | every call | Accepted, echoed on the response, and stamped on every record the call writes. On a payment initiation it is also the IDEMPOTENCY key: a retry with the same value returns the same \`paymentId\` instead of a second payment. |
| \`Consent-ID\` | AIS, PIS, funds confirmation | Required. The call is refused when it is absent, when the consent is not \`valid\`, or when it does not cover what was asked for. |

One documented deviation: the standard makes \`X-Request-ID\` MANDATORY, and this bank generates one when a
caller omits it rather than refusing the call. That keeps a demonstration moving, and it is a deviation rather
than an oversight, so it is written down here instead of being discovered.

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
      // Every group states which standard role it serves and, where it serves none, says so. A reader
      // arriving from Berlin Group looks for AIS, PIS and CBPII by those names, and a group described only
      // by its resource leaves them guessing which one to integrate against.
      tags: [
        {
          name: 'consent',
          description:
            '**Consent (PSD2 / Berlin Group).** The access agreement every AIS and PIS call is judged '
            + 'against: create, read, revoke, status. A consent that has been CREATED is not yet a consent '
            + 'that is usable, which is what `consentStatus` carries.',
        },
        {
          name: 'accounts',
          description:
            '**Account Information Service (AIS).** Berlin Group NextGenPSD2: the account list, one '
            + 'account, its balances and its transactions. Requires a `valid` consent and the `Consent-ID` '
            + 'header on every call, scoped to what that consent granted.',
        },
        {
          name: 'payments',
          description:
            '**Payment Initiation Service (PIS).** Berlin Group NextGenPSD2 and ISO 20022: initiate a '
            + 'credit transfer, read it, poll its status, cancel it, and the periodic-payment (standing '
            + 'order) resource. Amounts are decimal strings and `transactionStatus` is the ISO 20022 code '
            + 'set, not an invented one. `X-Request-ID` doubles as the idempotency key on initiation.',
        },
        {
          name: 'funds',
          description:
            '**Confirmation of Funds (CBPII).** Berlin Group and PSD2 Article 65: a yes or no on whether '
            + 'an amount is available, and deliberately nothing more. It returns no balance, because the '
            + 'whole point of the endpoint is that a card issuer may ask the question without being told '
            + 'the figure.',
        },
        {
          name: 'cards',
          description:
            '**Card Issuer and Card Authorisation. NOT Open Banking, and it does not pretend to be.** No '
            + 'Open Banking standard covers issuing a card or authorising one on the card rails, so this '
            + 'group follows the card industry instead: ISO/IEC 7812 numbering, Luhn check digits, and ISO '
            + '8583 response codes so an approval and each kind of decline are distinguishable by a caller '
            + 'that speaks the rail. The full card number lives encrypted in the issuer vault and is never '
            + 'returned by a list.',
        },
        {
          name: 'credit',
          description:
            '**Credit assessment. No Open Banking equivalent, documented rather than dressed up as one.** '
            + 'The bank scores a party it banks from its own records: the relationship, the balances it '
            + 'holds and the payments that were returned. It answers with a rating band and the reasons '
            + 'behind it.',
        },
        {
          name: 'oauth',
          description:
            '**TPP authentication (OAuth 2.0).** `grant_type=client_credentials` against a registered '
            + 'third party. Registration is the authorisation model: a client with no active registration '
            + 'cannot obtain a token at all.',
        },
        {
          name: 'admin',
          description:
            '**Bank administration. Plain REST, deliberately off the standard surface.** The bank\'s own '
            + 'operators administering its own records: the cards it issued, the accounts it holds, the '
            + 'parties behind them, its engine configuration, its third-party registrations and its audit '
            + 'trail. It is separate from `/v1` because no Open Banking standard defines any of it: the '
            + 'standard specifies a THIRD PARTY interface, not a bank\'s back office. Reached from the '
            + 'bank\'s own administration app, which holds an operator token rather than a TPP token.',
        },
        {
          name: 'system',
          description:
            '**Infrastructure, not API.** `/health` is open for deployment probes; the log buffer needs '
            + 'the platform admin token. Not part of the contract a third party integrates against.',
        },
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
      title: 'BankCore API',
      css: [{
        filename: 'bankcore-topbar.css',
        content: [
          '.topbar-wrapper .link span:not([class]) { display: none; }',
          '.topbar-wrapper .link svg { display: none; }',
          '.topbar-wrapper .link::after { content: "BankCore"; font-size: 1.15rem; font-weight: 700; color: #00ED64; margin-left: 8px; letter-spacing: 0.01em; }',
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

// v37 P6.2a–c: a second bank whose API is nothing like the standard, made to work by MAPPING ALONE.
//
// This is the claim the whole routing design rests on: adding a real institution should be a record plus
// configuration, not a new client. P6.2d proved the standard shape reaches a bank. That proves the easy half,
// because our own bank speaks Berlin Group. The hard half is a bank that does not, which is most of them.
//
// So this stands up a deliberately awkward receiver: a different path shape, different header names,
// snake_case keys, the amount as a number rather than a decimal string, and a nested object where the standard
// has a flat field. Nothing in `backend/src` knows it exists. If the same dispatch call reaches it in its own
// dialect, the door really is open; if it needs one line of code, it is not.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server, IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildContractApp, closeContractApp } from './support/contract';
import { dispatchProvider } from '../../../backend/src/modules/provider/services/integrationDispatch.service';
import {
  EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION,
} from '../../../backend/src/modules/provider/models/externalProviderArrangement.model';

const PROVIDER_REF = 'p62-proprietary-bank';
// A bank code no seeded institution claims, so resolution is unambiguous.
const PROPRIETARY_IBAN = 'ES2121000418450200051332';

interface Received {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

// Stands in for "Banco Proprietario": a real institution with a real API that happens not to be the standard.
function startReceiver(): Promise<{ server: Server; port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (c) => chunks.push(c as Buffer));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
      received.push({ method: request.method ?? '', path: request.url ?? '', headers: request.headers, body });
      // Its own response dialect too, so the inbound mapping has something to normalise.
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ saldo: { importe: 1234.56, moneda: 'EUR' }, estado: 'OK' }));
    });
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      done({ server, port: (server.address() as { port: number }).port, received });
    });
  });
}

describe('v37 P6.2a–c: a proprietary bank absorbed by configuration', () => {
  let app: FastifyInstance;
  let server: Server;
  let received: Received[];

  beforeAll(async () => {
    app = await buildContractApp();
    const started = await startReceiver();
    server = started.server;
    received = started.received;

    // The whole integration, as a record. Note what is NOT here: any code.
    await app.db.collection(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).replaceOne(
      { externalProviderArrangementInstanceReference: PROVIDER_REF },
      {
        externalProviderArrangementInstanceReference: PROVIDER_REF,
        externalProviderArrangementName: 'Banco Proprietario (test)',
        externalProviderArrangementType: 'account_information',
        externalProviderArrangementStatus: 'active',
        externalProviderIsInternal: false,
        externalProviderBaseUrl: `http://127.0.0.1:${started.port}`,
        // Never used for this event: the declared per-event url wins.
        externalProviderApiEndpoint: '/unused',
        // What it serves. This is what makes it resolvable, and what keeps it from answering for our own bank.
        externalProviderIbanBankCodes: ['2100'],
        externalProviderEvents: [{
          event: 'bank.balance.read.requested',
          outbound: {
            // Its own path shape: a query-style resource, not the standard's nesting.
            url: '/api/cuentas/{accountId}/saldo',
            httpMethod: 'POST',
            // Its own header names. The standard's `Consent-ID` means nothing here.
            headers: {
              'X-Autorizacion-Cliente': '{consentId}',
              'X-Traza': '{correlationId}',
            },
            // Its own body dialect, entirely by declaration: renamed, nested, rescaled and revalued.
            mapping: [
              { sourcePath: 'requestedCurrency', targetPath: 'peticion.moneda' },
              { sourcePath: 'includePending', targetPath: 'peticion.incluir_pendientes' },
              // Minor units, the way plenty of real bank APIs want an amount.
              { sourcePath: 'amount', targetPath: 'peticion.importe_centimos', transform: { type: 'scale', scaleFactor: 100 } },
              // Its own vocabulary for a value the standard spells differently.
              {
                sourcePath: 'accountType',
                targetPath: 'peticion.tipo_cuenta',
                transform: { type: 'value_map', valueMap: { current: 'CORRIENTE', savings: 'AHORRO' } },
              },
            ],
          },
        }],
        externalProviderMode: 'sync',
        externalProviderTimeoutMs: 5000,
        externalProviderRetryPolicy: { maxAttempts: 1, backoffMs: 0 },
        externalProviderHealthStatus: 'ok',
        routingPriority: 500,
        fieldMappingConfig: { outbound: [], inbound: [], schemaVersion: 1 },
        bianServiceDomain: 'Open Banking',
        bianControlRecordType: 'AccountInformationValidation',
        recordCreatedDateTime: new Date().toISOString(),
        schemaVersion: 2,
      } as never,
      { upsert: true },
    );
  });

  afterAll(async () => {
    await app?.db.collection(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION)
      .deleteOne({ externalProviderArrangementInstanceReference: PROVIDER_REF });
    await new Promise<void>((done) => server.close(() => done()));
    await closeContractApp(app);
  });

  it('routes to the bank that claims the IBAN bank code, not to ours', async () => {
    const result = await dispatchProvider(
      app.db, 'account_information', 'bank.balance.read.requested',
      { accountId: 'ACC-PROP-1', consentId: 'CNS-PROP-1', correlationId: 'p62abc' },
      undefined,
      { iban: PROPRIETARY_IBAN },
    );
    expect(result.status, `dispatch: ${JSON.stringify(result)}`).not.toBe('error');
    expect(result.arrangementId).toBe(PROVIDER_REF);
    expect(received.length, 'the proprietary bank received nothing').toBeGreaterThan(0);
  });

  it('reaches its own path and method, from the declared template', () => {
    const last = received[received.length - 1];
    expect(last.path).toBe('/api/cuentas/ACC-PROP-1/saldo');
    expect(last.method).toBe('POST');
  });

  it('carries ITS header names, not the standard ones', () => {
    const last = received[received.length - 1];
    expect(last.headers['x-autorizacion-cliente']).toBe('CNS-PROP-1');
    expect(last.headers['x-traza']).toBe('p62abc');
    // The standard's header is absent, which is the point: nothing hardcodes Berlin Group.
    expect(last.headers['consent-id']).toBeUndefined();
  });

  it('speaks its own body dialect, produced by mapping alone', async () => {
    // A fresh call carrying the fields the mapping renames.
    await dispatchProvider(
      app.db, 'account_information', 'bank.balance.read.requested',
      {
        accountId: 'ACC-PROP-2',
        consentId: 'CNS-PROP-2',
        correlationId: 'p62abc-2',
        requestedCurrency: 'EUR',
        includePending: true,
        amount: 12.34,
        accountType: 'current',
      },
      undefined,
      { iban: PROPRIETARY_IBAN },
    );
    const last = received[received.length - 1] as { body: Record<string, unknown> };
    const body = last.body as { peticion?: Record<string, unknown> };

    // Renamed AND nested, from flat standard fields.
    expect(body.peticion?.moneda).toBe('EUR');
    expect(body.peticion?.incluir_pendientes).toBe(true);
    // Rescaled to minor units, and revalued into its own vocabulary. Both by declaration.
    expect(body.peticion?.importe_centimos).toBe(1234);
    expect(body.peticion?.tipo_cuenta).toBe('CORRIENTE');
    // The original names are gone: a rename must not leave both spellings on the wire.
    expect(body).not.toHaveProperty('requestedCurrency');
    expect(body).not.toHaveProperty('includePending');
    expect(body).not.toHaveProperty('amount');
    expect(body).not.toHaveProperty('accountType');
    // And the keys spent on the path and the headers are not repeated in the body.
    expect(body).not.toHaveProperty('accountId');
    expect(body).not.toHaveProperty('consentId');
    expect(body).not.toHaveProperty('correlationId');
  });

  it('leaves our own bank untouched, which is the multi-bank claim', async () => {
    // Adding an institution must not change how an existing one is reached. Resolved by OUR bank code.
    const result = await dispatchProvider(
      app.db, 'account_information', 'bank.balance.read.requested',
      { accountId: 'whatever', consentId: 'whatever', correlationId: 'p62abc-3' },
      undefined,
      { iban: 'ES5198201054503844130418' },
    );
    // It resolved to the seeded internal AIS provider, not to the proprietary one.
    expect(result.arrangementId).not.toBe(PROVIDER_REF);
    // The proprietary receiver saw nothing new.
    const paths = received.map((r) => r.path);
    expect(paths.filter((path) => path.includes('whatever'))).toEqual([]);
  });

  it('refuses an IBAN no registered institution claims, rather than picking one', async () => {
    const result = await dispatchProvider(
      app.db, 'account_information', 'bank.balance.read.requested',
      { accountId: 'x', consentId: 'y' },
      undefined,
      { iban: 'GB29NWBK60161331926819' },
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('no registered institution owns');
  });
  it('warns rather than silently doing nothing when a transform is not recognised', async () => {
    // Found while writing this suite: a typo'd transform passed the value through in silence, so an
    // integration looked configured while the wire payload was wrong. It still passes through, because one
    // cosmetic rule error should not take down a working dispatch, but it now says so.
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
    try {
      const { applyMappings } = await import('../../../backend/src/modules/provider/services/fieldMapping.service');
      const out = applyMappings(
        { name: 'value' },
        [{ sourcePath: 'name', targetPath: 'renamed', transform: { type: 'uppercase' } as never }],
      );
      expect(out.renamed).toBe('value');
      expect(warnings.join(' ')).toContain('unknown transform');
    } finally {
      console.warn = original;
    }
  });
});

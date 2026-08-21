// v37 P7.1: the card issuer's surface, exercised against the running app.
//
// What is worth an integration test rather than a unit test: the scope separation (a token that can place a
// hold must NOT be able to read a card number), and the lifecycle transitions, which touch two collections
// and must move both or neither.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../bank/backend/bin/server';
import { issueAccessToken } from '../../../../bank/backend/src/modules/tpp-trust/services/tppAccessToken.service';

const REGISTRATION = { tppRegistrationClientId: 'leafypay-psp', tppRegistrationRoles: ['AISP', 'PISP', 'CBPII'] } as never;
const withScopes = (scopes: string[]) => issueAccessToken(REGISTRATION, scopes as never).accessToken;

const CARD_DATA = () => withScopes(['card-data', 'card-authorisations']);
// Deliberately without card-data: this is the token the funds gate uses.
const HOLD_ONLY = () => withScopes(['card-authorisations']);

describe('v37 P7.1: the card issuer surface', () => {
  let app: FastifyInstance;
  let issuedToken: string | undefined;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('refuses cardholder data to a token that can only place a hold', async () => {
    // The whole reason card-data is a separate scope. If this passes with the hold token, the separation is
    // decorative.
    for (const [method, url] of [
      ['POST', '/v1/cards/searches'],
      ['POST', '/v1/cards/pm_anything/pan-reveals'],
      ['POST', '/v1/cards'],
    ] as Array<[string, string]>) {
      const response = await app.inject({
        method: method as 'POST',
        url,
        headers: { authorization: `Bearer ${HOLD_ONLY()}` },
        payload: {},
      });
      expect(response.statusCode, `${method} ${url} must refuse the hold-only token`).toBe(403);
    }
  });

  it('refuses everything to a caller with no token at all', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/cards/pm_anything' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBeTruthy();
  });

  it('issues a card as issued rather than active, and never returns its number', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/cards',
      headers: { authorization: `Bearer ${CARD_DATA()}` },
      payload: { network: 'VISA', expiryMonth: '12', expiryYear: '31' },
    });
    if (response.statusCode === 503) return; // no database in this environment
    expect(response.statusCode).toBe(201);
    const card = response.json();
    expect(card.status).toBe('issued');
    expect(card.lastFour).toMatch(/^\d{4}$/);
    expect(card.maskedDisplay).toBe(`****-****-****-${card.lastFour}`);
    // The response is a card, not a card number.
    expect(JSON.stringify(card)).not.toMatch(/"cardNumber"|"paymentCardNumber"/);
    issuedToken = card.cardToken;
  });

  it('refuses a network this bank declares no range for, rather than issuing an unroutable card', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/cards',
      headers: { authorization: `Bearer ${CARD_DATA()}` },
      payload: { network: 'NOTANETWORK', expiryMonth: '12', expiryYear: '31' },
    });
    if (response.statusCode === 503) return;
    expect(response.statusCode).toBe(400);
  });

  it('activates, blocks, reactivates and revokes, and refuses to leave revoked', async () => {
    if (!issuedToken) return;
    const status = async (value: string) => app.inject({
      method: 'PUT',
      url: `/v1/cards/${issuedToken}/status`,
      headers: { authorization: `Bearer ${CARD_DATA()}` },
      payload: { status: value },
    });

    expect((await status('active')).json().status).toBe('active');
    expect((await status('suspended')).json().status).toBe('suspended');
    expect((await status('active')).json().status).toBe('active');
    expect((await status('revoked')).json().status).toBe('revoked');
    // Terminal: a revoked card is replaced, not resurrected, so one token never means two cards.
    const resurrect = await status('active');
    expect(resurrect.statusCode).toBe(409);
  });

  it('sets a limit and reports it back on the card', async () => {
    if (!issuedToken) return;
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/cards/${issuedToken}/limits`,
      headers: { authorization: `Bearer ${CARD_DATA()}` },
      payload: { perTransactionAmount: 250, limitCurrency: 'EUR' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().limits).toMatchObject({ perTransactionAmount: 250, limitCurrency: 'EUR' });
  });

  it('replaces a card with a different one, and revokes what it replaced', async () => {
    if (!issuedToken) return;
    const created = await app.inject({
      method: 'POST',
      url: '/v1/cards',
      headers: { authorization: `Bearer ${CARD_DATA()}` },
      payload: { network: 'VISA', expiryMonth: '01', expiryYear: '32' },
    });
    if (created.statusCode !== 201) return;
    const original = created.json().cardToken;

    const response = await app.inject({
      method: 'POST',
      url: `/v1/cards/${original}/replacements`,
      headers: { authorization: `Bearer ${CARD_DATA()}` },
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    const { replacement, replaced } = response.json();
    expect(replaced).toBe(original);
    // A new token and a new last four: a lost card's number has to stop working.
    expect(replacement.cardToken).not.toBe(original);

    const old = await app.inject({
      method: 'GET',
      url: `/v1/cards/${original}`,
      headers: { authorization: `Bearer ${CARD_DATA()}` },
    });
    expect(old.json().status).toBe('revoked');
  });

  it('answers 404 for a card it never issued, rather than inventing one', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/cards/pm_definitely_not_a_card',
      headers: { authorization: `Bearer ${CARD_DATA()}` },
    });
    if (response.statusCode === 503) return;
    expect(response.statusCode).toBe(404);
  });

  it('validates a card against the configured rules, answering a rail response code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/cards/validations',
      headers: { authorization: `Bearer ${CARD_DATA()}` },
      payload: { cardNumber: '4111111111111111', cvv: '123', expiry: '12/34' },
    });
    if (response.statusCode === 503) return;
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.responseCode).toBe('00');
    expect(result.cvvValidationResult).toBe('match');
  });

  it('requires a card reference of some kind before it will judge anything', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/cards/validations',
      headers: { authorization: `Bearer ${CARD_DATA()}` },
      payload: { cvv: '123' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().tppMessages?.[0]?.code).toBeTruthy();
  });
});

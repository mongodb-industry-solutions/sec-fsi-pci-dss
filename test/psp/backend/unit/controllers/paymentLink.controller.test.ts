/**
 * Unit tests: `resolveActingMerchant`, the merchant-binding guard for the payment links routes.
 * Source: psp/backend/src/modules/gateway/controllers/paymentLink.controller.ts
 *
 * THE VULNERABILITY THIS CLOSES, proven live against the running backend before the fix: every
 * payment-link route (POST /, GET /, PATCH /:id) read `merchantAgreementInstanceReference` straight
 * out of the request body or querystring and trusted it outright. Any authenticated session holding
 * the baseline `merchants:view` permission, which includes the plain `customer` role, could create a
 * real payment link (with a working `paymentUrl`), list, or deactivate links for ANY merchant by
 * supplying its reference, with no relationship to that merchant required at all.
 *
 * `resolveActingMerchant` is now the one place all three routes bind the caller to a merchant it may
 * actually act for, before doing anything else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const canMock = vi.fn();
vi.mock('../../../../../psp/backend/src/vendors/middleware/acl', () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const getMerchantByIdMock = vi.fn();
vi.mock('../../../../../psp/backend/src/modules/gateway/services/merchant.service', () => ({
  getMerchantById: (...args: unknown[]) => getMerchantByIdMock(...args),
}));

// Other service imports the controller module pulls in at load time; unused by resolveActingMerchant
// itself, stubbed so importing the controller module does not require a live db or webhook dispatcher.
vi.mock('../../../../../psp/backend/src/modules/gateway/services/paymentLink.service', () => ({
  createPaymentLink: vi.fn(),
  resolvePaymentLink: vi.fn(),
  processLinkPayment: vi.fn(),
  deactivatePaymentLink: vi.fn(),
  listPaymentLinks: vi.fn(),
}));
vi.mock('../../../../../psp/backend/src/modules/gateway/services/webhook.service', () => ({
  deliverWebhook: vi.fn(),
}));

const { resolveActingMerchant } = await import(
  '../../../../../psp/backend/src/modules/gateway/controllers/paymentLink.controller'
);

const FASTIFY_STUB = {} as FastifyInstance;

function makeReply() {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) { sent.status = code; return reply; },
    send(body: unknown) { sent.body = body; return reply; },
  } as unknown as FastifyReply;
  return { reply, sent };
}

function makeRequest(opts: { merchantContext?: { merchantId: string }; user?: { partyRef?: string } } = {}) {
  return {
    merchantContext: opts.merchantContext,
    user: opts.user,
  } as unknown as FastifyRequest;
}

beforeEach(() => {
  canMock.mockReset();
  getMerchantByIdMock.mockReset();
});

describe('OAuth channel (merchant client_credentials)', () => {
  it('binds to the token own merchant, ignoring an absent request value', async () => {
    const request = makeRequest({ merchantContext: { merchantId: 'm-token-owner' } });
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, undefined);
    expect(result).toBe('m-token-owner');
    expect(sent.status).toBeUndefined();
  });

  it('accepts a request value that matches the token', async () => {
    const request = makeRequest({ merchantContext: { merchantId: 'm-token-owner' } });
    const { reply } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, 'm-token-owner');
    expect(result).toBe('m-token-owner');
  });

  it('refuses a request value naming a DIFFERENT merchant: a client cannot impersonate another', async () => {
    const request = makeRequest({ merchantContext: { merchantId: 'm-token-owner' } });
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, 'm-someone-else');
    expect(result).toBeUndefined();
    expect(sent.status).toBe(403);
    expect(sent.body).toMatchObject({ error: 'access_denied' });
  });
});

describe('staff session (merchants:manage)', () => {
  it('trusts the supplied reference, for legitimate back-office operation on any merchant', async () => {
    canMock.mockReturnValue(true);
    const request = makeRequest({ user: { partyRef: 'staff-party' } });
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, 'm-any-merchant');
    expect(result).toBe('m-any-merchant');
    expect(sent.status).toBeUndefined();
    expect(getMerchantByIdMock).not.toHaveBeenCalled();
  });

  it('requires SOME reference: there is no ambient "every merchant" answer', async () => {
    canMock.mockReturnValue(true);
    const request = makeRequest({ user: { partyRef: 'staff-party' } });
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, undefined);
    expect(result).toBeUndefined();
    expect(sent.status).toBe(400);
  });
});

describe('ordinary session (merchants:view only, e.g. customer)', () => {
  it('THE VULNERABILITY: refuses a merchant the caller does not own', async () => {
    canMock.mockReturnValue(false); // no merchants:manage
    getMerchantByIdMock.mockResolvedValue({
      merchantOwnerPartyReference: 'someone-else',
      merchantBeneficialOwners: [],
    });
    const request = makeRequest({ user: { partyRef: 'customer-party' } });
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, 'm-not-mine');
    expect(result).toBeUndefined();
    expect(sent.status).toBe(403);
    expect(sent.body).toMatchObject({ error: 'access_denied' });
  });

  it('allows the primary owner', async () => {
    canMock.mockReturnValue(false);
    getMerchantByIdMock.mockResolvedValue({
      merchantOwnerPartyReference: 'customer-party',
      merchantBeneficialOwners: [],
    });
    const request = makeRequest({ user: { partyRef: 'customer-party' } });
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, 'm-mine');
    expect(result).toBe('m-mine');
    expect(sent.status).toBeUndefined();
  });

  it('allows a beneficial owner, not only the primary one', async () => {
    canMock.mockReturnValue(false);
    getMerchantByIdMock.mockResolvedValue({
      merchantOwnerPartyReference: 'primary-owner',
      merchantBeneficialOwners: [{ merchantBeneficialOwnerPartyReference: 'customer-party' }],
    });
    const request = makeRequest({ user: { partyRef: 'customer-party' } });
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, 'm-shared');
    expect(result).toBe('m-shared');
    expect(sent.status).toBeUndefined();
  });

  it('refuses a merchant that does not exist, rather than leaking whether it does', async () => {
    canMock.mockReturnValue(false);
    getMerchantByIdMock.mockResolvedValue(null);
    const request = makeRequest({ user: { partyRef: 'customer-party' } });
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, 'm-does-not-exist');
    expect(result).toBeUndefined();
    expect(sent.status).toBe(403);
  });

  it('requires a merchant reference: there is no ambient "my merchants" default either', async () => {
    canMock.mockReturnValue(false);
    const request = makeRequest({ user: { partyRef: 'customer-party' } });
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, undefined);
    expect(result).toBeUndefined();
    expect(sent.status).toBe(400);
    expect(getMerchantByIdMock).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller (no session, no OAuth context)', async () => {
    canMock.mockReturnValue(false);
    const request = makeRequest({});
    const { reply, sent } = makeReply();
    const result = await resolveActingMerchant(FASTIFY_STUB, request, reply, 'm-any');
    expect(result).toBeUndefined();
    expect(sent.status).toBe(401);
  });
});

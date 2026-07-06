/**
 * Unit tests (v18 Item 2): server-to-server merchant charge auth on POST /gateway/payments.
 * Source: backend/src/vendors/middleware/validateMerchantToken.ts
 *
 * The API payment is authenticated by the merchant's OWN machine token (client_credentials, scope
 * write:payments), NOT a user session. These tests assert the middleware:
 *   · rejects when NO credential is presented (401),
 *   · rejects a valid token lacking write:payments (403 insufficient_scope),
 *   · accepts a valid token with write:payments and binds the acquiring merchant context.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ verifyAccessToken: vi.fn() }));
vi.mock('../../../../backend/src/modules/identity/services/oauth.service', () => ({
  verifyAccessToken: h.verifyAccessToken,
}));

import { validateMerchantToken } from '../../../../backend/src/vendors/middleware/validateMerchantToken';

const activeMerchant = {
  merchantAgreementInstanceReference: 'm-1',
  merchantName: 'Espresso Works Ltd',
  merchantAgreementStatus: 'active',
  merchantOAuthClient: { oauthClientStatus: 'active' },
};

function makeReq(auth?: string) {
  return {
    headers: auth ? { authorization: auth } : {},
    server: { db: { collection: () => ({ findOne: vi.fn().mockResolvedValue(activeMerchant) }) } },
  } as any;
}
function makeReply() {
  const reply: any = {};
  reply.status = vi.fn(() => reply);
  reply.send = vi.fn(() => reply);
  return reply;
}

beforeEach(() => h.verifyAccessToken.mockReset());

describe('validateMerchantToken (server-to-server merchant charge)', () => {
  it('rejects with 401 when no Bearer credential is presented', async () => {
    const req = makeReq();
    const reply = makeReply();
    await validateMerchantToken(req, reply, 'write:payments');
    expect(reply.status).toHaveBeenCalledWith(401);
    expect(req.merchantContext).toBeUndefined();
  });

  it('rejects with 403 when the token lacks the write:payments scope', async () => {
    h.verifyAccessToken.mockResolvedValue({ aud: 'client-1', scope: 'openid profile', sub: 'client-1' });
    const req = makeReq('Bearer good');
    const reply = makeReply();
    await validateMerchantToken(req, reply, 'write:payments');
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(req.merchantContext).toBeUndefined();
  });

  it('accepts a valid client_credentials token with write:payments and binds the merchant', async () => {
    h.verifyAccessToken.mockResolvedValue({ aud: 'client-1', scope: 'write:payments', sub: 'client-1' });
    const req = makeReq('Bearer good');
    const reply = makeReply();
    await validateMerchantToken(req, reply, 'write:payments');
    expect(reply.status).not.toHaveBeenCalled();
    expect(req.merchantContext).toMatchObject({ merchantId: 'm-1', merchantName: 'Espresso Works Ltd' });
  });
});

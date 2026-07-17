/**
 * Unit tests: v27 staff scope on the consent-grant DETAIL + OPERATIONS endpoints.
 * Source: backend/src/modules/identity/controllers/consentGrants.controller.ts (resolveTargetSub).
 *
 * Both GET /auth/grants/:consentId and GET /auth/grants/:consentId/operations delegate the target-sub
 * decision to resolveTargetSub. We assert the staff gate (L1/customer -> 403; L2/auditor allowed) and
 * that, when absent, self behavior is unchanged (caller's own sub; 401 with no session).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ resolveSubForParty: vi.fn() }));

vi.mock('../../../../backend/src/modules/identity/services/oauth.service', () => ({
  resolveSubForParty: h.resolveSubForParty,
  // Named imports the controller pulls from the service (unused here, stubbed to satisfy the module).
  listUserConsentGrants: vi.fn(),
  getUserConsentGrantDetail: vi.fn(),
  revokeConsentGrant: vi.fn(),
  reactivateConsentGrant: vi.fn(),
}));

import { resolveTargetSub } from '../../../../backend/src/modules/identity/controllers/consentGrants.controller';

const fastify = { db: {} } as any;

function req(opts: { role?: string; sub?: string } = {}) {
  return {
    headers: opts.role ? { 'x-user-role': opts.role } : {},
    user: opts.sub ? { sub: opts.sub, role: opts.role } : undefined,
  } as any;
}

beforeEach(() => {
  h.resolveSubForParty.mockReset().mockResolvedValue('sub-target');
});

describe('resolveTargetSub staff scope (partyRef present)', () => {
  it('forbids level1_analyst with 403', async () => {
    const r = await resolveTargetSub(fastify, req({ role: 'level1_analyst' }), 'party-1');
    expect(r).toEqual({ error: expect.any(String), status: 403 });
  });

  it('forbids customer with 403', async () => {
    const r = await resolveTargetSub(fastify, req({ role: 'customer' }), 'party-1');
    expect(r).toEqual({ error: expect.any(String), status: 403 });
  });

  it('allows level2_investigator and resolves the target sub', async () => {
    const r = await resolveTargetSub(fastify, req({ role: 'level2_investigator' }), 'party-1');
    expect(r).toEqual({ sub: 'sub-target' });
    expect(h.resolveSubForParty).toHaveBeenCalledWith(fastify.db, 'party-1');
  });

  it('allows security_auditor and resolves the target sub', async () => {
    const r = await resolveTargetSub(fastify, req({ role: 'security_auditor' }), 'party-1');
    expect(r).toEqual({ sub: 'sub-target' });
  });

  it('returns sub=null when the target party has no auth identity (no existence leak)', async () => {
    h.resolveSubForParty.mockResolvedValue(null);
    const r = await resolveTargetSub(fastify, req({ role: 'security_auditor' }), 'party-x');
    expect(r).toEqual({ sub: null });
  });
});

describe('resolveTargetSub self scope (partyRef absent)', () => {
  it('returns the caller\'s own sub and never resolves a party', async () => {
    const r = await resolveTargetSub(fastify, req({ role: 'level2_investigator', sub: 'sub-self' }), undefined);
    expect(r).toEqual({ sub: 'sub-self' });
    expect(h.resolveSubForParty).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session sub', async () => {
    const r = await resolveTargetSub(fastify, req({}), undefined);
    expect(r).toEqual({ error: 'Unauthorized', status: 401 });
  });
});

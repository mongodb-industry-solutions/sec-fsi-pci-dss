/**
 * card_authorization no longer asks the bank directly.
 *
 * It used to: a flat, no-longer-real payload dispatched straight to the bank's hold endpoint. Fixing
 * the shape without removing the dispatch would have meant asking the same bank to hold the same
 * amount TWICE for one purchase, once here and once from the funds gate (bankcoreCardAuthorisation
 * .test.ts covers that call, which already builds the correct contract). So this gate defers instead:
 * these tests are the contract that the deferral, not a second bank call, is what actually happens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ provider: null as Record<string, unknown> | null, card: null as Record<string, unknown> | null }));

vi.mock('../../../../../psp/backend/src/modules/provider/services/integrationRegistry.service', () => ({
  getActiveProviderForType: vi.fn(async () => h.provider),
}));

vi.mock('../../../../../psp/backend/src/modules/customer/services/paymentCard.service', () => ({
  getCardByToken: vi.fn(async () => h.card),
}));

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { authorizeCard } from '../../../../../psp/backend/src/modules/gateway/services/cardAuthorization.service';
import { CARD_AUTHORIZATION_COLLECTION } from '../../../../../psp/backend/src/modules/gateway/models/cardAuthorization.model';

describe('no path in this file reaches the network', () => {
  it('imports neither the institution router nor the generic dispatcher', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../psp/backend/src/modules/gateway/services/cardAuthorization.service.ts'),
      'utf8',
    );
    // A future edit that re-adds either import is exactly the regression this suite exists to catch:
    // it would put a second bank call back on this path.
    expect(src).not.toContain('capabilityGroup');
    expect(src).not.toContain('dispatchProvider');
  });
});

function dbCapturingInserts() {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    collection: (name: string) => {
      if (name !== CARD_AUTHORIZATION_COLLECTION) throw new Error(`unexpected collection ${name}`);
      return { insertOne: async (doc: Record<string, unknown>) => { inserted.push(doc); } };
    },
  } as never;
  return { db, inserted };
}

const REQUEST = {
  checkoutSessionInstanceReference: 'chk-1',
  cardToken: 'pm_1',
  amount: 39,
  currency: 'GBP',
  mcc: '5999',
  merchantCode: 'm-1',
};

beforeEach(() => {
  h.provider = null;
  h.card = null;
});

describe('a real, non-internal institution is registered', () => {
  beforeEach(() => {
    h.provider = { externalProviderIsInternal: false, externalProviderArrangementInstanceReference: 'arr-bankcore' };
  });

  it('approves without asking anyone, rather than dispatching a stale contract', async () => {
    const { db } = dbCapturingInserts();
    const result = await authorizeCard(db, REQUEST);
    expect(result.result).toBe('approved');
    // A distinct code from a genuine issuer '0000', so an investigation can tell the two apart.
    expect(result.responseCode).toBe('0002');
    expect(result.authCode).toBeTruthy();
  });

  it('records the deferral on the audit trail, naming the real institution', async () => {
    const { db, inserted } = dbCapturingInserts();
    await authorizeCard(db, REQUEST);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      cardAuthorizationResult: 'approved',
      cardAuthorizationResponseCode: '0002',
      cardAuthorizationProviderReference: 'arr-bankcore',
    });
  });
});

describe('no institution can be asked', () => {
  it('fails closed when no provider is registered at all', async () => {
    h.provider = null;
    const { db } = dbCapturingInserts();
    const result = await authorizeCard(db, REQUEST);
    expect(result.result).toBe('declined');
    expect(result.responseCode).toBe('0910');
  });

  it('fails closed for an internal (built-in stub) provider the same way as before', async () => {
    h.provider = { externalProviderIsInternal: true, externalProviderArrangementInstanceReference: 'arr-stub' };
    const { db } = dbCapturingInserts();
    const result = await authorizeCard(db, REQUEST);
    expect(result.result).toBe('declined');
    expect(result.responseCode).toBe('0910');
  });
});

describe('the card-on-file policy gate, unaffected by the deferral', () => {
  it('still declines a deactivated card before asking anyone, real institution or not', async () => {
    h.provider = { externalProviderIsInternal: false, externalProviderArrangementInstanceReference: 'arr-bankcore' };
    h.card = { paymentCardStatus: 'suspended' };
    const { db } = dbCapturingInserts();
    const result = await authorizeCard(db, REQUEST);
    expect(result.result).toBe('declined');
    expect(result.responseCode).toBe('0540');
  });
});

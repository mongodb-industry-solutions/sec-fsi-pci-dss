/**
 * Unit tests: v32 C5 raw-document authorization (test 26)
 * Source: backend/src/modules/system/services/rawDocumentAccess.service.ts
 *
 * The raw view used to be authorized by JWT presence alone (PCI DSS Req 7.3.1/7.3.3 gap):
 * any authenticated caller could read any allowed-collection document by UUID, exposing the
 * plaintext attributes of another party's record. These tests pin the two branches:
 * staff roles need `view` on the owning BIAN resource, and an own-scope role (customer)
 * reaches only records proven to be its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  can: vi.fn(),
  getDbForRole: vi.fn(),
}));

vi.mock('../../../../backend/src/vendors/middleware/acl', () => ({ can: h.can }));
vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
}));

import {
  authorizeRawDocumentAccess,
  RAW_COLLECTION_RESOURCE,
} from '../../../../backend/src/modules/system/services/rawDocumentAccess.service';

const OWN_PARTY = 'party-own';
const OWN_AGREEMENT = 'ca-own';
const OWN_ACCOUNT = 'ACC-OWN';

/** QE-client double: the agreement lookup plus the per-collection ownership probes. */
function makeQeDb(opts: { ownsTxn?: boolean; ownsCard?: boolean; ownsCase?: boolean } = {}) {
  return {
    collection: vi.fn((name: string) => ({
      findOne: vi.fn(async (filter: Record<string, unknown>) => {
        if (name === 'customerAgreementProcedure') {
          if (filter.partyInstanceReference === OWN_PARTY) {
            return { customerAgreementInstanceReference: OWN_AGREEMENT, customerAgreementReference: OWN_ACCOUNT };
          }
          return null;
        }
        if (name === 'cardTransactionLog') return opts.ownsTxn ? { _id: 1 } : null;
        if (name === 'paymentCardManagement') return opts.ownsCard ? { _id: 1 } : null;
        if (name === 'fraudDiagnosisCase') return opts.ownsCase ? { _id: 1 } : null;
        return null;
      }),
    })),
  };
}

const serverDb = {} as never;

beforeEach(() => {
  h.can.mockReset();
  h.getDbForRole.mockReset();
  h.getDbForRole.mockResolvedValue(makeQeDb());
});

describe('RAW_COLLECTION_RESOURCE', () => {
  it('maps every exposed collection to the BIAN resource that owns it', () => {
    expect(RAW_COLLECTION_RESOURCE).toEqual({
      party: 'customers',
      customerAgreementProcedure: 'customers',
      customerAuthenticationAssessment: 'customers',
      cardTransactionLog: 'transactions',
      paymentCardManagement: 'cards',
      fraudDiagnosisCase: 'fraudCases',
    });
  });
});

describe('authorizeRawDocumentAccess: unknown collection', () => {
  it('rejects a collection that is not in the map (default-deny)', async () => {
    const d = await authorizeRawDocumentAccess(serverDb, 'role', 'x', { role: 'manager' });
    expect(d).toMatchObject({ allowed: false, status: 400 });
    expect(h.can).not.toHaveBeenCalled();
  });
});

describe('authorizeRawDocumentAccess: staff roles (scope all)', () => {
  it('allows a staff role holding view on the owning resource', async () => {
    h.can.mockResolvedValue(true);
    const d = await authorizeRawDocumentAccess(serverDb, 'party', 'party-other', { role: 'security_auditor' });
    expect(d).toEqual({ allowed: true });
    expect(h.can).toHaveBeenCalledWith(serverDb, 'security_auditor', 'customers', 'view');
  });

  it('denies a staff role without view on the owning resource', async () => {
    h.can.mockResolvedValue(false);
    const d = await authorizeRawDocumentAccess(serverDb, 'customerAgreementProcedure', 'ca-other', { role: 'manager' });
    expect(d).toMatchObject({ allowed: false, status: 403, code: 'ACL_DENIED' });
  });

  it('denies merchant_officer, which holds no customers permission', async () => {
    h.can.mockResolvedValue(false);
    const d = await authorizeRawDocumentAccess(serverDb, 'party', OWN_PARTY, { role: 'merchant_officer' });
    expect(d).toMatchObject({ allowed: false, status: 403 });
  });

  it('checks the resource per collection, not one blanket permission', async () => {
    h.can.mockResolvedValue(true);
    await authorizeRawDocumentAccess(serverDb, 'cardTransactionLog', 't1', { role: 'level1_analyst' });
    expect(h.can).toHaveBeenCalledWith(serverDb, 'level1_analyst', 'transactions', 'view');
    await authorizeRawDocumentAccess(serverDb, 'paymentCardManagement', 'c1', { role: 'level1_analyst' });
    expect(h.can).toHaveBeenCalledWith(serverDb, 'level1_analyst', 'cards', 'view');
  });
});

describe('authorizeRawDocumentAccess: customer (scope own)', () => {
  const caller = { role: 'customer', partyRef: OWN_PARTY, sub: 'auth-own' };

  it('allows its own party document', async () => {
    const d = await authorizeRawDocumentAccess(serverDb, 'party', OWN_PARTY, caller);
    expect(d).toEqual({ allowed: true });
  });

  it('denies another party document', async () => {
    const d = await authorizeRawDocumentAccess(serverDb, 'party', 'party-other', caller);
    expect(d).toMatchObject({ allowed: false, status: 403, code: 'OWNERSHIP_DENIED' });
  });

  it('allows its own authentication assessment and denies another one', async () => {
    await expect(authorizeRawDocumentAccess(serverDb, 'customerAuthenticationAssessment', 'auth-own', caller))
      .resolves.toEqual({ allowed: true });
    await expect(authorizeRawDocumentAccess(serverDb, 'customerAuthenticationAssessment', 'auth-other', caller))
      .resolves.toMatchObject({ allowed: false, status: 403 });
  });

  it('allows its own agreement, resolved server-side from the party reference', async () => {
    await expect(authorizeRawDocumentAccess(serverDb, 'customerAgreementProcedure', OWN_AGREEMENT, caller))
      .resolves.toEqual({ allowed: true });
    await expect(authorizeRawDocumentAccess(serverDb, 'customerAgreementProcedure', 'ca-other', caller))
      .resolves.toMatchObject({ allowed: false, status: 403 });
  });

  it('allows an own transaction, card and case (self-service raw panels keep working)', async () => {
    h.getDbForRole.mockResolvedValue(makeQeDb({ ownsTxn: true, ownsCard: true, ownsCase: true }));
    await expect(authorizeRawDocumentAccess(serverDb, 'cardTransactionLog', 't1', caller))
      .resolves.toEqual({ allowed: true });
    await expect(authorizeRawDocumentAccess(serverDb, 'paymentCardManagement', 'c1', caller))
      .resolves.toEqual({ allowed: true });
    await expect(authorizeRawDocumentAccess(serverDb, 'fraudDiagnosisCase', 'f1', caller))
      .resolves.toEqual({ allowed: true });
  });

  it('denies a transaction, card or case belonging to someone else', async () => {
    h.getDbForRole.mockResolvedValue(makeQeDb({ ownsTxn: false, ownsCard: false, ownsCase: false }));
    for (const col of ['cardTransactionLog', 'paymentCardManagement', 'fraudDiagnosisCase']) {
      await expect(authorizeRawDocumentAccess(serverDb, col, 'other', caller))
        .resolves.toMatchObject({ allowed: false, status: 403, code: 'OWNERSHIP_DENIED' });
    }
  });

  it('never consults the staff ACL for an own-scope role (ownership is the authorization)', async () => {
    await authorizeRawDocumentAccess(serverDb, 'party', OWN_PARTY, caller);
    expect(h.can).not.toHaveBeenCalled();
  });

  it('denies when the caller has no party reference', async () => {
    const d = await authorizeRawDocumentAccess(serverDb, 'party', OWN_PARTY, { role: 'customer' });
    expect(d).toMatchObject({ allowed: false, status: 403 });
  });
});

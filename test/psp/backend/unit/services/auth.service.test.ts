/**
 * Unit tests: auth.service (FR-v1-05)
 * Source: backend/src/modules/identity/services/auth.service.ts
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { sessionSecret } from '../../../../../psp/backend/src/vendors/security/secrets';

// ESM namespaces are not spy-able, so mock fs and drive readFileSync through this stub.
const h = vi.hoisted(() => ({ readFileSync: vi.fn() }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: h.readFileSync };
});

import { loginUser, getDemoUsers, getCurrentSessionEpoch, bumpSessionEpoch } from '../../../../../psp/backend/src/modules/identity/services/auth.service';

function makeDb(user: Record<string, unknown> | null) {
  const findOneMock = vi.fn().mockResolvedValue(user);
  return {
    collection: vi.fn().mockReturnValue({
      findOne: findOneMock,
    }),
  } as any;
}

// getDemoUsers is DB-backed (not file-based): it queries customerAuthentication with a status/
// featured/role filter, then merchantAgreement for owners. This mock applies the status+featured
// filter to a seed and returns no merchants (the `merchantOwnerPartyReference` query → []).
function makeDemoDb(records: Record<string, unknown>[]) {
  return {
    collection: vi.fn(() => ({
      find: vi.fn((query: Record<string, unknown> = {}) => ({
        toArray: vi.fn().mockResolvedValue(
          'merchantOwnerPartyReference' in query
            ? []
            : records.filter((r) =>
                (!query.customerAuthenticationAccountStatus || r.customerAuthenticationAccountStatus === query.customerAuthenticationAccountStatus) &&
                (query.customerAuthenticationDemoFeatured === undefined || r.customerAuthenticationDemoFeatured === query.customerAuthenticationDemoFeatured),
              ),
        ),
      })),
    })),
  } as any;
}

beforeAll(() => {
  process.env.PSP_JWT_SECRET = 'test-secret-key';
  // v39 P4: the session is signed with its OWN derived key, not the platform root. Verifying with
  // the root would pass only if the separation had not happened.
  process.env.PSP_JWT_EXPIRES_IN = '1h';
});

describe('loginUser', () => {
  const validUser = {
    customerAuthenticationInstanceReference: 'usr-001',
    customerAuthenticationEmailAddress: 'sarah.chen@back.es',
    customerAuthenticationCredentialHash: bcrypt.hashSync('demo-password', 4),
    customerAuthenticationUserRole: 'level1_analyst',
    customerAuthenticationUserName: 'Sarah Chen',
    customerAuthenticationLoginDomain: 'local',
  };

  it('returns a signed JWT for valid credentials', async () => {
    const db = makeDb(validUser);
    const { token, user } = await loginUser(db, 'sarah.chen@back.es', 'demo-password', 'local');
    expect(typeof token).toBe('string');
    expect(user.email).toBe('sarah.chen@back.es');
    expect(user.role).toBe('level1_analyst');
  });

  it('JWT payload contains sub, email, role, name, domain', async () => {
    const db = makeDb(validUser);
    const { token } = await loginUser(db, 'sarah.chen@back.es', 'demo-password', 'local');
    const decoded = jwt.verify(token, sessionSecret()) as Record<string, unknown>;
    expect(decoded.sub).toBe('usr-001');
    expect(decoded.email).toBe('sarah.chen@back.es');
    expect(decoded.role).toBe('level1_analyst');
    expect(decoded.name).toBe('Sarah Chen');
    expect(decoded.domain).toBe('local');
  });

  it('throws 401 when user is not found', async () => {
    const db = makeDb(null);
    await expect(loginUser(db, 'unknown@back.es', 'demo-password', 'local'))
      .rejects.toMatchObject({ message: 'Invalid credentials', statusCode: 401 });
  });

  it('throws 401 for wrong password', async () => {
    const db = makeDb(validUser);
    await expect(loginUser(db, 'sarah.chen@back.es', 'wrong-pass', 'local'))
      .rejects.toMatchObject({ message: 'Invalid credentials', statusCode: 401 });
  });

  it('throws 401 when the login domain does not match', async () => {
    const db = makeDb(validUser);
    await expect(loginUser(db, 'sarah.chen@back.es', 'demo-password', 'corporate'))
      .rejects.toMatchObject({ message: 'Invalid credentials', statusCode: 401 });
  });

  it('response user object contains no credential hash', async () => {
    const db = makeDb(validUser);
    const { user } = await loginUser(db, 'sarah.chen@back.es', 'demo-password', 'local');
    expect((user as Record<string, unknown>).customerAuthenticationCredentialHash).toBeUndefined();
  });

  it('stamps epoch 0 when the record has no session epoch', async () => {
    const db = makeDb(validUser);
    const { token } = await loginUser(db, 'sarah.chen@back.es', 'demo-password', 'local');
    const decoded = jwt.verify(token, sessionSecret()) as Record<string, unknown>;
    expect(decoded.epoch).toBe(0);
  });

  it('stamps the record\'s current session epoch into the JWT', async () => {
    const db = makeDb({ ...validUser, customerAuthenticationSessionEpoch: 3 });
    const { token } = await loginUser(db, 'sarah.chen@back.es', 'demo-password', 'local');
    const decoded = jwt.verify(token, sessionSecret()) as Record<string, unknown>;
    expect(decoded.epoch).toBe(3);
  });
});

describe('session epoch (server-side logout invalidation)', () => {
  it('getCurrentSessionEpoch returns the stored epoch', async () => {
    const db = makeDb({ customerAuthenticationSessionEpoch: 5 });
    expect(await getCurrentSessionEpoch(db, 'usr-001')).toBe(5);
  });

  it('getCurrentSessionEpoch defaults to 0 when absent or record missing', async () => {
    expect(await getCurrentSessionEpoch(makeDb({}), 'usr-001')).toBe(0);
    expect(await getCurrentSessionEpoch(makeDb(null), 'nope')).toBe(0);
  });

  it('bumpSessionEpoch increments and returns the new epoch', async () => {
    // QE rejects findAndModify with a projection/fields option on an encrypted collection
    // ("findAndModify fields must be empty") but not returnDocument, so the impl stays atomic via a
    // single findOneAndUpdate(returnDocument:'before', no projection) and returns prev+1.
    const findOneAndUpdate = vi.fn().mockResolvedValue({ customerAuthenticationSessionEpoch: 1 });
    const db = { collection: vi.fn().mockReturnValue({ findOneAndUpdate }) } as any;
    const next = await bumpSessionEpoch(db, 'usr-001');
    expect(next).toBe(2);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { customerAuthenticationInstanceReference: 'usr-001' },
      { $inc: { customerAuthenticationSessionEpoch: 1 } },
      { returnDocument: 'before' },
    );
  });
});

describe('getDemoUsers', () => {
  // getDemoUsers reads plaintext name/email/role from the seed file (passwords stay
  // bcrypt-hashed and are never returned). Stub fs so the test is deterministic.
  const seed = [
    {
      customerAuthenticationUserName: 'Sarah Chen',
      customerAuthenticationEmailAddress: 'sarah.chen@back.es',
      customerAuthenticationUserRole: 'level1_analyst',
      customerAuthenticationCredentialHash: 'bcrypt-hash-must-not-leak',
      customerAuthenticationAccountStatus: 'active',
      customerAuthenticationDemoFeatured: true,
    },
    {
      customerAuthenticationUserName: 'Ad Hoc Tester',
      customerAuthenticationEmailAddress: 'tester@back.es',
      customerAuthenticationUserRole: 'level2_investigator',
      customerAuthenticationCredentialHash: 'bcrypt-hash-must-not-leak',
      customerAuthenticationAccountStatus: 'active',
      customerAuthenticationDemoFeatured: false,
    },
    {
      customerAuthenticationUserName: 'Disabled User',
      customerAuthenticationEmailAddress: 'disabled@back.es',
      customerAuthenticationUserRole: 'customer',
      customerAuthenticationCredentialHash: 'bcrypt-hash-must-not-leak',
      customerAuthenticationAccountStatus: 'disabled',
      customerAuthenticationDemoFeatured: true,
    },
  ];

  afterEach(() => {
    h.readFileSync.mockReset();
  });

  it('returns only active users, projected to name/email/role - no hash', async () => {
    const users = await getDemoUsers(makeDemoDb(seed));
    expect(users).toHaveLength(2); // disabled user excluded
    const sarah = users.find((u) => u.email === 'sarah.chen@back.es')!;
    expect(sarah.name).toBe('Sarah Chen');
    expect(sarah.role).toBe('level1_analyst');
    expect((sarah as Record<string, unknown>).customerAuthenticationCredentialHash).toBeUndefined();
  });

  it('featured=true returns only the curated featured roster', async () => {
    const users = await getDemoUsers(makeDemoDb(seed), { featured: true });
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('sarah.chen@back.es');
    expect(users[0].featured).toBe(true);
  });
});

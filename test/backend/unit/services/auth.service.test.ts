/**
 * Unit tests: auth.service (FR-v1-05)
 * Source: backend/src/services/auth.service.ts
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { loginUser, getDemoUsers } from '../../../../backend/src/services/auth.service';

function makeDb(user: Record<string, unknown> | null) {
  const findOneMock = vi.fn().mockResolvedValue(user);
  const toArrayMock = vi.fn().mockResolvedValue(user ? [user] : []);
  return {
    collection: vi.fn().mockReturnValue({
      findOne: findOneMock,
      find: vi.fn().mockReturnValue({ toArray: toArrayMock }),
    }),
  } as any;
}

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.JWT_EXPIRES_IN = '1h';
});

describe('loginUser', () => {
  const validUser = {
    partyAuthenticationInstanceReference: 'usr-001',
    partyAuthenticationUserEmailAddress: 'sarah.chen@back.es',
    partyAuthenticationCredentialHash: bcrypt.hashSync('demo-password', 4),
    partyAuthenticationUserRole: 'level1_analyst',
    partyAuthenticationUserName: 'Sarah Chen',
    partyAuthenticationLoginDomain: 'local',
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
    const decoded = jwt.verify(token, 'test-secret-key') as Record<string, unknown>;
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

  it('response user object contains no password hash', async () => {
    const db = makeDb(validUser);
    const { user } = await loginUser(db, 'sarah.chen@back.es', 'demo-password', 'local');
    expect((user as Record<string, unknown>).partyAuthenticationCredentialHash).toBeUndefined();
  });
});

describe('getDemoUsers', () => {
  it('returns name, email, role - no password hash', async () => {
    const raw = {
      partyAuthenticationUserName: 'Sarah Chen',
      partyAuthenticationUserEmailAddress: 'sarah.chen@back.es',
      partyAuthenticationUserRole: 'level1_analyst',
      partyAuthenticationCredentialHash: 'bcrypt-hash-must-not-leak',
    };
    const db = {
      collection: vi.fn().mockReturnValue({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([raw]) }),
      }),
    } as any;

    const users = await getDemoUsers(db);
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('sarah.chen@back.es');
    expect(users[0].name).toBe('Sarah Chen');
    expect(users[0].role).toBe('level1_analyst');
    expect((users[0] as Record<string, unknown>).partyAuthenticationCredentialHash).toBeUndefined();
  });
});

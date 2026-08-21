/**
 * Unit tests: LocalKeyProvider (ADR-036 FS-first key management)
 * Source: backend/src/modules/identity/services/oauthKeyProviders/localKeyProvider.ts
 *
 * Covers: active signing key, rotation with grace-period verification of the
 * previous key, JWKS key set, revoke rules, and keypair import validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { LocalKeyProvider } from '../../../../../psp/backend/src/modules/identity/services/oauthKeyProviders/localKeyProvider';

let storeDir: string;

function signVerifiable(provider: LocalKeyProvider): Promise<{ kid: string; token: string }> {
  const kid = provider.getKid();
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'x', iat: 1 })).toString('base64url');
  const data = `${header}.${payload}`;
  return provider.sign(Buffer.from(data)).then((sig) => ({ kid, token: `${data}.${sig.toString('base64url')}` }));
}

function verify(pubPem: string, token: string): boolean {
  const [h, p, s] = token.split('.');
  return crypto.createVerify('SHA256').update(`${h}.${p}`).verify(pubPem, Buffer.from(s, 'base64url'));
}

beforeEach(() => {
  storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-keys-'));
  process.env.NODE_ENV = 'development'; // allow auto-generate when no key exists
});

afterEach(() => {
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe('LocalKeyProvider', () => {
  it('auto-generates private.pem + public.pem and signs verifiably', async () => {
    const p = await LocalKeyProvider.create(storeDir);
    expect(fs.existsSync(path.join(storeDir, 'private.pem'))).toBe(true);
    expect(fs.existsSync(path.join(storeDir, 'public.pem'))).toBe(true);

    const { kid, token } = await signVerifiable(p);
    const pubPem = await p.getPublicPemByKid(kid);
    expect(pubPem).toBeTruthy();
    expect(verify(pubPem!, token)).toBe(true);
  });

  it('derives kid deterministically from the public key', async () => {
    const p = await LocalKeyProvider.create(storeDir);
    const pem = fs.readFileSync(path.join(storeDir, 'public.pem'), 'utf8');
    const der = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }) as Buffer;
    const expected = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
    expect(p.getKid()).toBe(expected);
  });

  it('rotate() activates a new key and keeps the old one verifiable during grace', async () => {
    const p = await LocalKeyProvider.create(storeDir);
    const old = await signVerifiable(p);

    const { kid: newKid } = await p.rotate();
    expect(newKid).not.toBe(old.kid);
    expect(p.getKid()).toBe(newKid);

    // New tokens sign with the new key
    const fresh = await signVerifiable(p);
    expect(fresh.kid).toBe(newKid);

    // Old token still verifiable via the deprecated (grace) key
    const oldPub = await p.getPublicPemByKid(old.kid);
    expect(oldPub).toBeTruthy();
    expect(verify(oldPub!, old.token)).toBe(true);

    // JWKS exposes both, exactly one active
    const keys = await p.listPublicKeys();
    expect(keys.map((k) => k.kid).sort()).toEqual([old.kid, newKid].sort());
    expect(keys.filter((k) => k.status === 'active')).toHaveLength(1);
    expect(keys.find((k) => k.kid === newKid)!.status).toBe('active');
    expect(keys.find((k) => k.kid === old.kid)!.status).toBe('deprecated');
  });

  it('revoke() removes a deprecated key but refuses the active key', async () => {
    const p = await LocalKeyProvider.create(storeDir);
    const old = await signVerifiable(p);
    await p.rotate();

    await expect(p.revoke(p.getKid())).rejects.toThrow(/active/i);

    await p.revoke(old.kid);
    expect(await p.getPublicPemByKid(old.kid)).toBeNull();
    const keys = await p.listPublicKeys();
    expect(keys.map((k) => k.kid)).not.toContain(old.kid);
  });

  it('importKeypair() rejects a mismatched public/private pair', async () => {
    const p = await LocalKeyProvider.create(storeDir);
    const a = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const b = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await expect(p.importKeypair(a.privateKey as string, b.publicKey as string)).rejects.toThrow(/does not match/i);
  });

  it('importKeypair() activates a valid external pair and deprecates the previous key', async () => {
    const p = await LocalKeyProvider.create(storeDir);
    const prev = await signVerifiable(p);

    const kp = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const { kid } = await p.importKeypair(kp.privateKey as string, kp.publicKey as string);
    expect(p.getKid()).toBe(kid);
    expect(kid).not.toBe(prev.kid);
    // Previous key still verifiable during grace
    expect(await p.getPublicPemByKid(prev.kid)).toBeTruthy();
  });
});

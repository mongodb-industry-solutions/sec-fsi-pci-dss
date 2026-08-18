// v37 P0.4/P0.6: the kill switch must default off, and only variables needed before a DB exists
// may live in the environment.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ENV_EXAMPLE = resolve(__dirname, '../../../../backend/src/vendors/setup/env.example');

async function loadConfig(overrides: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const mod = await import('../../../../backend/src/config');
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return (mod as { config: { bankcore: Record<string, unknown> } }).config.bankcore;
}

describe('v37 P0.4/P0.6: bankcore configuration', () => {
  it('the kill switch defaults to off', async () => {
    const bankcore = await loadConfig({ PSP_BANKCORE_ENABLED: undefined });
    expect(bankcore.enabled).toBe(false);
  });

  it('only the literal string true enables it', async () => {
    expect((await loadConfig({ PSP_BANKCORE_ENABLED: 'true' })).enabled).toBe(true);
    expect((await loadConfig({ PSP_BANKCORE_ENABLED: 'yes' })).enabled).toBe(false);
    expect((await loadConfig({ PSP_BANKCORE_ENABLED: '' })).enabled).toBe(false);
  });

  it('the bank connection falls back to the PSP cluster', async () => {
    const bankcore = await loadConfig({
      PSP_BANKCORE_DB_URI: undefined,
      MONGODB_URI: 'mongodb://example/psp',
    });
    expect(bankcore.dbUri).toBe('mongodb://example/psp');
  });

  it('the bank database is always a separate database from the PSP one', async () => {
    // The literal default cannot be asserted here: the repo .env sets PSP_BANKCORE_DB_NAME, and
    // dotenv reinjects it whatever the test deletes. The invariant is what matters anyway, since
    // sharing one database would put the bank's ledger back inside the PSP's.
    vi.resetModules();
    const { config } = await import('../../../../backend/src/config');
    expect(config.bankcore.dbName).toBeTruthy();
    expect(config.bankcore.dbName).not.toBe(config.mongodb.dbName);
  });

  it('env.example documents bankcoredb as the default database', () => {
    expect(readFileSync(ENV_EXAMPLE, 'utf8')).toContain('PSP_BANKCORE_DB_NAME=bankcoredb');
  });

  it('the keyvault namespace is the PSP KMS namespace, never the application database', async () => {
    // Sharing the DEKs means sharing the KMS namespace. Pointing at <MONGODB_DB_NAME>.keyVault
    // instead would silently give bankcore an empty key vault of its own.
    vi.resetModules();
    const { config } = await import('../../../../backend/src/config');
    const { getKmsConfig } = await import('../../../../backend/src/vendors/encryption/kms');
    expect(config.bankcore.keyVaultNamespace).toBe(getKmsConfig().namespace);
    expect(config.bankcore.keyVaultNamespace).not.toBe(`${config.mongodb.dbName}.keyVault`);
  });

  it('the keyvault namespace follows the PSP KMS variables when they are set', async () => {
    const bankcore = await loadConfig({
      PSP_BANKCORE_KEY_VAULT_NAMESPACE: undefined,
      PSP_KMS_KEY_VAULT_DATABASE: 'vaultdb',
      PSP_KMS_KEY_VAULT_COLLECTION: 'keys',
    });
    expect(bankcore.keyVaultNamespace).toBe('vaultdb.keys');
  });

  it('crypt_shared defaults to the PSP path, since both services must load the same version', async () => {
    const bankcore = await loadConfig({
      PSP_BANKCORE_CRYPT_SHARED_LIB_PATH: undefined,
      MONGODB_CRYPT_SHARED_LIB_PATH: '/opt/mongo_crypt_v1.so',
    });
    expect(bankcore.cryptSharedLibPath).toBe('/opt/mongo_crypt_v1.so');
  });

  it('consent mode defaults to automatic so the demo is never blocked', async () => {
    expect((await loadConfig({ PSP_BANKCORE_CONSENT_MODE: undefined })).consentMode).toBe('automatic');
    expect((await loadConfig({ PSP_BANKCORE_CONSENT_MODE: 'manual' })).consentMode).toBe('manual');
  });

  it('the bank URL and port default to the local private service', async () => {
    const bankcore = await loadConfig({ PSP_BANKCORE_BASE_URL: undefined, PSP_BANKCORE_PORT: undefined });
    expect(bankcore.baseUrl).toBe('http://localhost:8083');
    expect(bankcore.port).toBe(8083);
  });

  it('every bankcore variable is documented in env.example and PSP_ prefixed', () => {
    const example = readFileSync(ENV_EXAMPLE, 'utf8');
    for (const name of [
      'PSP_BANKCORE_ENABLED', 'PSP_BANKCORE_BASE_URL', 'PSP_BANKCORE_DB_URI', 'PSP_BANKCORE_DB_NAME',
      'PSP_BANKCORE_KEY_VAULT_NAMESPACE', 'PSP_BANKCORE_CRYPT_SHARED_LIB_PATH',
      'PSP_BANKCORE_CONSENT_MODE', 'PSP_BANKCORE_PORT', 'PSP_BANKCORE_EVENT_BUS_ENGINE',
    ]) {
      expect(example, `${name} must be documented`).toContain(`${name}=`);
    }
    // No bare BANKCORE_* variable: the whole platform stays under one namespace.
    expect(example).not.toMatch(/^BANKCORE_/m);
  });

  it('the public URL is documented and separate from the private one', () => {
    // Decision revised: the bank publishes its Open Banking docs so the API can be reviewed and
    // exercised, while the PSP keeps reaching it in-cluster. Operating on the API needs a registered
    // TPP's credentials, so a public docs surface opens nothing.
    const example = readFileSync(ENV_EXAMPLE, 'utf8');
    expect(example).toContain('PSP_BANKCORE_PUBLIC_URL=');
    expect(example).toContain('PSP_BANKCORE_BASE_URL=');
  });
});

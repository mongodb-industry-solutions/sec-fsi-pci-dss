// v37 P7.4a: the PSP is provably free of cardholder data.
//
// The point of moving the vault is descoping, and descoping is a claim about the whole codebase, not about
// one file. Asserting it beats trusting it: if someone reintroduces a PAN field, a vault collection or a
// local derivation, the claim quietly stops being true and nothing else in the suite notices.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(__dirname, '../../../..');
const BACKEND_SRC = resolve(ROOT, 'backend/src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

// Line comments first: one containing `/*` would open a fake block comment and swallow real code, which in
// a negative assertion passes by deleting what it should check.
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const FILES = sourceFiles(BACKEND_SRC);

describe('no PSP collection holds a card number', () => {
  it('the issuer vault is not created, mapped or indexed by the PSP', () => {
    const offenders = FILES.filter((file) => /cardIssuerVault/.test(code(file)))
      .map((file) => file.slice(ROOT.length + 1));
    expect(offenders, 'the vault belongs to the bank').toEqual([]);
  });

  it('no encrypted fields map declares a card number path', () => {
    const map = code(resolve(BACKEND_SRC, 'vendors/encryption/encryptedFieldsMaps.ts'));
    expect(map).not.toMatch(/path:\s*'paymentCardNumber'/);
    // The keys that encrypted it are gone too, so nothing can be written back under them by accident.
    expect(map).not.toContain('vaultPan');
    expect(map).not.toContain('vaultServiceCode');
  });

  it('no data encryption key is provisioned for a PAN', () => {
    const keyVault = code(resolve(BACKEND_SRC, 'vendors/encryption/keyVault.ts'));
    expect(keyVault).not.toContain('DEK-vault-pan');
    expect(keyVault).not.toContain('DEK-vault-service-code');
    expect(keyVault).not.toContain('vaultPan');
  });

  it('the card model stores BIN and last four, and no full number', () => {
    const model = code(resolve(BACKEND_SRC, 'modules/customer/models/paymentCard.model.ts'));
    expect(model).toContain('paymentCardBin');
    expect(model).toContain('paymentCardLast4');
    // A field by this name on a PSP record would be the whole regression in one line.
    expect(model).not.toMatch(/paymentCardNumber\s*[?]?:/);
  });

  it('no seeder writes a card number', () => {
    const seeders = FILES.filter((file) => file.includes(`${'vendors'}${require('path').sep}seed`));
    const offenders = seeders
      .filter((file) => /paymentCardNumber\s*:/.test(code(file)))
      .map((file) => file.slice(ROOT.length + 1));
    expect(offenders, 'a seeder that writes a PAN puts the PSP back in scope').toEqual([]);
  });
});

describe('BIN and last four remain the display source of truth', () => {
  it('the masked display is derived from them rather than from a stored number', () => {
    const model = code(resolve(BACKEND_SRC, 'modules/customer/models/paymentCard.model.ts'));
    expect(model).toContain('deriveMaskedPan');
    // Derived from the truncated fields, which is what makes the display safe by construction.
    const derive = /export function deriveMaskedPan[\s\S]{0,600}/.exec(model)?.[0] ?? '';
    expect(derive).toMatch(/paymentCardLast4|paymentCardBin/);
  });

  it('the descoping seeder writes BIN and last four, never a number', () => {
    const seeder = code(resolve(BACKEND_SRC, 'vendors/seed/seedCardDescoping.ts'));
    expect(seeder).toContain('paymentCardLast4');
    expect(seeder).toContain('paymentCardBin');
    expect(seeder).not.toMatch(/paymentCardNumber/);
  });
});

describe('cardholder data is reached only by asking the issuer', () => {
  it('reveal, exact-PAN search and value derivation all go through the issuer client', () => {
    const client = code(resolve(BACKEND_SRC, 'providers/card-issuer/services/bankcoreCardIssuer.client.ts'));
    for (const path of ['/pan-reveals', '/v1/cards/searches', '/verification-values']) {
      expect(client, `${path} must be requested from the issuer`).toContain(path);
    }
  });

  it('the PSP holds no key it could derive a verification value with', () => {
    // The derivation needs the issuer key. Keeping a local copy would recreate the scope that was removed.
    const provisioning = code(resolve(BACKEND_SRC, 'vendors/setup/provisionDEKs.ts'));
    expect(provisioning).not.toContain('provisionCardIssuerCvk');
  });

  it('no PSP service reads a card number out of the database', () => {
    const offenders = FILES
      .filter((file) => /collection[^\n]*cardIssuerVault|findOne\([^)]*paymentCardNumber/.test(code(file)))
      .map((file) => file.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });
});

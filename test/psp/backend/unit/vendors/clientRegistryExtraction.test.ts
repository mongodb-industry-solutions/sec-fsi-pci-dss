// v39 P2: the OAuth client registry and the API keys are collections of their own.
//
// The point of the phase is not that two collections exist. It is that nothing reaches a credential
// THROUGH the commercial record any more, because that coupling is what made the registry
// unmovable: every consumer had to know the shape of a merchant agreement to verify a client.
//
// Asserted against the source, so a reintroduced nested query fails here rather than being noticed
// in review, and against the fixture, so the seeded population still produces what it produced.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, relative, sep } from 'path';

const SRC = resolve(__dirname, '../../../../../psp/backend/src');
const DATA = resolve(__dirname, '../../../../../psp/backend/data');

function sourceFiles(exclude: string[] = []): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      const rel = relative(SRC, full).split(sep).join('/');
      if (exclude.some((prefix) => rel.startsWith(prefix))) continue;
      found.push({ path: rel, text: readFileSync(full, 'utf8') });
    }
  };
  walk(SRC);
  return found;
}

/** Comments explain the old shape on purpose; a rule about code must not read them. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('v39 P2: nothing reaches a credential through the merchant record', () => {
  it('has no query that traverses the merchant document to find a client', () => {
    // The exact shape that existed in five places across four modules. One of them coming back is
    // the coupling coming back.
    const offenders = sourceFiles()
      .filter((file) => /['"]merchantOAuthClient\./.test(stripComments(file.text)))
      .map((file) => file.path);
    expect(offenders, `nested client query in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('has no positional write into an embedded key array', () => {
    const offenders = sourceFiles()
      .filter((file) => /merchantApiKeys\.\$/.test(stripComments(file.text)))
      .map((file) => file.path);
    expect(offenders, `positional key write in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('keeps the credential fields off the merchant record type', () => {
    const model = readFileSync(resolve(SRC, 'modules/gateway/models/merchantAgreement.model.ts'), 'utf8');
    const code = stripComments(model);
    expect(code).not.toMatch(/merchantOAuthClient\??:/);
    expect(code).not.toMatch(/merchantApiKeys\??:/);
  });

  it('routes every client read through the registry rather than a collection handle', () => {
    // The five call sites the plan names. Each must import the registry; none may name the client
    // collection directly, because a second access path is how two callers end up disagreeing.
    const callSites = [
      'modules/identity/services/oauth.service.ts',
      'modules/identity/services/ciba.service.ts',
      'modules/identity/services/oauthAudit.service.ts',
      'vendors/middleware/validateMerchantToken.ts',
      'modules/gateway/services/merchantOAuth.service.ts',
    ];
    for (const path of callSites) {
      const text = readFileSync(resolve(SRC, path), 'utf8');
      expect(text, `${path} does not use the client registry`).toMatch(/oauthClientRegistry\.service/);
      expect(stripComments(text), `${path} names the collection directly`).not.toMatch(/OAUTH_CLIENT_COLLECTION/);
    }
  });

  it('leaves the identity module with no dependency on the merchant schema for audit', () => {
    // The owner's display name is denormalized onto the client, so the audit path reads no
    // commercial collection at all. That is what makes this code portable to another authority.
    const audit = readFileSync(resolve(SRC, 'modules/identity/services/oauthAudit.service.ts'), 'utf8');
    expect(stripComments(audit)).not.toMatch(/MERCHANT_AGREEMENT_COLLECTION/);
  });
});

describe('v39 P2: the seeded population is unchanged in what it grants', () => {
  const merchants = JSON.parse(readFileSync(resolve(DATA, 'merchants.json'), 'utf8')) as Array<{
    merchantName: string;
    merchantOAuthClient?: { oauthClientId: string; oauthScopes: string[]; oauthClientStatus: string };
  }>;

  it('still seeds exactly two OAuth clients, and a third merchant with none', () => {
    // The third merchant having no client is a demo case, not an omission: it is what an operator
    // sees before onboarding issues one. Gaining one silently would delete that case.
    const withClient = merchants.filter((m) => m.merchantOAuthClient);
    expect(withClient).toHaveLength(2);
    expect(merchants).toHaveLength(3);
  });

  it('keeps every seeded client active with a stable id', () => {
    for (const merchant of merchants) {
      if (!merchant.merchantOAuthClient) continue;
      expect(merchant.merchantOAuthClient.oauthClientStatus).toBe('active');
      // The id is what a relying party has configured, and the seeded ones are deliberately readable
      // rather than random. Changing one silently logs a merchant out, so the shape is pinned.
      expect(merchant.merchantOAuthClient.oauthClientId).toMatch(/^[A-Za-z0-9-]{36}$/);
      expect(merchant.merchantOAuthClient.oauthScopes.length).toBeGreaterThan(0);
    }
  });
});

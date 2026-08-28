// v37 P0.7: every collection has one documented owner, and the transition state is explicit.
//
// Two different questions, which the first version of this suite conflated:
//   · WHO OWNS a collection in the target design (that is the split, and it is a decision);
//   · WHERE IT PHYSICALLY LIVES today (that is progress, and it changes phase by phase).
// Reading "moves to bankcore" as "has moved" is how someone later concludes a phase is done. So each
// bankcore-owned collection carries the phase that moves it and whether that has happened, and the
// physical checks are derived from that flag rather than from the ownership set.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(__dirname, '../../../../..');
const BACKEND_SRC = resolve(ROOT, 'psp/backend/src');
const EVENTBUS_SRC = resolve(ROOT, 'packages/eventbus/src');
const PSP_SETUP = resolve(ROOT, 'psp/backend/src/vendors/setup');
const BANK_SETUP = resolve(ROOT, 'bank/backend/src/vendors/setup');

interface BankcoreOwned {
  // Phase that physically moves it, per the plan.
  phase: string;
  // Set when the collection is RETIRED rather than moved: the bank has an equivalent under a different
  // name, so no collection of this name should exist on either side. Naming the successor is what stops a
  // reader concluding the record was simply lost.
  replacedBy?: string;
  // True once the PSP no longer creates it and bankcore does.
  moved: boolean;
}

// Collections the BANK owns in the target design.
const OWNED_BY_BANKCORE: Record<string, BankcoreOwned> = {
  // Moved: the audit trail of a balance mutation belongs wherever the balance does, and the PSP no longer
  // creates it, writes it or reads it.
  balanceCreditLog: { phase: 'P2.5', moved: true },
  cardIssuerVault: { phase: 'P7', moved: true },
  // Retired rather than moved: the bank's `periodicPaymentProcedure` is the standard's own resource for a
  // standing order, so there is no collection of this name to create anywhere. `replacedBy` says which.
  recurringMandateProcedure: { phase: 'P3.9', moved: false, replacedBy: 'periodicPaymentProcedure' },
};

// Collections the PSP owns. `domainEvent`, `counters` and `idempotencyKey` are here because the PSP
// keeps its OWN instance; bankcore has separate ones in its own database.
const OWNED_BY_PSP = new Set([
  // v39 P2: the OAuth client registry and the integration keys, extracted out of
  // merchantAgreementProcedure. They stay on the PSP side for now; the extraction that moves them to
  // the identity authority is a later phase, and this list is about the v37 bank split.
  'oauthClient', 'apiKey',
  'paymentExecutionProcedure', 'paymentOrderProcedure', 'cardTransactionLog', 'checkoutSessionLog',
  'paymentLinkRecord',
  // Stays as a linked account record: it loses the stored balance, not its home.
  'payoutAccountArrangement', 'counterpartyArrangement',
  'paymentCardManagement', 'cardEtokenProcedure',
  // Stays: it is the ACQUIRER's record of an authorisation it requested, including the PSP-policy declines
  // (a deactivated card-on-file) that never reach an issuer at all. The bank has no equivalent collection,
  // so this is the only authorisation record on the platform and moving it would delete information.
  'cardAuthorizationRecord',
  // Stays: it dedupes ACCEPTED card instruments to feed the shared-card fraud signal, which is a PSP
  // concern. The bank's issuedCardRegistry is a different record: what this issuer put in customers' hands.
  'paymentCardRegistry',
  // Stays despite the name: it holds transaction-monitoring risk FLAGS, not a credit score, and the fraud
  // investigation reads them. The bank's creditAssessmentState is the actual assessment.
  'customerCreditRatingState',
  'paymentRequestProcedure', 'paymentRequestEvent', 'qrPaymentRepresentation', 'rtpAliasDirectoryCache',
  'party', 'customerAuthenticationAssessment', 'authenticationDomain', 'role',
  'partyAuthenticationKey', 'partyAuthorizationCode', 'partyIssuedToken',
  'partyBackchannelAuthentication', 'partyEnrolledCredential', 'partyAuthenticationAssessment',
  'consentAgreement', 'partyAuthConsent', 'consentAccessLog',
  'customerAgreementProcedure', 'merchantAgreementProcedure', 'merchantAgreementEvents',
  'fraudDiagnosisCase', 'fraudDiagnosisCaseEvents', 'fraudDiagnosisCustomerQuestion',
  'externalProviderArrangement', 'externalProviderArrangementPortfolio',
  'externalProviderArrangementActionLog', 'capabilityModuleConfiguration',
  'businessProcessEvent', 'complianceProcessEvent', 'domainEvent',
  'merchantWebhookDeliveryLog',
  'notification', 'demoTeamContact', 'counters', 'idempotencyKey',
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const COLLECTION_CONSTANT = /\b([A-Z0-9_]*COLLECTION[A-Z0-9_]*)\s*=\s*'([a-zA-Z]+)'/g;

// Maps every `*_COLLECTION` constant to the collection it names, across both services and the shared
// package. Setup code refers to a collection either by its constant or by a bare literal, so resolving
// the constants is what makes "does this setup create X" answerable without a hand-kept hint list.
function constantsByCollection(): Map<string, Set<string>> {
  const byCollection = new Map<string, Set<string>>();
  for (const root of [BACKEND_SRC, EVENTBUS_SRC, resolve(ROOT, 'bank/backend/src')]) {
    for (const file of sourceFiles(root)) {
      for (const match of readFileSync(file, 'utf8').matchAll(COLLECTION_CONSTANT)) {
        const [, constant, collection] = match;
        if (!byCollection.has(collection)) byCollection.set(collection, new Set());
        byCollection.get(collection)!.add(constant);
      }
    }
  }
  return byCollection;
}

const CONSTANTS = constantsByCollection();

// Declared in the PSP sources or the shared event bus. bankcore's own new collections are not part of
// the split: the split answers "what happens to what the PSP has".
function declaredCollections(): Set<string> {
  const found = new Set<string>();
  for (const file of [...sourceFiles(BACKEND_SRC), ...sourceFiles(EVENTBUS_SRC)]) {
    for (const match of readFileSync(file, 'utf8').matchAll(COLLECTION_CONSTANT)) found.add(match[2]);
  }
  return found;
}

// What a setup directory actually CREATES, as opposed to merely names.
//
// Setup also names a collection in order to DROP it: for a legacy rename, or for one that moved to the bank.
// Counting that as creation would report a collection the PSP deletes as one it owns, which is the same
// imprecision the ownership matrix gate had. So the name has to sit in a creating position.
const CREATING_PREFIXES = ['createCollection(', 'name: ', 'ensureIndexes(db, '];

function namedForCreation(text: string, token: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(token, from);
    if (at === -1) return false;
    const before = text.slice(Math.max(0, at - 24), at);
    const after = text.slice(at + token.length, at + token.length + 3);
    if (CREATING_PREFIXES.some((prefix) => before.endsWith(prefix))) return true;
    // A computed object key, which is how the encrypted-fields map declares its collections. The brackets
    // have to be BOTH sides: `['balanceCreditLog', ...]` is an array of names to drop, not a declaration,
    // and treating a bare `[` as creation is what made the drop list read as ownership.
    if (before.endsWith('[') && after.startsWith(']:')) return true;
    from = at + token.length;
  }
}

function setupCreates(setupDir: string, collection: string): boolean {
  const constants = CONSTANTS.get(collection) ?? new Set<string>();
  for (const file of sourceFiles(setupDir)) {
    const text = readFileSync(file, 'utf8');
    if (namedForCreation(text, `'${collection}'`)) return true;
    for (const constant of constants) if (namedForCreation(text, constant)) return true;
  }
  return false;
}


describe('v37 P0.7: documented ownership', () => {
  it('every declared collection has exactly one owner', () => {
    const unlisted: string[] = [];
    const both: string[] = [];
    for (const name of declaredCollections()) {
      const bank = name in OWNED_BY_BANKCORE;
      const psp = OWNED_BY_PSP.has(name);
      if (bank && psp) both.push(name);
      if (!bank && !psp) unlisted.push(name);
    }
    expect(unlisted, 'collections with undocumented ownership').toEqual([]);
    expect(both, 'collections declared on both sides').toEqual([]);
  });

  it('the split declares no collection the sources do not', () => {
    // A collection whose move is done no longer has a PSP constant, which is the point of moving it. Only
    // the ones still expected here have to be found.
    const declared = declaredCollections();
    const stillHere = Object.entries(OWNED_BY_BANKCORE)
      .filter(([, o]) => !o.moved && !o.replacedBy)
      .map(([name]) => name);
    const stale = [...stillHere, ...OWNED_BY_PSP].filter((name) => !declared.has(name));
    expect(stale, 'split entries with no constant in the sources').toEqual([]);
  });

  it('the ledger audit log and the issuer vault belong to the bank', () => {
    for (const name of ['balanceCreditLog', 'cardIssuerVault']) {
      expect(OWNED_BY_BANKCORE[name], `${name} must be bank owned`).toBeTruthy();
    }
  });

  it('the PSP keeps the acquirer\'s authorisation record, which the bank has no equivalent of', () => {
    // The plan said cardAuthorizationRecord moves in P7. It must not. It records what the PSP ASKED and its
    // own pre-issuer policy decisions: a decline for a deactivated card-on-file never reaches the issuer, so
    // the bank could not hold it. The bank creates no collection of this name, which makes this the only
    // authorisation record on the platform.
    expect(OWNED_BY_PSP.has('cardAuthorizationRecord')).toBe(true);
    expect('cardAuthorizationRecord' in OWNED_BY_BANKCORE).toBe(false);
  });

  it('a retired collection exists on neither side, and names its successor', () => {
    for (const [name, owned] of Object.entries(OWNED_BY_BANKCORE)) {
      if (!owned.replacedBy) continue;
      expect(setupCreates(PSP_SETUP, name), `${name} is retired but the PSP still creates it`).toBe(false);
      expect(setupCreates(BANK_SETUP, name), `${name} is retired but the bank creates it`).toBe(false);
      // The successor must actually exist, or "retired" is just "deleted with a note".
      expect(setupCreates(BANK_SETUP, owned.replacedBy), `${owned.replacedBy} must exist at the bank`).toBe(true);
    }
  });

  it('the PSP keeps its risk-flag store, which is not a credit assessment', () => {
    // The plan said customerCreditRatingState moves in P8. It must not: the record holds
    // transaction-monitoring classification flags that the fraud case detail reads, and fraud stays at the
    // PSP. What moved is the ASSESSMENT, which the bank can make because it holds the evidence.
    expect(OWNED_BY_PSP.has('customerCreditRatingState')).toBe(true);
    expect('customerCreditRatingState' in OWNED_BY_BANKCORE).toBe(false);
  });

  it('the PSP keeps its own card registry, which is not the issuer registry', () => {
    // The plan said paymentCardRegistry moves in P7. It must not: the PSP's copy carries the holder count
    // that the fraud engine reads as a shared-card signal, and fraud detection stays at the PSP. The bank's
    // equivalent is a separate collection under a separate name, so neither shadows the other.
    expect(OWNED_BY_PSP.has('paymentCardRegistry')).toBe(true);
    expect('paymentCardRegistry' in OWNED_BY_BANKCORE).toBe(false);
  });

  it('payoutAccountArrangement stays, as a linked account record without a balance', () => {
    // The bank owns a new accountArrangement; the PSP keeps the link every consumer already reads.
    expect(OWNED_BY_PSP.has('payoutAccountArrangement')).toBe(true);
    expect('payoutAccountArrangement' in OWNED_BY_BANKCORE).toBe(false);
  });

  it('identity and the acceptance token vault stay at the PSP', () => {
    // The user belongs to the PSP and the acceptance-side vault holds no PAN, so neither moves.
    for (const name of ['party', 'customerAuthenticationAssessment', 'cardEtokenProcedure']) {
      expect(OWNED_BY_PSP.has(name), `${name} must stay`).toBe(true);
    }
  });
});

describe('v37 P0.7: physical location matches the declared transition state', () => {
  it('a collection marked as moved is gone from the PSP setup and present in the bank setup', () => {
    const wrong: string[] = [];
    for (const [name, { phase, moved }] of Object.entries(OWNED_BY_BANKCORE)) {
      if (!moved) continue;
      if (setupCreates(PSP_SETUP, name)) {
        wrong.push(`${name}: marked moved in ${phase} but the PSP setup still creates it`);
      }
      if (!setupCreates(BANK_SETUP, name)) {
        wrong.push(`${name}: marked moved in ${phase} but the bank setup does not create it`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('a collection not yet moved is still created by the PSP, so nothing is left undeclared', () => {
    // This is the defect that prompted the check: cardAuthorizationRecord was owned by nobody's setup
    // and got created implicitly by its first insert, with no indexes and no --reset path.
    const undeclared: string[] = [];
    for (const [name, { moved, replacedBy }] of Object.entries(OWNED_BY_BANKCORE)) {
      // A retired collection is created by nobody on purpose, which the check above covers instead.
      if (moved || replacedBy) continue;
      if (!setupCreates(PSP_SETUP, name)) {
        undeclared.push(`${name}: not moved yet and no setup declares it`);
      }
    }
    expect(undeclared).toEqual([]);
  });

  it('every PSP-owned collection is created by the PSP setup', () => {
    // Two exceptions, both by construction rather than omission.
    const notInSetup = new Set([
      // Created by the QE collection helper from the encryptedFieldsMaps, not by name.
      'cardEtokenProcedure',
      // The shared event bus creates its own store on first append.
      'domainEvent',
    ]);
    const undeclared = [...OWNED_BY_PSP]
      .filter((name) => !notInSetup.has(name))
      .filter((name) => !setupCreates(PSP_SETUP, name));
    expect(undeclared).toEqual([]);
  });

  it('the bank creates what P2 already moved', () => {
    for (const name of ['accountArrangement', 'accountHolder', 'accountMovement', 'balanceCreditLog']) {
      expect(setupCreates(BANK_SETUP, name), `${name} must exist in the bank setup`).toBe(true);
    }
  });
});

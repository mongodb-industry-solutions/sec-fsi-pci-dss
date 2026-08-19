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

const ROOT = resolve(__dirname, '../../../..');
const BACKEND_SRC = resolve(ROOT, 'backend/src');
const EVENTBUS_SRC = resolve(ROOT, 'packages/eventbus/src');
const PSP_SETUP = resolve(ROOT, 'backend/src/vendors/setup');
const BANK_SETUP = resolve(ROOT, 'bankcore/src/vendors/setup');

interface BankcoreOwned {
  // Phase that physically moves it, per the plan.
  phase: string;
  // True once the PSP no longer creates it and bankcore does.
  moved: boolean;
}

// Collections the BANK owns in the target design.
const OWNED_BY_BANKCORE: Record<string, BankcoreOwned> = {
  // The bank already creates it, and the PSP copy goes when its credit endpoint does.
  balanceCreditLog: { phase: 'P2.5', moved: false },
  cardIssuerVault: { phase: 'P7', moved: true },
  cardAuthorizationRecord: { phase: 'P7', moved: false },
  customerCreditRatingState: { phase: 'P8', moved: false },
  recurringMandateProcedure: { phase: 'P3.9', moved: false },
};

// Collections the PSP owns. `domainEvent`, `counters` and `idempotencyKey` are here because the PSP
// keeps its OWN instance; bankcore has separate ones in its own database.
const OWNED_BY_PSP = new Set([
  'paymentExecutionProcedure', 'paymentOrderProcedure', 'cardTransactionLog', 'checkoutSessionLog',
  'paymentLinkRecord',
  // Stays as a linked account record: it loses the stored balance, not its home.
  'payoutAccountArrangement', 'counterpartyArrangement',
  'paymentCardManagement', 'cardEtokenProcedure',
  // Stays: it dedupes ACCEPTED card instruments to feed the shared-card fraud signal, which is a PSP
  // concern. The bank's issuedCardRegistry is a different record: what this issuer put in customers' hands.
  'paymentCardRegistry',
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
  for (const root of [BACKEND_SRC, EVENTBUS_SRC, resolve(ROOT, 'bankcore/src')]) {
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

// What a setup directory actually creates: the bare literal, or any constant that names it.
function setupCreates(setupDir: string, collection: string): boolean {
  const constants = CONSTANTS.get(collection) ?? new Set<string>();
  for (const file of sourceFiles(setupDir)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes(`'${collection}'`)) return true;
    for (const constant of constants) if (text.includes(constant)) return true;
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
    const stillHere = Object.entries(OWNED_BY_BANKCORE).filter(([, o]) => !o.moved).map(([name]) => name);
    const stale = [...stillHere, ...OWNED_BY_PSP].filter((name) => !declared.has(name));
    expect(stale, 'split entries with no constant in the sources').toEqual([]);
  });

  it('the ledger audit log and the card collections belong to the bank', () => {
    for (const name of ['balanceCreditLog', 'cardIssuerVault', 'cardAuthorizationRecord']) {
      expect(OWNED_BY_BANKCORE[name], `${name} must be bank owned`).toBeTruthy();
    }
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
    for (const [name, { moved }] of Object.entries(OWNED_BY_BANKCORE)) {
      if (moved) continue;
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

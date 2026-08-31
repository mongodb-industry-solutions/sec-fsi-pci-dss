/**
 * Unit tests: v33 seed-data integrity, the whole audit encoded as fixture invariants.
 * Source: backend/data/*.json, backend/src/vendors/seed/dataIntegrity.ts, backend/bin/seed-generate.ts
 *
 * The v33 audit found a demo whose data contradicted its own story: 48 customers with cards,
 * accounts, transactions and fraud cases who could not sign in (F1), every one of 209 transactions
 * pointing at a card that did not exist (F3), a customer holding a login and a merchant but no
 * agreement and no card (F2), and a generator that would have deleted the curated cast on the next
 * `npm run generate:data` (F5, F6). None of it was a security defect and all of it was visible to
 * anyone who clicked twice in front of an audience.
 *
 * These tests pin each invariant against the fixtures, which are the source of truth the seeder
 * loads, so no part of the audit can regress silently. Table-driven where the same rule applies to
 * many collections.
 *
 * Deliberate exceptions, asserted rather than "repaired" (see dev.v33.plan.md §1.1):
 *   - a masked-PAN collision: different PANs legitimately share their last four digits;
 *   - shared card tokens: one physical card held by several customers IS the FDS/AML shared-card
 *     signal, keyed by (customer, token) and surfaced as cardHolderCount;
 *   - one `initiated` KYC record: an in-progress lifecycle state on an otherwise complete customer,
 *     which is what makes the KYC administration list's count explainable (v32 Track E).
 */
import { describe, it, expect } from 'vitest';
import { giamPath, hasGiam } from '../../../../support/giamRepo';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  repointTransactionsToCards,
  deterministicReference,
  type AgreementSeed,
  type AuthenticationSeed,
  type CardSeed,
  type PartySeed,
  type PayoutAccountSeed,
  type TransactionSeed,
} from '../../../../../psp/backend/src/vendors/seed/dataIntegrity';
import { deriveMaskedPan } from '../../../../../psp/backend/src/modules/customer/models/paymentCard.model';

const DATA = join(process.cwd(), 'psp', 'backend', 'data');
const read = <T>(f: string): T[] => JSON.parse(readFileSync(join(DATA, f), 'utf-8')) as T[];

const parties = read<PartySeed>('parties.json');
const agreements = read<AgreementSeed>('customerAgreements.json');
const cards = read<CardSeed>('paymentCards.json');
const transactions = read<TransactionSeed>('cardTransactions.json');
// The logins are the identity authority's fixtures now. Read from there, because the integrity
// question they answer (does every customer party have exactly one principal) spans both sides and
// has to be asked against whichever file is actually seeded.
// GIAM is a separate repository now, so the fixture is read from a local checkout of it and the
// login rules skip when there is none.
const HAS_LOGINS = hasGiam('backend/data/identities.json');
const logins = (HAS_LOGINS ? JSON.parse(readFileSync(
  giamPath('backend/data/identities.json'),
  'utf-8',
)) as Array<Record<string, unknown>> : []).map((identity) => ({
  customerAuthenticationInstanceReference: identity.subjectId as string,
  customerAuthenticationEmailAddress: identity.email as string | undefined,
  partyInstanceReference: identity.accountHolderRef as string,
  customerAuthenticationDemoFeatured: identity.demoFeatured === true,
})) as AuthenticationSeed[];
const payoutAccounts = read<PayoutAccountSeed>('payoutAccounts.json');
const fraudCases = read<Record<string, unknown>>('fraudCases.json');
const fraudCaseEvents = read<Record<string, unknown>>('fraudCaseEvents.json');
const merchants = read<Record<string, unknown>>('merchants.json');

const customers = parties.filter((p) => p.partyType === 'customer');
const employees = parties.filter((p) => p.partyType === 'employee');

// Mirrors KYC_COMPLETED_STATUSES in customerAgreement.service.
const COMPLETED_KYC = ['verified', 'rejected', 'expired'];
const kycStatus = (a: AgreementSeed) =>
  (a.customerAgreementKycCheck as Record<string, unknown> | undefined)?.customerAgreementKycCheckStatus as
    | string
    | undefined;

const agreementByParty = new Map(agreements.map((a) => [a.partyInstanceReference, a]));
const agreementByBusinessRef = new Map(agreements.map((a) => [a.customerAgreementReference, a]));
const partyRefs = new Set(parties.map((p) => p.partyInstanceReference));
const payoutRefs = new Set(payoutAccounts.map((a) => a.payoutAccountInstanceReference));
const payoutOwners = new Set(payoutAccounts.map((a) => a.partyInstanceReference));

const cardsByAgreement = groupBy(cards, (c) => c.customerAgreementInstanceReference);
const transactionsByAccount = groupBy(transactions, (t) => t.cardTransactionAccountReference);
const loginsByParty = groupBy(logins, (l) => l.partyInstanceReference);

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

/** Names, not references, so a failure message says who is broken. */
const nameOf = (partyRef: string) =>
  parties.find((p) => p.partyInstanceReference === partyRef)?.partyName ?? partyRef;

describe('v33 seed-data integrity: referential integrity', () => {
  it('every card is funded by an existing payout account (SD-88 cardAccountReference)', () => {
    const offenders = cards.filter(
      (c) => !c.fundingPayoutAccountInstanceReference || !payoutRefs.has(c.fundingPayoutAccountInstanceReference),
    );
    expect(offenders.map((c) => c.paymentCardInstanceReference)).toEqual([]);
  });

  it('every payout account has an owner party that exists', () => {
    const offenders = payoutAccounts.filter((a) => !partyRefs.has(a.partyInstanceReference));
    expect(offenders.map((a) => a.payoutAccountInstanceReference)).toEqual([]);
  });

  it('no card is funded by an account belonging to a different party', () => {
    const accountOwner = new Map(payoutAccounts.map((a) => [a.payoutAccountInstanceReference, a.partyInstanceReference]));
    const offenders = cards.filter((c) => {
      const agreement = agreements.find(
        (a) => a.customerAgreementInstanceReference === c.customerAgreementInstanceReference,
      );
      if (!agreement) return true;
      return accountOwner.get(c.fundingPayoutAccountInstanceReference ?? '') !== agreement.partyInstanceReference;
    });
    expect(offenders.map((c) => c.paymentCardInstanceReference)).toEqual([]);
  });

  it.each([
    ['agreement → party', () => agreements.map((a) => a.partyInstanceReference), () => partyRefs],
    [
      'card → agreement',
      () => cards.map((c) => c.customerAgreementInstanceReference),
      () => new Set(agreements.map((a) => a.customerAgreementInstanceReference)),
    ],
    [
      'transaction → account reference',
      () => transactions.map((t) => t.cardTransactionAccountReference),
      () => new Set(agreements.map((a) => a.customerAgreementReference)),
    ],
    [
      'fraud case → agreement',
      () => fraudCases.map((c) => c.customerAgreementInstanceReference as string),
      () => new Set(agreements.map((a) => a.customerAgreementInstanceReference)),
    ],
    [
      // Card cases only: a non-card case (transfer / RTP) links to a payment execution or a payment
      // request instead, which the TS seeders own (see the non-card rule below).
      'fraud case → transaction',
      () => fraudCases.filter((c) => (c.transactionKind ?? 'card') === 'card').map((c) => c.cardTransactionInstanceReference as string),
      () => new Set(transactions.map((t) => t.cardTransactionInstanceReference)),
    ],
    [
      'case event → case',
      () => fraudCaseEvents.map((e) => e.fraudDiagnosisInstanceReference as string),
      () => new Set(fraudCases.map((c) => c.fraudDiagnosisInstanceReference as string)),
    ],
    ['merchant → owner party', () => merchants.map((m) => m.merchantOwnerPartyReference as string), () => partyRefs],
    ...(HAS_LOGINS
      ? [['login → party', () => logins.map((l) => l.partyInstanceReference), () => partyRefs] as const]
      : []),
  ])('%s has no orphans', (_label, values, targets) => {
    const target = targets();
    expect(values().filter((v) => !target.has(v))).toEqual([]);
  });

  // A non-card case must carry the link to its movement, otherwise the investigation read-model cannot
  // resolve a counterparty and the case detail falls back to an empty merchant panel.
  it('every non-card fraud case links to its movement', () => {
    const nonCard = fraudCases.filter((c) => (c.transactionKind ?? 'card') !== 'card');
    for (const c of nonCard) {
      const linked = c.transactionKind === 'rtp'
        ? (c.paymentRequestInstanceReference ?? c.cardTransactionInstanceReference)
        : (c.paymentExecutionInstanceReference ?? c.cardTransactionInstanceReference);
      expect(linked, c.fraudDiagnosisCaseReference as string).toBeTruthy();
    }
  });
});

describe('v33 seed-data integrity: uniqueness', () => {
  // Each row: what must be unique, and the values to check. Undefined values are skipped, so an
  // optional field is not forced to exist here (presence is asserted separately where it matters).
  it.each([
    ['party primary key', () => parties.map((p) => p.partyInstanceReference)],
    ['party email', () => parties.map((p) => String(p.partyEmailAddress ?? '').toLowerCase())],
    ['party phone', () => parties.map((p) => p.partyMobilePhoneNumber as string)],
    ['agreement primary key', () => agreements.map((a) => a.customerAgreementInstanceReference)],
    ['agreement business reference', () => agreements.map((a) => a.customerAgreementReference)],
    ['agreement owner party (one agreement per party)', () => agreements.map((a) => a.partyInstanceReference)],
    [
      'government ID number',
      () => agreements.map((a) => (a.customerAgreementGovernmentID as Record<string, unknown> | undefined)?.number as string),
    ],
    ['tax ID number', () => agreements.map((a) => a.customerAgreementTaxIDNumber as string)],
    ['payout account primary key', () => payoutAccounts.map((a) => a.payoutAccountInstanceReference)],
    ['IBAN', () => payoutAccounts.map((a) => a.payoutAccountIban as string)],
    ['card primary key', () => cards.map((c) => c.paymentCardInstanceReference)],
    ['card holder + token pair', () => cards.map((c) => `${c.customerAgreementInstanceReference}|${c.paymentCardReference}`)],
    ['transaction primary key', () => transactions.map((t) => t.cardTransactionInstanceReference)],
    ['fraud case primary key', () => fraudCases.map((c) => c.fraudDiagnosisInstanceReference as string)],
    ...(HAS_LOGINS
      ? [
          ['login primary key', () => logins.map((l) => l.customerAuthenticationInstanceReference)] as const,
          ['login email', () => logins.map((l) => String(l.customerAuthenticationEmailAddress ?? '').toLowerCase())] as const,
          ['login owner party (one login per party)', () => logins.map((l) => l.partyInstanceReference)] as const,
        ]
      : []),
  ])('%s is unique', (_label, values) => {
    const present = values().filter((v) => v !== undefined && v !== '');
    const seen = new Map<string, number>();
    for (const v of present) seen.set(v, (seen.get(v) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('a card token may be shared by several holders: that is the FDS/AML signal, not a duplicate', () => {
    const holders = new Map<string, number>();
    for (const c of cards) holders.set(c.paymentCardReference, (holders.get(c.paymentCardReference) ?? 0) + 1);
    const shared = [...holders.entries()].filter(([, n]) => n > 1);
    // At least one token must exceed the >3-holder threshold, or the compliance signal has nothing
    // to trip on and the shared-card panel goes dead.
    expect(shared.some(([, n]) => n > 3)).toBe(true);
  });
});

describe('v33 seed-data integrity: a complete population (D-3)', () => {
  it.skipIf(!HAS_LOGINS)('every customer party has exactly one login (F1)', () => {
    const without = customers.filter((p) => (loginsByParty.get(p.partyInstanceReference) ?? []).length !== 1);
    expect(without.map((p) => p.partyName)).toEqual([]);
  });

  it.skipIf(!HAS_LOGINS)('every employee party is complete and has exactly one login', () => {
    const REQUIRED = ['partyName', 'partyEmailAddress', 'partyMobilePhoneNumber'] as const;
    const incomplete = employees
      .map((p) => ({
        name: p.partyName,
        missing: REQUIRED.filter((f) => !p[f]),
        logins: (loginsByParty.get(p.partyInstanceReference) ?? []).length,
      }))
      .filter((x) => x.missing.length > 0 || x.logins !== 1);
    expect(incomplete).toEqual([]);
  });

  it('every customer party is complete: agreement, card, payout account and transaction', () => {
    const incomplete = customers
      .map((p) => {
        const agreement = agreementByParty.get(p.partyInstanceReference);
        const missing: string[] = [];
        if (!agreement) missing.push('agreement');
        if (!payoutOwners.has(p.partyInstanceReference)) missing.push('payoutAccount');
        if (agreement) {
          if (!kycStatus(agreement)) missing.push('kycCheck');
          if ((cardsByAgreement.get(agreement.customerAgreementInstanceReference) ?? []).length === 0) missing.push('card');
          if ((transactionsByAccount.get(agreement.customerAgreementReference) ?? []).length === 0) missing.push('transaction');
        }
        return { name: p.partyName, missing };
      })
      .filter((x) => x.missing.length > 0);
    expect(incomplete).toEqual([]);
  });

  it('every customer agreement belongs to a customer party and carries a valid KYC lifecycle status', () => {
    const VALID = [...COMPLETED_KYC, 'initiated', 'in_review'];
    const offenders = agreements
      .map((a) => ({
        party: nameOf(a.partyInstanceReference),
        type: parties.find((p) => p.partyInstanceReference === a.partyInstanceReference)?.partyType,
        status: kycStatus(a),
      }))
      .filter((x) => x.type !== 'customer' || !VALID.includes(x.status ?? ''));
    expect(offenders).toEqual([]);
  });

  it('at most one customer is mid-KYC, so the KYC administration list count stays explainable', () => {
    // v32 Track E: the list shows the COMPLETED subset, and the difference from the agreement total
    // must be accounted for by real in-progress records rather than by missing data.
    const notCompleted = agreements.filter((a) => !COMPLETED_KYC.includes(kycStatus(a) ?? ''));
    expect(notCompleted.length).toBeLessThanOrEqual(1);
    for (const a of notCompleted) {
      // The mid-KYC customer is still structurally complete: only the verdict is pending.
      const cardCount = (cardsByAgreement.get(a.customerAgreementInstanceReference) ?? []).length;
      expect(cardCount, String(a.customerAgreementReference)).toBeGreaterThan(0);
    }
  });

  it.skipIf(!HAS_LOGINS)('the curated login picker stays short while every customer is reachable', () => {
    // v39: two personas per role rather than one, so a sign-in screen can offer a ROLE instead of a
    // named person. Sixteen is still a curated fraction of the population, which is the property.
    const featured = logins.filter((l) => l.customerAuthenticationDemoFeatured === true);
    expect(featured.length).toBe(16);
    expect(logins.length).toBeGreaterThan(featured.length);
  });

  it('the three merchant-owning parties are still present (hard constraint)', () => {
    for (const name of ['Luis Fernandez', 'David Chen', 'Amara Okafor']) {
      expect(customers.map((p) => p.partyName)).toContain(name);
    }
  });

  it('the QE search demo keeps a population for all five modes', () => {
    const govId = (a: AgreementSeed) => (a.customerAgreementGovernmentID as Record<string, unknown> | undefined) ?? {};
    expect(agreements.filter((a) => String(govId(a).number ?? '').endsWith('4821')).length).toBeGreaterThan(4); // suffix
    expect(agreements.filter((a) => String(a.customerAgreementTaxIDNumber ?? '').startsWith('ES')).length).toBeGreaterThan(4); // prefix
    expect(new Set(agreements.map((a) => govId(a).type)).size).toBeGreaterThanOrEqual(3); // equality
    expect(new Set(parties.map((p) => p.partyNationality)).size).toBeGreaterThanOrEqual(5); // equality
    expect(
      new Set(
        agreements.map(
          (a) => (a.customerAgreementKycCheck as Record<string, unknown>)?.customerAgreementKycCheckRiskRating,
        ),
      ).size,
    ).toBe(3); // range-derived rating
  });
});

describe('v33 seed-data integrity: the transaction-to-card link (F3)', () => {
  it('every transaction points at a card held by the same party, with an agreeing masked PAN', () => {
    const offenders = transactions
      .map((t) => {
        const agreement = agreementByBusinessRef.get(t.cardTransactionAccountReference);
        if (!agreement) return { txn: t.cardTransactionInstanceReference, reason: 'unknown account reference' };
        const held = cardsByAgreement.get(agreement.customerAgreementInstanceReference) ?? [];
        const card = held.find((c) => c.paymentCardReference === t.paymentCardReference);
        if (!card) return { txn: t.cardTransactionInstanceReference, reason: 'token not held by this party' };
        if (t.cardTransactionMaskedPanDisplay !== deriveMaskedPan(card)) {
          return { txn: t.cardTransactionInstanceReference, reason: 'masked PAN disagrees with the card' };
        }
        return null;
      })
      .filter(Boolean);
    expect(offenders).toEqual([]);
  });

  it('a fraud case snapshot shows the masked PAN its transaction actually carries', () => {
    const byRef = new Map(transactions.map((t) => [t.cardTransactionInstanceReference, t]));
    const offenders = fraudCases.filter((c) => {
      const snapshot = c.transactionSnapshot as Record<string, unknown> | undefined;
      const txn = byRef.get(c.cardTransactionInstanceReference as string);
      if (!snapshot || !txn || !('cardTransactionMaskedPanDisplay' in snapshot)) return false;
      return snapshot.cardTransactionMaskedPanDisplay !== txn.cardTransactionMaskedPanDisplay;
    });
    expect(offenders.map((c) => c.fraudDiagnosisCaseReference)).toEqual([]);
  });

  it('no transaction is dated in the future', () => {
    const now = Date.now();
    const future = transactions.filter((t) => new Date(t.cardTransactionDateTime as string).getTime() > now);
    expect(future.map((t) => t.cardTransactionInstanceReference)).toEqual([]);
  });
});

describe('v33 seed-data integrity: the deprecated government-ID field is gone (F5)', () => {
  it.each(['customerAgreements.json', 'parties.json', 'paymentCards.json', 'cardTransactions.json'])(
    '%s contains neither governmentIdentificationReference nor a SYNTH- value',
    (file) => {
      const raw = readFileSync(join(DATA, file), 'utf-8');
      expect(raw).not.toContain('governmentIdentificationReference');
      expect(raw).not.toContain('SYNTH-');
    },
  );

  it('every agreement carries a complete identity document, long enough for a last-4 suffix query', () => {
    const offenders = agreements
      .map((a) => {
        const gov = (a.customerAgreementGovernmentID as Record<string, unknown> | undefined) ?? {};
        const missing = ['type', 'number', 'issuingCountry', 'expiryDate'].filter((f) => !gov[f]);
        if (String(gov.number ?? '').length < 6) missing.push('number too short for a suffix query');
        return { ref: a.customerAgreementReference, missing };
      })
      .filter((x) => x.missing.length > 0);
    expect(offenders).toEqual([]);
  });
});

describe('v33 seed-data integrity: the shared repair functions are idempotent', () => {

  it('repointTransactionsToCards changes nothing on the current fixtures (F3)', () => {
    const copy = JSON.parse(JSON.stringify(transactions)) as TransactionSeed[];
    const summary = repointTransactionsToCards(copy, cards, agreements);
    expect(summary).toEqual({ repointed: 0, maskedPanAligned: 0, unresolvable: [] });
    expect(copy).toEqual(transactions);
  });



  it('repointing prefers a token unique to the holder over a shared one, so a token lookup is unambiguous', () => {
    const agreement: AgreementSeed = {
      customerAgreementInstanceReference: 'ag-1',
      partyInstanceReference: 'p-1',
      customerAgreementReference: 'ACC-TEST-1',
    };
    const shared: CardSeed = {
      paymentCardInstanceReference: 'card-shared',
      customerAgreementInstanceReference: 'ag-1',
      paymentCardReference: 'pm_shared',
      paymentCardMaskedPanDisplay: '****-****-****-1111',
      paymentCardIsPreferred: true,
      paymentCardStatus: 'active',
    };
    const own: CardSeed = {
      paymentCardInstanceReference: 'card-own',
      customerAgreementInstanceReference: 'ag-1',
      paymentCardReference: 'pm_own',
      paymentCardMaskedPanDisplay: '****-****-****-2222',
      paymentCardIsPreferred: false,
      paymentCardStatus: 'active',
    };
    const otherHolder: CardSeed = { ...shared, paymentCardInstanceReference: 'card-shared-2', customerAgreementInstanceReference: 'ag-2' };
    const txn: TransactionSeed = {
      cardTransactionInstanceReference: 'txn-1',
      paymentCardReference: 'pm_ghost',
      cardTransactionAccountReference: 'ACC-TEST-1',
      cardTransactionMaskedPanDisplay: '****-****-****-9999',
    };

    const summary = repointTransactionsToCards([txn], [shared, own, otherHolder], [agreement]);
    expect(summary.repointed).toBe(1);
    // The shared token is preferred by every other rule, and still loses to the holder's own token.
    expect(txn.paymentCardReference).toBe('pm_own');
    expect(txn.cardTransactionMaskedPanDisplay).toBe('****-****-****-2222');
  });

  it('a transaction whose account reference has no card holder is reported, never silently repointed', () => {
    const txn: TransactionSeed = {
      cardTransactionInstanceReference: 'txn-orphan',
      paymentCardReference: 'pm_ghost',
      cardTransactionAccountReference: 'ACC-DOES-NOT-EXIST',
    };
    const summary = repointTransactionsToCards([txn], cards, agreements);
    expect(summary.unresolvable).toEqual(['txn-orphan']);
    expect(txn.paymentCardReference).toBe('pm_ghost');
  });

  it('deterministicReference is stable, namespaced and UUID-shaped', () => {
    const a = deterministicReference('ns', 'seed');
    expect(a).toBe(deterministicReference('ns', 'seed'));
    expect(a).not.toBe(deterministicReference('other-ns', 'seed'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

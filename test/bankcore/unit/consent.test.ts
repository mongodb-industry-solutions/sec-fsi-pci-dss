// v37 P3.1/P3.10: the PSD2 account access consent, its Berlin Group status enumeration, and the gate
// every AIS and PIS call goes through.
//
// The property under test is that enforcement FAILS CLOSED. Only `valid` is usable, and everything else
// (unknown, another client's, terminated, revoked, lapsed, an account outside the access set, and a
// status this code has never heard of) is refused. A consent check that defaults to permissive is worse
// than none, because it reads as protection.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Db } from 'mongodb';
import {
  createConsent, resolveConsent, findConsent, changeConsentStatus, toBerlinGroupConsent,
} from '../../../bankcore/src/modules/consent/services/consent.service';
import type { BankConsentAgreementControlRecord } from '../../../bankcore/src/modules/consent/models/bankConsent.model';

const TPP = 'leafypay-psp';
const OTHER_TPP = 'someone-else';
const IBAN_A = 'ES2098208323403025812509';
const IBAN_B = 'ES5198204792106903981974';
const IBAN_OTHER_HOLDER = 'GB92VRDN95504424063597';

const ACCOUNTS = [
  { accountArrangementInstanceReference: 'acc-1', accountHolderInstanceReference: 'hld-1', accountIban: IBAN_A },
  { accountArrangementInstanceReference: 'acc-2', accountHolderInstanceReference: 'hld-1', accountIban: IBAN_B },
  { accountArrangementInstanceReference: 'acc-9', accountHolderInstanceReference: 'hld-2', accountIban: IBAN_OTHER_HOLDER },
];

// In-memory stand-in for the two collections the service touches. It honours the operators actually
// used ($in, $set, dotted paths are not needed here), so a test cannot pass on a query the driver would
// reject: the IBAN lookup is the one that taught this lesson, since Queryable Encryption refuses an
// equality query on a field with no equality index.
function fakeDb() {
  const consents: BankConsentAgreementControlRecord[] = [];
  const accessLog: Array<Record<string, unknown>> = [];

  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([key, expected]) => {
      const actual = doc[key];
      if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
        return (expected as { $in: unknown[] }).$in.includes(actual);
      }
      return actual === expected;
    });

  const store = (name: string): Array<Record<string, unknown>> => {
    if (name === 'accountArrangement') return ACCOUNTS as unknown as Array<Record<string, unknown>>;
    if (name === 'bankConsentAgreement') return consents as unknown as Array<Record<string, unknown>>;
    return accessLog;
  };

  const collection = (name: string) => ({
    find(filter: Record<string, unknown> = {}) {
      return { async toArray() { return store(name).filter((doc) => matches(doc, filter)); } };
    },
    async findOne(filter: Record<string, unknown>) {
      return store(name).find((doc) => matches(doc, filter)) ?? null;
    },
    async insertOne(doc: Record<string, unknown>) {
      store(name).push(doc);
      return { acknowledged: true };
    },
    async updateOne(filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) {
      const doc = store(name).find((candidate) => matches(candidate, filter));
      if (doc) Object.assign(doc, update.$set ?? {});
      return { acknowledged: true, matchedCount: doc ? 1 : 0 };
    },
  });

  return { db: { collection } as unknown as Db, consents, accessLog };
}

let bank: ReturnType<typeof fakeDb>;
beforeEach(() => { bank = fakeDb(); });
afterEach(() => { vi.useRealTimers(); });

async function seedValidConsent(overrides: Partial<BankConsentAgreementControlRecord> = {}): Promise<BankConsentAgreementControlRecord> {
  const created = await createConsent(bank.db, { tppClientId: TPP, accountIbans: [IBAN_A, IBAN_B] });
  if (!created.ok) throw new Error('fixture consent could not be created');
  Object.assign(created.consent, overrides);
  return created.consent;
}

describe('v37 P3.1: creating a consent', () => {
  it('lands valid in automatic mode, recording WHY rather than leaving it implicit', async () => {
    const result = await createConsent(bank.db, { tppClientId: TPP, accountIbans: [IBAN_A] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consent.bankConsentStatus).toBe('valid');
    expect(result.consent.bankConsentStatusReason).toBe('tpp_registered');
    expect(result.consent.bankConsentAccountHolderInstanceReference).toBe('hld-1');
  });

  it('stores account REFERENCES, not IBANs, so the personal datum is not copied', async () => {
    const result = await createConsent(bank.db, { tppClientId: TPP, accountIbans: [IBAN_A] });
    if (!result.ok) throw new Error('unexpected refusal');
    expect(result.consent.bankConsentAccess.accounts).toEqual(['acc-1']);
    expect(JSON.stringify(result.consent)).not.toContain(IBAN_A);
  });

  it('grants balance and transaction access over the same accounts when they are omitted', async () => {
    const result = await createConsent(bank.db, { tppClientId: TPP, accountIbans: [IBAN_A, IBAN_B] });
    if (!result.ok) throw new Error('unexpected refusal');
    expect(result.consent.bankConsentAccess.balances).toEqual(['acc-1', 'acc-2']);
    expect(result.consent.bankConsentAccess.transactions).toEqual(['acc-1', 'acc-2']);
  });

  it('honours a narrower balance list, since a dedicated list is a narrowing', async () => {
    const result = await createConsent(bank.db, {
      tppClientId: TPP, accountIbans: [IBAN_A, IBAN_B], balanceIbans: [IBAN_A],
    });
    if (!result.ok) throw new Error('unexpected refusal');
    expect(result.consent.bankConsentAccess.accounts).toEqual(['acc-1', 'acc-2']);
    expect(result.consent.bankConsentAccess.balances).toEqual(['acc-1']);
  });

  it('refuses an account this bank does not hold', async () => {
    const result = await createConsent(bank.db, { tppClientId: TPP, accountIbans: ['DE89370400440532013000'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('RESOURCE_UNKNOWN');
  });

  it('refuses a consent mixing two account holders, which has no meaning in the standard', async () => {
    const result = await createConsent(bank.db, { tppClientId: TPP, accountIbans: [IBAN_A, IBAN_OTHER_HOLDER] });
    expect(result.ok).toBe(false);
    // Also protects the holder derivation on every read, which would otherwise be ambiguous.
    if (!result.ok) expect(result.text).toContain('one account holder');
  });

  it('refuses an empty access object rather than creating a consent that grants nothing', async () => {
    const result = await createConsent(bank.db, { tppClientId: TPP, accountIbans: [] });
    expect(result.ok).toBe(false);
  });
});

describe('v37 P3.10: the status enumeration, and enforcement that fails closed', () => {
  it('lets a valid consent through and records the access as evidence', async () => {
    const consent = await seedValidConsent();
    const resolution = await resolveConsent(bank.db, {
      consentId: consent.bankConsentAgreementInstanceReference,
      tppClientId: TPP, kind: 'balances', accountReference: 'acc-1', correlationId: 'X-1',
    });
    expect(resolution.ok).toBe(true);
    const granted = bank.accessLog.filter((entry) => entry.accessDecision === 'granted' && entry.accessCorrelationId === 'X-1');
    expect(granted.length).toBe(1);
  });

  it('refuses an unknown consent as unknown, without disclosing whether it exists', async () => {
    const resolution = await resolveConsent(bank.db, {
      consentId: 'cns-nope', tppClientId: TPP, kind: 'accounts', accountReference: 'acc-1',
    });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.refusal).toMatchObject({ status: 403, code: 'CONSENT_UNKNOWN' });
  });

  it("refuses ANOTHER client's consent with the same answer as a non existent one", async () => {
    const consent = await seedValidConsent();
    const resolution = await resolveConsent(bank.db, {
      consentId: consent.bankConsentAgreementInstanceReference,
      tppClientId: OTHER_TPP, kind: 'accounts', accountReference: 'acc-1',
    });
    expect(resolution.ok).toBe(false);
    // Telling the two apart would turn this into a way to probe for other clients' consents.
    if (!resolution.ok) expect(resolution.refusal.code).toBe('CONSENT_UNKNOWN');
  });

  it('refuses an account the consent does not cover, per access kind', async () => {
    const created = await createConsent(bank.db, {
      tppClientId: TPP, accountIbans: [IBAN_A, IBAN_B], balanceIbans: [IBAN_A],
    });
    if (!created.ok) throw new Error('unexpected refusal');
    const id = created.consent.bankConsentAgreementInstanceReference;

    const listAccess = await resolveConsent(bank.db, { consentId: id, tppClientId: TPP, kind: 'accounts', accountReference: 'acc-2' });
    expect(listAccess.ok).toBe(true);
    // Same account, different kind: the narrower balance list is what decides here.
    const balanceAccess = await resolveConsent(bank.db, { consentId: id, tppClientId: TPP, kind: 'balances', accountReference: 'acc-2' });
    expect(balanceAccess.ok).toBe(false);
    if (!balanceAccess.ok) expect(balanceAccess.refusal.code).toBe('CONSENT_INVALID');
  });

  it('refuses every non-valid status, INCLUDING one it has never heard of', async () => {
    for (const status of ['received', 'rejected', 'revokedByPsu', 'terminatedByTpp', 'some_future_status']) {
      const consent = await seedValidConsent();
      await changeConsentStatus(bank.db, consent.bankConsentAgreementInstanceReference, status as never, 'test');
      const resolution = await resolveConsent(bank.db, {
        consentId: consent.bankConsentAgreementInstanceReference,
        tppClientId: TPP, kind: 'accounts', accountReference: 'acc-1',
      });
      expect(resolution.ok, `${status} must not be usable`).toBe(false);
    }
  });

  it('flips a lapsed consent to expired, so the lapse is recorded rather than re-evaluated', async () => {
    const consent = await seedValidConsent();
    const id = consent.bankConsentAgreementInstanceReference;
    await changeConsentStatus(bank.db, id, 'valid', 'tpp_registered');
    // A date-only validUntil is inclusive of that day, so the clock is moved well past it.
    consent.bankConsentValidUntil = '2026-08-01';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T10:00:00.000Z'));

    const resolution = await resolveConsent(bank.db, { consentId: id, tppClientId: TPP, kind: 'accounts', accountReference: 'acc-1' });
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.refusal.code).toBe('CONSENT_EXPIRED');
    expect((await findConsent(bank.db, id, TPP))!.bankConsentStatus).toBe('expired');
  });

  it('is inclusive of the last day of validity, not exclusive', async () => {
    const consent = await seedValidConsent();
    consent.bankConsentValidUntil = '2026-08-18';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T10:00:00.000Z'));
    const resolution = await resolveConsent(bank.db, {
      consentId: consent.bankConsentAgreementInstanceReference, tppClientId: TPP, kind: 'accounts', accountReference: 'acc-1',
    });
    expect(resolution.ok).toBe(true);
  });

  it('records a REFUSAL as evidence too, which is the more interesting half', async () => {
    await resolveConsent(bank.db, {
      consentId: 'cns-nope', tppClientId: TPP, kind: 'balances', accountReference: 'acc-1', correlationId: 'X-2',
    });
    const refused = bank.accessLog.find((entry) => entry.accessCorrelationId === 'X-2');
    expect(refused).toMatchObject({ accessDecision: 'refused', accessedAccountReference: 'acc-1' });
    expect(String(refused!.accessDecisionReason)).toContain('CONSENT_UNKNOWN');
  });

  it('a status change is itself evidence, with its reason', async () => {
    const consent = await seedValidConsent();
    await changeConsentStatus(bank.db, consent.bankConsentAgreementInstanceReference, 'revokedByPsu', 'revoked_at_the_bank');
    const entry = bank.accessLog.reverse().find((row) => String(row.accessDecisionReason).includes('revokedByPsu'));
    expect(entry).toBeDefined();
    expect(String(entry!.accessDecisionReason)).toContain('revoked_at_the_bank');
  });
});

describe('v37 P3.1: the standard resource', () => {
  it('resolves account references back to IBANs, which is what a TPP sent and expects', async () => {
    const consent = await seedValidConsent();
    const resource = await toBerlinGroupConsent(bank.db, consent);
    expect(resource.access.accounts).toEqual([{ iban: IBAN_A }, { iban: IBAN_B }]);
    expect(resource.consentStatus).toBe('valid');
    // Dates are date-only in the standard's consent resource.
    expect(resource.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(resource.lastActionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

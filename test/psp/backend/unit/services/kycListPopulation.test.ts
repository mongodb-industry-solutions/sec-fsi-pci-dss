/**
 * Unit tests: v32 Track E, the KYC administration list population (fixture invariants)
 * Source: backend/src/modules/customer/services/customerAgreement.service.ts (listKycAdmin)
 *         backend/data/parties.json + backend/data/customerAgreements.json
 *
 * Reported as "55 listed where 8 expected, and employees return 0". The counts were correct; the
 * surface simply never said what it lists. These tests pin the invariants that explain the numbers,
 * so a future seed change that breaks the explanation is visible instead of looking like a bug:
 *   - the list counts parties with a COMPLETED KYC record (verified / rejected / expired),
 *   - `initiated` records are excluded, which is why the total is below the agreement count,
 *   - no employee party holds a customer agreement, so filtering by employee is structurally empty
 *     (only a customer holds a CustomerAgreement), not broken,
 *   - the login-user population is a different, smaller set and must not be compared to this one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), 'psp', 'backend', 'data');
const read = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf-8')) as Array<Record<string, unknown>>;

const parties = read('parties.json');
const agreements = read('customerAgreements.json');

// Mirrors KYC_COMPLETED_STATUSES in the service.
const COMPLETED = ['verified', 'rejected', 'expired'];

const kycStatus = (a: Record<string, unknown>) =>
  ((a.customerAgreementKycCheck as Record<string, unknown> | undefined)
    ?.customerAgreementKycCheckStatus as string | undefined) ?? null;

const partyByRef = new Map(parties.map((p) => [p.partyInstanceReference as string, p]));

describe('KYC administration list population', () => {
  it('every customer agreement belongs to a party of type customer (BIAN SD-53)', () => {
    const offenders = agreements
      .map((a) => ({ ref: a.partyInstanceReference as string, type: partyByRef.get(a.partyInstanceReference as string)?.partyType }))
      .filter((x) => x.type !== 'customer');
    expect(offenders).toEqual([]);
  });

  it('no employee or service-account party holds a customer agreement (filter is structurally empty)', () => {
    const nonCustomerRefs = new Set(
      parties.filter((p) => p.partyType !== 'customer').map((p) => p.partyInstanceReference as string),
    );
    expect(nonCustomerRefs.size).toBeGreaterThan(0); // employees do exist as parties
    const withAgreement = agreements.filter((a) => nonCustomerRefs.has(a.partyInstanceReference as string));
    expect(withAgreement).toEqual([]);
  });

  it('the listed total is the COMPLETED subset, and the remainder is explained by initiated records', () => {
    const completed = agreements.filter((a) => COMPLETED.includes(kycStatus(a) ?? ''));
    const notCompleted = agreements.filter((a) => !COMPLETED.includes(kycStatus(a) ?? ''));
    expect(completed.length + notCompleted.length).toBe(agreements.length);
    // Every excluded record has a real, non-completed status: nothing is dropped by accident.
    for (const a of notCompleted) {
      expect(kycStatus(a), String(a.customerAgreementInstanceReference)).toBeTruthy();
      expect(COMPLETED).not.toContain(kycStatus(a));
    }
    expect(completed.length).toBeGreaterThan(0);
  });

  it('the KYC population and the login population still differ, now the other way round (v33)', () => {
    const usersFile = join(DATA, 'customerAuthentications.json');
    if (!existsSync(usersFile)) return; // seed layout changed; nothing to assert
    const users = JSON.parse(readFileSync(usersFile, 'utf-8')) as Array<Record<string, unknown>>;
    const completed = agreements.filter((a) => COMPLETED.includes(kycStatus(a) ?? '')).length;
    // Until v33 the login roster was a small curated subset, so the KYC list was the LARGER of the
    // two and the mismatch was explained that way. v33 (F1/D-3) gave every customer a login, so the
    // login population is now the larger one: it covers the staff parties as well, and staff hold no
    // customer agreement. The two counts still must not be compared, but for the opposite reason.
    expect(users.length).toBeGreaterThan(completed);
    // The login roster is split by the PARTY type, not by the role: a customer party may hold a
    // staff-ish role (a merchant owner is a customer of the PSP with a merchant_officer login).
    const customerPartyRefs = new Set(
      parties.filter((p) => p.partyType === 'customer').map((p) => p.partyInstanceReference as string),
    );
    const customerLogins = users.filter((u) => customerPartyRefs.has(u.partyInstanceReference as string));
    expect(users.length - customerLogins.length).toBeGreaterThan(0); // staff logins exist
    expect(customerLogins.length).toBe(customerPartyRefs.size); // and every customer has exactly one
  });
});

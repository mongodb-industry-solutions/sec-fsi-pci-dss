// v39 P1.6: reconciling the platform's principals before any of them are migrated.
//
// The plan records a count mismatch: 57 customer parties and 11 employee parties against 56
// customer-role logins and 12 staff-role logins, with a derivation helper described as the safety net
// that closes the gap. The migration has to resolve that EXPLICITLY rather than inherit it, because
// "one identity per real principal" is the assertion P5's parity gate is measured against, and a gap
// discovered there would be discovered after the records had already moved.
//
// What the fixtures actually say is checked here, on the real files, so the answer is evidence rather
// than a reading.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface PartyFixture {
  partyInstanceReference: string;
  partyType: string;
  partyName?: string;
  partyEmailAddress?: string;
}

interface LoginFixture {
  customerAuthenticationInstanceReference: string;
  partyInstanceReference: string;
  customerAuthenticationUserRole: string;
  customerAuthenticationUserName?: string;
  customerAuthenticationEmailAddress?: string;
  customerAuthenticationAccountStatus?: string;
}

const DATA = resolve(__dirname, '../../../../psp/backend/data');
const parties = JSON.parse(readFileSync(resolve(DATA, 'parties.json'), 'utf8')) as PartyFixture[];
const logins = JSON.parse(readFileSync(resolve(DATA, 'customerAuthentications.json'), 'utf8')) as LoginFixture[];

/**
 * The role histogram the plan's migration table states.
 *
 * Asserted rather than trusted: these become roleAssignment rows, and a role that silently gains or
 * loses a holder is a permission change nobody decided.
 */
const EXPECTED_ROLES: Record<string, number> = {
  customer: 56,
  level1_analyst: 2,
  level2_investigator: 2,
  security_auditor: 2,
  merchant_officer: 3,
  operations_officer: 2,
  manager: 1,
};

/**
 * The one record that explains the whole apparent mismatch.
 *
 * A person who is a CUSTOMER of the platform and also holds a STAFF role. That is not a defect and it
 * must not be "corrected": after v39 the identity is GIAM's, the customer record stays in the
 * application keyed by the same subject, and the staff role is one assignment among others. Naming
 * the record here means a later reader cannot mistake the offset for corrupt data.
 */
const CUSTOMER_HOLDING_A_STAFF_ROLE = 'merchant_officer';

const byPartyRef = new Map(parties.map((party) => [party.partyInstanceReference, party]));
const loginsByParty = new Map<string, LoginFixture[]>();
for (const login of logins) {
  const list = loginsByParty.get(login.partyInstanceReference) ?? [];
  list.push(login);
  loginsByParty.set(login.partyInstanceReference, list);
}

describe('v39 P1.6: the party and login fixtures reconcile exactly', () => {
  it('has no login pointing at a party that does not exist', () => {
    // An orphan login would migrate to an identity with no business record behind it, and nothing
    // downstream would notice until a screen rendered a blank name.
    const orphans = logins
      .filter((login) => !byPartyRef.has(login.partyInstanceReference))
      .map((login) => login.customerAuthenticationEmailAddress ?? login.customerAuthenticationInstanceReference);
    expect(orphans, `logins with no party: ${orphans.join(', ')}`).toEqual([]);
  });

  it('has no party without a login', () => {
    // This is what the derivation helper exists to cover. On the committed fixtures it covers
    // nothing, which is the finding: the helper is inert here, not load bearing.
    const withoutLogin = parties
      .filter((party) => !loginsByParty.has(party.partyInstanceReference))
      .map((party) => `${party.partyType}:${party.partyName}`);
    expect(withoutLogin, `parties with no login: ${withoutLogin.join(', ')}`).toEqual([]);
  });

  it('gives no party more than one login', () => {
    // Two logins for one person would become two identities and two audit trails for the same human.
    const multiple = [...loginsByParty.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([ref, list]) => `${byPartyRef.get(ref)?.partyName} has ${list.length}`);
    expect(multiple, multiple.join('; ')).toEqual([]);
  });

  it('produces exactly one identity per real principal', () => {
    // The number P5's parity gate is measured against: every one of these must sign in afterwards
    // with the credentials that work today.
    expect(logins.length).toBe(parties.length);
    expect(new Set(logins.map((l) => l.customerAuthenticationInstanceReference)).size).toBe(logins.length);
    expect(logins.length).toBe(68);
  });
});

describe('v39 P1.6: the apparent count mismatch has one cause, and it is not a defect', () => {
  it('reproduces the counts the plan reports', () => {
    const partyTypes = parties.reduce<Record<string, number>>((counts, party) => {
      counts[party.partyType] = (counts[party.partyType] ?? 0) + 1;
      return counts;
    }, {});
    expect(partyTypes).toEqual({ customer: 57, employee: 11 });

    const staffLogins = logins.filter((login) => login.customerAuthenticationUserRole !== 'customer');
    expect(staffLogins).toHaveLength(12);
    expect(logins.length - staffLogins.length).toBe(56);
  });

  it('explains the offset with exactly one person, a customer who also holds a staff role', () => {
    const crossovers = logins
      .filter((login) => login.customerAuthenticationUserRole !== 'customer')
      .filter((login) => byPartyRef.get(login.partyInstanceReference)?.partyType === 'customer');

    // One record, not a class of records. 57 customers minus this one is 56 customer-role logins,
    // and 11 employees plus this one is 12 staff-role logins. The books balance.
    expect(crossovers).toHaveLength(1);
    expect(crossovers[0].customerAuthenticationUserRole).toBe(CUSTOMER_HOLDING_A_STAFF_ROLE);
  });

  it('finds no employee holding a customer role', () => {
    // The mirror case would be the real defect: a staff member with only customer authority would
    // lose access at migration and the cause would look like a role mapping bug.
    const downgraded = logins
      .filter((login) => login.customerAuthenticationUserRole === 'customer')
      .filter((login) => byPartyRef.get(login.partyInstanceReference)?.partyType === 'employee')
      .map((login) => login.customerAuthenticationEmailAddress);
    expect(downgraded, downgraded.join(', ')).toEqual([]);
  });

  it('matches the role histogram the migration table states', () => {
    const histogram = logins.reduce<Record<string, number>>((counts, login) => {
      counts[login.customerAuthenticationUserRole] = (counts[login.customerAuthenticationUserRole] ?? 0) + 1;
      return counts;
    }, {});
    expect(histogram).toEqual(EXPECTED_ROLES);
    expect(Object.values(EXPECTED_ROLES).reduce((a, b) => a + b, 0)).toBe(68);
  });

  it('keeps every subject identifier usable as a stable key', () => {
    // subjectId reuses these strings, so historical audit rows and merchant references still resolve.
    // A blank or duplicated one would break that silently, in records nobody re-reads.
    for (const login of logins) {
      expect(login.customerAuthenticationInstanceReference).toMatch(/^\S{8,}$/);
    }
  });

  it('carries a credential and a status on every login that has to keep working', () => {
    const unusable = logins
      .filter((login) => login.customerAuthenticationAccountStatus === 'active')
      .filter((login) => !login.customerAuthenticationEmailAddress)
      .map((login) => login.customerAuthenticationInstanceReference);
    expect(unusable, `active logins with no email: ${unusable.join(', ')}`).toEqual([]);
  });
});

// v37 P4.4/P4.6d/P4.6f: the PSP acquires the consent, and waits for the bank to authorise it.
//
// The rule under test is "created is not authorised". Half of these cases run against a STRICT BANK stub
// that never authorises anything on creation, which is what proves the PSP needs no change for a bank that
// concedes nothing: if it only worked against a bank that answers `valid` immediately, the design's
// acceptance test would be false and nothing would have told us.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import {
  ensureConsentForLink, awaitConsentValid, USABLE_CONSENT_STATUS,
} from '../../../../backend/src/modules/gateway/services/bankConsentAcquisition.service';

const LINK = {
  payoutAccountInstanceReference: 'pau-1',
  payoutAccountBankAccountReference: 'acc-1',
  payoutAccountAspspReference: 'bank-1',
  payoutAccountIban: 'ES2098208323403025812509',
} as never;

function fakeDb() {
  const updates: Array<Record<string, unknown>> = [];
  const collection = () => ({
    // updateOne only: QE rejects multi-document updates on an encrypted collection, and this is one.
    async updateOne(_filter: unknown, update: { $set?: Record<string, unknown> }) {
      updates.push(update.$set ?? {});
      return { modifiedCount: 1 };
    },
  });
  return { db: { collection } as unknown as Db, updates };
}

// A bank that authorises on creation, which is this demo's `automatic` mode.
function permissiveBank() {
  const created: string[] = [];
  return {
    created,
    ports: {
      create: (async (input: { accountIbans: string[] }) => {
        created.push(input.accountIbans[0]);
        return { consentReference: 'cns-new', consentStatus: 'valid' };
      }) as never,
      readStatus: (async () => ({ consentStatus: 'valid' })) as never,
    },
  };
}

// A bank that concedes nothing on creation: the consent lands `received` and only becomes usable later,
// which is what a real ASPSP requiring SCA does. Nothing about the PSP may change to cope with it.
function strictBank(statusSequence: string[]) {
  const reads: number[] = [];
  let index = 0;
  return {
    reads,
    ports: {
      create: (async () => ({ consentReference: 'cns-strict', consentStatus: 'received' })) as never,
      readStatus: (async () => {
        reads.push(index);
        const status = statusSequence[Math.min(index, statusSequence.length - 1)];
        index += 1;
        return { consentStatus: status };
      }) as never,
    },
  };
}

let bank: ReturnType<typeof fakeDb>;
beforeEach(() => { bank = fakeDb(); });

describe('v37 P4.4: acquiring the consent', () => {
  it('creates one and stores what the bank reported', async () => {
    const permissive = permissiveBank();
    const outcome = await ensureConsentForLink(bank.db, LINK, { ports: permissive.ports });
    expect(outcome).toEqual({ state: 'valid', consentReference: 'cns-new' });
    expect(permissive.created).toEqual(['ES2098208323403025812509']);
    expect(bank.updates[0]).toMatchObject({
      payoutAccountConsentReference: 'cns-new',
      payoutAccountConsentStatus: 'valid',
    });
  });

  it('leaves an already valid link alone, so this is safe to call before every read', async () => {
    const permissive = permissiveBank();
    const outcome = await ensureConsentForLink(
      bank.db,
      { ...LINK, payoutAccountConsentReference: 'cns-existing', payoutAccountConsentStatus: USABLE_CONSENT_STATUS } as never,
      { ports: permissive.ports },
    );
    expect(outcome).toEqual({ state: 'valid', consentReference: 'cns-existing' });
    // No second consent, and no write: calling this per read must not create one per read.
    expect(permissive.created).toEqual([]);
    expect(bank.updates).toEqual([]);
  });

  it('refuses a link with no IBAN rather than requesting access to nothing', async () => {
    const outcome = await ensureConsentForLink(bank.db, { ...LINK, payoutAccountIban: undefined } as never, {
      ports: permissiveBank().ports,
    });
    expect(outcome.state).toBe('error');
  });

  it("reports the bank's refusal instead of leaving the link half-linked", async () => {
    const refusing = {
      create: (async () => ({ error: 'consent refused: RESOURCE_UNKNOWN not an account at this bank' })) as never,
      readStatus: (async () => ({ consentStatus: 'valid' })) as never,
    };
    const outcome = await ensureConsentForLink(bank.db, LINK, { ports: refusing });
    expect(outcome.state).toBe('error');
    if (outcome.state === 'error') expect(outcome.error).toContain('RESOURCE_UNKNOWN');
    expect(bank.updates).toEqual([]);
  });
});

describe('v37 P4.6d/P4.6f: against a bank that authorises nothing on creation', () => {
  it('reports PENDING rather than treating a created consent as usable', async () => {
    const strict = strictBank(['received']);
    const outcome = await ensureConsentForLink(bank.db, LINK, { ports: strict.ports });
    // The optimistic shortcut would return `valid` here, and would be wrong against any real ASPSP.
    expect(outcome).toEqual({ state: 'pending', consentReference: 'cns-strict', consentStatus: 'received' });
    expect(bank.updates[0].payoutAccountConsentStatus).toBe('received');
  });

  it('POLLS an existing pending consent instead of creating a second one', async () => {
    const strict = strictBank(['received', 'valid']);
    const pendingLink = { ...LINK, payoutAccountConsentReference: 'cns-strict', payoutAccountConsentStatus: 'received' } as never;

    const first = await ensureConsentForLink(bank.db, pendingLink, { ports: strict.ports });
    expect(first.state).toBe('pending');
    const second = await ensureConsentForLink(bank.db, pendingLink, { ports: strict.ports });
    // The specification's own answer to a missed notification: ask.
    expect(second).toEqual({ state: 'valid', consentReference: 'cns-strict' });
    expect(strict.reads.length).toBe(2);
  });

  it('becomes usable when the bank eventually authorises, with a bounded wait', async () => {
    const strict = strictBank(['received', 'received', 'valid']);
    const outcome = await awaitConsentValid(bank.db, LINK, { attempts: 4, ports: strict.ports });
    expect(outcome).toMatchObject({ state: 'valid' });
  });

  it('gives up as PENDING rather than holding a request open forever', async () => {
    const strict = strictBank(['received']);
    const outcome = await awaitConsentValid(bank.db, LINK, { attempts: 3, ports: strict.ports });
    // Pending is the honest state: the link shows as pending and the notification resolves it later.
    expect(outcome.state).toBe('pending');
  });

  it('treats every other terminal status as unusable, including one it has never seen', async () => {
    for (const status of ['rejected', 'revokedByPsu', 'expired', 'terminatedByTpp', 'someFutureStatus']) {
      const strict = strictBank([status]);
      const outcome = await ensureConsentForLink(
        bank.db,
        { ...LINK, payoutAccountConsentReference: 'cns-strict', payoutAccountConsentStatus: 'received' } as never,
        { ports: strict.ports },
      );
      expect(outcome.state, status).toBe('unusable');
    }
  });

  it('does not retry past a terminal status: a rejected consent will not become valid', async () => {
    const strict = strictBank(['rejected', 'valid']);
    const outcome = await awaitConsentValid(
      bank.db,
      { ...LINK, payoutAccountConsentReference: 'cns-strict', payoutAccountConsentStatus: 'received' } as never,
      { attempts: 3, ports: strict.ports },
    );
    expect(outcome.state).toBe('unusable');
    // One read, not three: polling a decision the bank already made is noise, and the second status in the
    // sequence proves the loop stopped rather than eventually finding a `valid`.
    expect(strict.reads.length).toBe(1);
  });

  it('reports an unreachable bank as an error, never as usable', async () => {
    const unreachable = {
      create: (async () => ({ consentReference: 'cns-strict', consentStatus: 'received' })) as never,
      readStatus: (async () => ({ error: 'consent status unreachable: connect ECONNREFUSED' })) as never,
    };
    const outcome = await ensureConsentForLink(
      bank.db,
      { ...LINK, payoutAccountConsentReference: 'cns-strict', payoutAccountConsentStatus: 'received' } as never,
      { ports: unreachable },
    );
    expect(outcome.state).toBe('error');
  });
});

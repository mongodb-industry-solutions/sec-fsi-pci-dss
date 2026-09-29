// v37 P3.7a: the bank's engine configuration, which is where every option that used to live on a PSP
// provider record now belongs.
//
// The property that matters is that an engine is never unconfigured: `resolveModuleConfig` merges the
// stored document over the engine's own defaults, so a missing record, an inactive one or a partial one
// all yield a working rule set. The alternative is an engine that behaves differently on a fresh database
// than on a seeded one, which is the kind of difference that only shows up in a demo.
import { describe, it, expect } from 'vitest';
import type { Db } from 'mongodb';
import {
  resolveModuleConfig, isBankCapability, updateModuleConfiguration,
} from '../../../../bank/backend/src/modules/admin/services/bankModuleConfiguration.service';

const CARD_DEFAULTS = {
  validCvv: '123',
  cvvMode: 'both',
  enforceLuhn: true,
  networks: [{ name: 'VISA', enabled: true }],
};

function fakeDb(records: Array<Record<string, unknown>>) {
  const collection = () => ({
    async findOne(filter: { bankModuleConfigurationInstanceReference?: string }) {
      return records.find((r) => r.bankModuleConfigurationInstanceReference === filter.bankModuleConfigurationInstanceReference) ?? null;
    },
    async updateOne(filter: { bankModuleConfigurationInstanceReference?: string }, update: { $set?: Record<string, unknown> }) {
      const doc = records.find((r) => r.bankModuleConfigurationInstanceReference === filter.bankModuleConfigurationInstanceReference);
      if (doc) Object.assign(doc, update.$set ?? {});
      return { acknowledged: true };
    },
    find() { return { sort() { return { async toArray() { return records; } }; } }; },
  });
  return { collection } as unknown as Db;
}

function cardRecord(configuration: Record<string, unknown>, status = 'active') {
  return {
    bankModuleConfigurationInstanceReference: 'card-issuer',
    bankModuleCapability: 'card-issuer',
    bankModuleConfigurationStatus: status,
    bankModuleConfiguration: configuration,
  };
}

describe('v37 P3.7a: an engine is never unconfigured', () => {
  it('falls back to the defaults when no record exists', async () => {
    const resolved = await resolveModuleConfig(fakeDb([]), 'card-issuer', CARD_DEFAULTS);
    expect(resolved).toEqual(CARD_DEFAULTS);
  });

  it('ignores an inactive record rather than applying a disabled configuration', async () => {
    const db = fakeDb([cardRecord({ validCvv: '999' }, 'inactive')]);
    const resolved = await resolveModuleConfig(db, 'card-issuer', CARD_DEFAULTS);
    expect(resolved.validCvv).toBe('123');
  });

  it('merges a PARTIAL document over the defaults, so a half-written record still works', async () => {
    const db = fakeDb([cardRecord({ validCvv: '987' })]);
    const resolved = await resolveModuleConfig(db, 'card-issuer', CARD_DEFAULTS);
    expect(resolved.validCvv).toBe('987');
    expect(resolved.enforceLuhn).toBe(true);
    expect(resolved.networks).toEqual(CARD_DEFAULTS.networks);
  });

  it('replaces a list wholesale, because an operator has to be able to REMOVE an entry', async () => {
    const db = fakeDb([cardRecord({ networks: [{ name: 'AMEX', enabled: true }] })]);
    const resolved = await resolveModuleConfig(db, 'card-issuer', CARD_DEFAULTS);
    expect(resolved.networks).toEqual([{ name: 'AMEX', enabled: true }]);
  });

  it('drops a key the engine does not know instead of passing it through', async () => {
    const db = fakeDb([cardRecord({ validCvv: '987', someOptionNobodyReads: true })]);
    const resolved = await resolveModuleConfig(db, 'card-issuer', CARD_DEFAULTS);
    // An unknown option that silently does nothing is worse than one that was never accepted.
    expect('someOptionNobodyReads' in resolved).toBe(false);
    expect(resolved.validCvv).toBe('987');
  });

  it('ignores a null or undefined value rather than blanking a default with it', async () => {
    const db = fakeDb([cardRecord({ validCvv: null, cvvMode: undefined })]);
    const resolved = await resolveModuleConfig(db, 'card-issuer', CARD_DEFAULTS);
    expect(resolved.validCvv).toBe('123');
    expect(resolved.cvvMode).toBe('both');
  });

  it('survives a database it cannot read, since a config lookup must not break a payment', async () => {
    const broken = { collection: () => ({ async findOne() { throw new Error('no database'); } }) } as unknown as Db;
    const resolved = await resolveModuleConfig(broken, 'card-issuer', CARD_DEFAULTS);
    expect(resolved).toEqual(CARD_DEFAULTS);
  });
});

describe('v37 P3.7a: what may be configured', () => {
  it('accepts only the capabilities the bank actually has', () => {
    for (const capability of ['consent', 'card-issuer', 'pisp', 'aisp', 'aspsp', 'payment-hub', 'card-authorization', 'credit-bureau']) {
      expect(isBankCapability(capability), capability).toBe(true);
    }
    for (const nonsense of ['fds', 'card_issuer', 'CARD-ISSUER', '']) {
      expect(isBankCapability(nonsense), nonsense).toBe(false);
    }
  });

  it('refuses to write a capability the seed never created', async () => {
    const result = await updateModuleConfiguration(fakeDb([]), 'card-issuer', { validCvv: '000' });
    expect(result.ok).toBe(false);
    // Creating one on the fly would let a typo invent an engine whose configuration nothing reads.
    if (!result.ok) expect(result.text).toContain('no configuration record');
  });

  it('records who changed it, because a configuration change is an audited act', async () => {
    const db = fakeDb([cardRecord({ validCvv: '123' })]);
    const result = await updateModuleConfiguration(db, 'card-issuer', { validCvv: '456' }, 'ops-officer');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.bankModuleConfiguration).toEqual({ validCvv: '456' });
      expect(result.record.bankModuleConfigurationUpdatedBy).toBe('ops-officer');
    }
  });
});

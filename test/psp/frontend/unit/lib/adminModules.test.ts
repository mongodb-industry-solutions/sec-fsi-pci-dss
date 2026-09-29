/**
 * Unit tests (dev.v8 P8, §2.6): every /system/admin/modules entry carries a module-type label so an
 * operator can tell Core from a replaceable Built-in Provider at a glance.
 */
import { describe, it, expect } from 'vitest';
import {
  CORE_ADMIN_MODULES,
  builtInProviderModules,
  adminModuleList,
  MODULE_TYPE_LABEL,
} from '../../../../../psp/frontend/src/config/adminModules';

describe('admin module-type labels (§2.6)', () => {
  it('labels every core module as Core', () => {
    expect(CORE_ADMIN_MODULES.length).toBeGreaterThanOrEqual(1);
    for (const m of CORE_ADMIN_MODULES) expect(m.moduleType).toBe('core');
  });

  it('offers a module screen only for the capabilities the PROVIDER administers', () => {
    // v37: five capabilities left this list. The bank owns the card issuer, card authorisation, account
    // information, payment initiation and credit assessment, and their engine rules are administered in the
    // bank's own app against the bank's own API. The provider offering a second screen for them would be two
    // places to change one setting, with no way to tell which one the engine had read.
    const providers = builtInProviderModules();
    const keys = providers.map((m) => m.key);
    for (const m of providers) expect(m.moduleType).toBe('built-in-provider');

    // What the provider still owns: its own risk and due-diligence engines.
    for (const own of ['fds', 'aml', 'hrp', 'vop', 'kyc', 'kyb']) {
      expect(keys, `${own} is the provider's own engine`).toContain(own);
    }
    // Purely the bank's: nothing but engine rules, so the provider offers no screen at all. A screen
    // reappearing here is the duplication this asserts against.
    for (const banks of ['card-authorization', 'payment-initiation', 'credit-bureau']) {
      expect(keys, `${banks} is administered at the bank now`).not.toContain(banks);
    }
    // These two keep a screen, but for the provider's OWN records rather than the bank's rules: the cards its
    // customers have on file, and its linked account records. Their configuration tab is what moved.
    for (const shared of ['card-issuer', 'account-information']) {
      expect(keys, `${shared} still administers the provider's own records`).toContain(shared);
    }
  });

  it('every entry in the combined list has a renderable type label', () => {
    for (const m of adminModuleList()) {
      expect(MODULE_TYPE_LABEL[m.moduleType]).toBeTruthy();
      expect(['Core', 'Built-in Provider']).toContain(MODULE_TYPE_LABEL[m.moduleType]);
    }
  });
});

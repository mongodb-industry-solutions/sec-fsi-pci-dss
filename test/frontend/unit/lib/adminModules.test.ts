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
} from '../../../../frontend/src/config/adminModules';

describe('admin module-type labels (§2.6)', () => {
  it('labels every core module as Core', () => {
    expect(CORE_ADMIN_MODULES.length).toBeGreaterThanOrEqual(1);
    for (const m of CORE_ADMIN_MODULES) expect(m.moduleType).toBe('core');
  });

  it('labels every built-in provider engine as built-in-provider (the 8 capabilities)', () => {
    const providers = builtInProviderModules();
    expect(providers).toHaveLength(8);
    for (const m of providers) expect(m.moduleType).toBe('built-in-provider');
    expect(providers.map((m) => m.key)).toContain('card-issuer');
    expect(providers.map((m) => m.key)).toContain('fds');
  });

  it('every entry in the combined list has a renderable type label', () => {
    for (const m of adminModuleList()) {
      expect(MODULE_TYPE_LABEL[m.moduleType]).toBeTruthy();
      expect(['Core', 'Built-in Provider']).toContain(MODULE_TYPE_LABEL[m.moduleType]);
    }
  });
});

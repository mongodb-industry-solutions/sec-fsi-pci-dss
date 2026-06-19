// §2.6: /system/admin/modules lists ALL configurable modules — PSP core modules AND built-in provider
// modules — in one list, so every entry must carry a module-type label ('Core' | 'Built-in Provider')
// to tell at a glance whether an operator is configuring core system behavior or a replaceable adapter.
import { CAPABILITY_LIST } from './capabilities';

export type ModuleType = 'core' | 'built-in-provider';

export const MODULE_TYPE_LABEL: Record<ModuleType, string> = {
  core: 'Core',
  'built-in-provider': 'Built-in Provider',
};

export interface AdminModuleEntry {
  key: string;
  label: string;
  description: string;
  href: string;
  moduleType: ModuleType;
  /** Grouping bucket for the UI (a core group, or the provider's owning domain). */
  group: string;
}

// PSP core modules surfaced on the admin page (configurable core behavior, not provider adapters).
export const CORE_ADMIN_MODULES: AdminModuleEntry[] = [
  {
    key: 'domain',
    label: 'Auth Domains',
    description: 'Authentication-domain registry; full CRUD (BIAN SD-16)',
    href: '/system/admin/modules/domains',
    moduleType: 'core',
    group: 'Core',
  },
];

// Built-in provider modules: the capabilities that ship an internal engine (replaceable by a vendor).
export function builtInProviderModules(): AdminModuleEntry[] {
  return CAPABILITY_LIST.filter((c) => c.hasModule).map((c) => ({
    key: c.capability,
    label: c.label,
    description: c.bianServiceDomain,
    href: `/system/admin/modules/${c.capability}`,
    moduleType: 'built-in-provider' as const,
    group: c.moduleDomain ?? 'other',
  }));
}

// The full labeled list (core first), as rendered by /system/admin/modules.
export function adminModuleList(): AdminModuleEntry[] {
  return [...CORE_ADMIN_MODULES, ...builtInProviderModules()];
}

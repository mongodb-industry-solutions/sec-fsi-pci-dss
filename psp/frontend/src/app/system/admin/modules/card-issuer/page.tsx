'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { CreditCard, Save, Plus, Trash2, ListChecks } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { RequirePermission } from '../../../../../components/RequirePermission';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../lib/permissions';
import { CardsAdminPanel } from '../_components/CardsAdminPanel';
import { ModuleTabsBar, useActiveTab, type ModuleTab } from '../_components/ModuleTabs';

// Unified Card Issuer module admin (v29.1): one page with "Configuration/Policies" and "Cards" tabs.
// PCI DSS: the valid CVV is a fixed demo value, never a real card secret, and no PAN/CVV is stored.

interface NetworkForm {
  name: string;
  prefixes: string;  // comma-separated in the form; string[] when stored
  lengths: string;   // comma-separated in the form; number[] when stored
  cvvLength: number;
  enabled: boolean;
}

// Mirror of the backend DEFAULT_CARD_ISSUER_CONFIG, used when no config is stored yet.
const DEFAULT_NETWORKS: NetworkForm[] = [
  { name: 'VISA',       prefixes: '4',                  lengths: '13, 16, 19', cvvLength: 3, enabled: true },
  { name: 'MASTERCARD', prefixes: '51-55, 2221-2720',   lengths: '16',         cvvLength: 3, enabled: true },
  { name: 'AMEX',       prefixes: '34, 37',             lengths: '15',         cvvLength: 4, enabled: true },
  { name: 'DISCOVER',   prefixes: '6011, 644-649, 65',  lengths: '16, 19',     cvvLength: 3, enabled: true },
];

const CAP = 'card-issuer';

function toForm(networks: unknown): NetworkForm[] {
  if (!Array.isArray(networks) || networks.length === 0) return DEFAULT_NETWORKS;
  return networks.map((n) => {
    const nw = n as { name?: string; prefixes?: unknown[]; lengths?: unknown[]; cvvLength?: number; enabled?: boolean };
    return {
      name: String(nw.name ?? ''),
      prefixes: Array.isArray(nw.prefixes) ? nw.prefixes.join(', ') : '',
      lengths: Array.isArray(nw.lengths) ? nw.lengths.join(', ') : '',
      cvvLength: typeof nw.cvvLength === 'number' ? nw.cvvLength : 3,
      enabled: nw.enabled !== false,
    };
  });
}

function csvToStrings(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}
function csvToNumbers(s: string): number[] {
  return csvToStrings(s).map(Number).filter((n) => Number.isFinite(n));
}
// v37: the configuration tab is gone. The rules an issuer validates a card against are the BANK's, and they
// are administered in the bank's own app against its own API. What is left here is what the provider actually
// owns: the cards its customers have on file.
const TABS: ModuleTab[] = [
  { key: 'cards', label: 'Cards' },
];

function CardIssuerModule() {
  const [tab, setTab] = useActiveTab(TABS, 'cards');
  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'Cards on file' }]} />
      <SectionHeader
        icon={CreditCard}
        title="Cards on file"
        description="The cards this provider's customers have saved: their surrogate token, their masked display and their funding account. No card number is held here, and the issuer's rules are administered at the bank."
      />
      <ModuleTabsBar tabs={TABS} active={tab} onChange={setTab} />
      <RequirePermission resource="cards" action="view">
        <CardsAdminPanel />
      </RequirePermission>
    </div>
  );
}

export default function CardIssuerModulePage() {
  return (
    <RequirePermission resource="modules" action="view">
      <Suspense fallback={<div className="w-full px-5 py-8 text-sm text-gray-400">Loading…</div>}>
        <CardIssuerModule />
      </Suspense>
    </RequirePermission>
  );
}

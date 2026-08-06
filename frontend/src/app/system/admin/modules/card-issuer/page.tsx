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
// PCI DSS Req 3.2: the valid CVV is a fixed demo value, never a real card secret, and no PAN/CVV is stored.

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

function CardIssuerConfigPanel() {
  const token = getToken() ?? '';
  const notify = useNotify();
  const { can } = useEffectivePermissions();
  const canEdit = can('modules', 'manage'); // manager has modules:view only; only operations_officer may edit

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validCvv, setValidCvv] = useState('123');
  const [cvvMode, setCvvMode] = useState<'both' | 'global' | 'per_card'>('both');
  const [enforceLuhn, setEnforceLuhn] = useState(true);
  const [networks, setNetworks] = useState<NetworkForm[]>(DEFAULT_NETWORKS);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const c = await api.modules.getConfig(CAP, token);
        const mc = (c?.moduleConfig as Record<string, unknown>) ?? {};
        setValidCvv(typeof mc.validCvv === 'string' && mc.validCvv ? mc.validCvv : '123');
        setCvvMode(mc.cvvMode === 'global' || mc.cvvMode === 'per_card' ? mc.cvvMode : 'both');
        setEnforceLuhn(typeof mc.enforceLuhn === 'boolean' ? mc.enforceLuhn : true);
        setNetworks(toForm(mc.networks));
      } catch {
        setNetworks(DEFAULT_NETWORKS);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  function updateNetwork(i: number, patch: Partial<NetworkForm>) {
    setNetworks((prev) => prev.map((n, idx) => (idx === i ? { ...n, ...patch } : n)));
  }
  function addNetwork() {
    setNetworks((prev) => [...prev, { name : '', prefixes : '', lengths: '16', cvvLength: 3, enabled: true }]);
  }
  function removeNetwork(i: number) {
    setNetworks((prev) => prev.filter((_, idx) => idx !== i));
  }

  const cvvInvalid = !/^\d{3,4}$/.test(validCvv);

  async function save() {
    if (cvvInvalid) { notify('Valid CVV must be 3 or 4 digits', 'error'); return; }
    setSaving(true);
    try {
      const moduleConfig = {
        validCvv,
        cvvMode,
        enforceLuhn,
        networks: networks
          .filter((n) => n.name.trim())
          .map((n) => ({
            name: n.name.trim().toUpperCase(),
            prefixes: csvToStrings(n.prefixes),
            lengths: csvToNumbers(n.lengths),
            cvvLength: n.cvvLength,
            enabled: n.enabled,
          })),
      };
      await api.modules.updateConfig(CAP, moduleConfig, token);
      notify('Card Issuer rules saved', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <>
      {!canEdit && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
          Read-only: your role can view this configuration but not change it (requires <code className="font-mono text-xs">modules:manage</code>).
        </div>
      )}
      <fieldset disabled={!canEdit} className="space-y-5 border-0 p-0 m-0 min-w-0">
      {/* General validation rules */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 text-sm">Validation rules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Valid CVV (demo)</label>
            <input
              value={validCvv}
              onChange={(e) => setValidCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className={`w-32 border rounded-lg px-3 py-2 text-sm font-mono ${cvvInvalid ? 'border-red-400' : ''}`}
              placeholder="123"
            />
            <p className="text-xs text-gray-500 mt-1">The global CVV this module accepts. Set here (not hardcoded): the value you save applies to every card until changed. A demo value, never a real card secret and never stored.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CVV acceptance mode (demo)</label>
            <select
              value={cvvMode}
              onChange={(e) => setCvvMode(e.target.value as 'both' | 'global' | 'per_card')}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="both">both (global or per-card)</option>
              <option value="global">global (fixed demo CVV only)</option>
              <option value="per_card">per_card (real per-card CVV only)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              both: accepts the global CVV configured above ({validCvv || '123'}) or the card&apos;s own derived CVV. global: only the configured value. per_card: only the card&apos;s own CVV.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Card-number checksum</label>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-2">
              <input type="checkbox" checked={enforceLuhn} onChange={(e) => setEnforceLuhn(e.target.checked)} className="rounded" />
              Enforce Luhn check on full card numbers
            </label>
            <p className="text-xs text-gray-500 mt-1">Applied when a full PAN is provided (direct test). The tokenized payment path sends only a masked PAN.</p>
          </div>
        </div>
      </div>

      {/* Supported networks (extensible) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 text-sm">Supported card networks</h2>
          <button onClick={addNetwork} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:border-gray-500 text-gray-700 transition-colors">
            <Plus size={13} /> Add network
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Add or edit a network to extend coverage. Prefixes accept an exact start (<code>4</code>, <code>34</code>) or an inclusive range over the leading digits (<code>51-55</code>, <code>2221-2720</code>). Lengths and prefixes are comma-separated.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase border-b">
                <th className="py-2 pr-3 font-medium">Network</th>
                <th className="py-2 pr-3 font-medium">Prefixes</th>
                <th className="py-2 pr-3 font-medium">Lengths</th>
                <th className="py-2 pr-3 font-medium">CVV len</th>
                <th className="py-2 pr-3 font-medium">Enabled</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {networks.map((n, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <input value={n.name} onChange={(e) => updateNetwork(i, { name: e.target.value })}
                      className="w-28 border rounded px-2 py-1 text-sm font-medium" placeholder="VISA" />
                  </td>
                  <td className="py-2 pr-3">
                    <input value={n.prefixes} onChange={(e) => updateNetwork(i, { prefixes: e.target.value })}
                      className="w-40 border rounded px-2 py-1 text-sm font-mono" placeholder="4, 51-55" />
                  </td>
                  <td className="py-2 pr-3">
                    <input value={n.lengths} onChange={(e) => updateNetwork(i, { lengths: e.target.value })}
                      className="w-28 border rounded px-2 py-1 text-sm font-mono" placeholder="16, 19" />
                  </td>
                  <td className="py-2 pr-3">
                    <input type="number" min={3} max={4} value={n.cvvLength}
                      onChange={(e) => updateNetwork(i, { cvvLength: Number(e.target.value) || 3 })}
                      className="w-16 border rounded px-2 py-1 text-sm font-mono" />
                  </td>
                  <td className="py-2 pr-3">
                    <input type="checkbox" checked={n.enabled} onChange={(e) => updateNetwork(i, { enabled: e.target.checked })} className="rounded" />
                  </td>
                  <td className="py-2 text-right">
                    <button onClick={() => removeNetwork(i)} className="text-gray-400 hover:text-red-600 transition-colors" title="Remove network">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || cvvInvalid}
          className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
          <Save size={15} />{saving ? 'Saving…' : 'Save configuration'}
        </button>
        <Link href="/system/audit-events" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ListChecks size={14} /> View validation logs in audit events
        </Link>
      </div>
      </fieldset>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 mt-5">
        <strong>Logging:</strong> every validation request records a compliance event with the request and response payloads and the linked transaction id / case reference. The event never contains the PAN or CVV (only a masked PAN and whether a CVV was supplied), per PCI DSS Req 3.2 and Req 10.
      </div>
    </>
  );
}

const TABS: ModuleTab[] = [
  { key: 'config', label: 'Configuration' },
  { key: 'cards', label: 'Cards' },
];

function CardIssuerModule() {
  const [tab, setTab] = useActiveTab(TABS, 'config');
  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'Card Issuer' }]} />
      <SectionHeader
        icon={CreditCard}
        title="Card Issuer; Internal Module"
        description="Card validation policies plus global card administration, unified in one module surface."
        debugInfo="capability=card-issuer · SD-88 Payment Card · PCI DSS Req 3.2/3.3 (no SAD stored) · Req 7 · Req 10"
      />
      <ModuleTabsBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'config' ? <CardIssuerConfigPanel /> : (
        <RequirePermission resource="cards" action="view">
          <CardsAdminPanel />
        </RequirePermission>
      )}
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

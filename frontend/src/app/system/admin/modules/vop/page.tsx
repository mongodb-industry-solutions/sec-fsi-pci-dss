'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, Save, ListChecks } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../lib/permissions';
import { Tooltip } from '../../../../../components/Tooltip';

// Dedicated config UI for the internal VoP (Verification of Payee) engine (overrides the generic module
// editor for this capability). VoP is ADDITIONAL to FDS/AML/HRP; it confirms the payee name matches the
// destination account holder. DATA-DRIVEN: thresholds/strategy/policy/markets live in the capability
// moduleConfig; the backend /modules/vop/verify endpoint evaluates them on every check. PCI DSS Req 12.8 / Req 10.
const CAP = 'vop';

const DEFAULTS = {
  thresholds: { match: 95, closeMatch: 80 },
  strategy: { exact: true, normalized: true, tokenOrderInsensitive: true, fuzzy: true, maxEditDistance: 2, aliasMatch: false },
  policy: { closeMatch: 'warn', noMatch: 'warn', mandatoryAboveAmount: 0 },
  markets: ['ES', 'FR', 'DE', 'IT', 'NL', 'IE', 'PT', 'BE', 'AT', 'FI', 'GB'],
};

type Decision = 'block' | 'warn' | 'pass';

export default function VopModulePage() {
  const notify = useNotify();
  const { can } = useEffectivePermissions();
  const canEdit = can('modules', 'manage'); // manager has modules:view only; only operations_officer may edit
  const [token, setToken] = useState('');
  const [matchT, setMatchT] = useState(DEFAULTS.thresholds.match);
  const [closeT, setCloseT] = useState(DEFAULTS.thresholds.closeMatch);
  const [strategy, setStrategy] = useState(DEFAULTS.strategy);
  const [closeMatchPolicy, setCloseMatchPolicy] = useState<Decision>('warn');
  const [noMatchPolicy, setNoMatchPolicy] = useState<Decision>('warn');
  const [mandatoryAbove, setMandatoryAbove] = useState(0);
  const [markets, setMarkets] = useState(DEFAULTS.markets.join(', '));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) { setLoading(false); return; }
    api.modules.getConfig(CAP, t)
      .then((c: unknown) => {
        const mc = ((c as { moduleConfig?: Record<string, unknown> })?.moduleConfig ?? {}) as {
          thresholds?: { match?: number; closeMatch?: number };
          strategy?: typeof DEFAULTS.strategy;
          policy?: { closeMatch?: Decision; noMatch?: Decision; mandatoryAboveAmount?: number };
          markets?: string[];
        };
        setMatchT(mc.thresholds?.match ?? DEFAULTS.thresholds.match);
        setCloseT(mc.thresholds?.closeMatch ?? DEFAULTS.thresholds.closeMatch);
        setStrategy({ ...DEFAULTS.strategy, ...(mc.strategy ?? {}) });
        setCloseMatchPolicy(mc.policy?.closeMatch ?? 'warn');
        setNoMatchPolicy(mc.policy?.noMatch ?? 'warn');
        setMandatoryAbove(mc.policy?.mandatoryAboveAmount ?? 0);
        setMarkets((mc.markets ?? DEFAULTS.markets).join(', '));
      })
      .catch(() => { /* show defaults */ })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const moduleConfig = {
      thresholds: { match: Number(matchT), closeMatch: Number(closeT) },
      strategy: { ...strategy, maxEditDistance: Number(strategy.maxEditDistance) },
      policy: { closeMatch: closeMatchPolicy, noMatch: noMatchPolicy, mandatoryAboveAmount: Number(mandatoryAbove) },
      markets: markets.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
    };
    setSaving(true);
    try {
      await api.modules.updateConfig(CAP, moduleConfig, token);
      notify('Verification of Payee configuration saved', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (k: keyof typeof strategy) => setStrategy(s => ({ ...s, [k]: !s[k] }));

  if (loading) return <div className="w-full px-5 sm:px-8 py-6 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'Verification of Payee (VoP)' }]} />
      <SectionHeader icon={ShieldCheck} title="Verification of Payee (VoP)" description="Payee name-vs-account confirmation. Additional to FDS/AML/HRP; market-gated." debugInfo="capability=vop · SD-13 Party Data Management · PCI DSS Req 12.8 / Req 10" />

      {!canEdit && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
          Read-only: your role can view this configuration but not change it (requires <code className="font-mono text-xs">modules:manage</code>).
        </div>
      )}
      <fieldset disabled={!canEdit} className="space-y-5 border-0 p-0 m-0 min-w-0">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h3 className="font-semibold text-sm text-gray-900">Match thresholds</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-600">Match at or above (score)<Tooltip text="Match score (0–100) at or above which the declared payee name is treated as a FULL match to the destination account holder. Payments proceed without a VoP warning." />
            <input type="number" min="0" max="100" value={matchT} onChange={e => setMatchT(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-gray-600">Close match at or above (score)<Tooltip text="Lower score band: at or above this (but below the full-match threshold) the result is a CLOSE match, a possible-impersonation signal handled by the decision policy below. Below it, no_match." />
            <input type="number" min="0" max="100" value={closeT} onChange={e => setCloseT(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
        <h3 className="font-semibold text-sm text-gray-900">Matching strategy<Tooltip text="Which name-matching techniques the engine applies. The best score across all enabled techniques is used. More techniques = more tolerant matching." /></h3>
        {([
          ['exact', 'Exact match', 'Byte-for-byte identical names score 100.'],
          ['normalized', 'Case/diacritics-normalized', 'Ignore case, accents/diacritics and punctuation before comparing (e.g. "JOSÉ" == "jose").'],
          ['tokenOrderInsensitive', 'Token-order-insensitive', 'Ignore the order of name tokens (e.g. "John Smith" == "Smith John").'],
          ['fuzzy', 'Levenshtein fuzzy', 'Allow small typos/spelling differences within the max edit distance below.'],
          ['aliasMatch', 'Trade-name / alias match', 'Also try the payee trade-name / alias, not only the legal name.'],
        ] as const).map(([k, label, tip]) => (
          <label key={k} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={strategy[k] as boolean} onChange={() => toggle(k)} /> {label}<Tooltip text={tip} />
          </label>
        ))}
        <label className="text-xs text-gray-600 block mt-2">Max edit distance (fuzzy)<Tooltip text="Maximum Levenshtein edit distance (number of character insert/delete/substitute operations) still accepted as a fuzzy match. Higher = more tolerant of typos." />
          <input type="number" min="0" max="5" value={strategy.maxEditDistance} onChange={e => setStrategy(s => ({ ...s, maxEditDistance: Number(e.target.value) }))} className="mt-1 block w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h3 className="font-semibold text-sm text-gray-900">Decision policy<Tooltip text="What a non-full-match implies. VoP is an ADDITIONAL, independent check: it never replaces FDS/AML/HRP. Pass = allow, Warn = advisory anti-impersonation flag, Block = hold the request." /></h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-600">On close match<Tooltip text="Action when the result is a close_match (partial name match): pass, warn (advisory), or block (hold the request pending review)." />
            <select value={closeMatchPolicy} onChange={e => setCloseMatchPolicy(e.target.value as Decision)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value="pass">Pass</option><option value="warn">Warn (advisory)</option><option value="block">Block (hold)</option>
            </select>
          </label>
          <label className="text-xs text-gray-600">On no match<Tooltip text="Action when the name does NOT match the account holder (highest impersonation risk): pass, warn (advisory), or block (hold the request)." />
            <select value={noMatchPolicy} onChange={e => setNoMatchPolicy(e.target.value as Decision)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value="pass">Pass</option><option value="warn">Warn (advisory)</option><option value="block">Block (hold)</option>
            </select>
          </label>
        </div>
        <label className="text-xs text-gray-600 block">Mandatory (blocking on non-match) at or above amount (0 = advisory only)<Tooltip text="Amount threshold at/above which VoP becomes MANDATORY: any non-match blocks the request regardless of the policy above. 0 keeps VoP advisory for all amounts." />
          <input type="number" min="0" value={mandatoryAbove} onChange={e => setMandatoryAbove(Number(e.target.value))} className="mt-1 block w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
        <h3 className="font-semibold text-sm text-gray-900">Market gating<Tooltip text="VoP is a regional standard (EU Instant Payments Regulation, UK Confirmation of Payee). Outside the enabled markets the engine returns not_supported and never blocks (avoids false universality)." /></h3>
        <label className="text-xs text-gray-600 block">Enabled markets (ISO 3166-1 alpha-2, comma-separated). Outside these → <code>not_supported</code> (non-blocking).<Tooltip text="Comma-separated ISO 3166-1 alpha-2 country codes (e.g. ES, FR, DE, GB) where VoP is performed. A destination account outside this list yields not_supported (advisory, non-blocking)." />
          <input value={markets} onChange={e => setMarkets(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <p className="text-xs text-gray-500">Provider routing: stub engine now, swappable for the real EPC VoP inter-PSP API / UK CoP / AI-agent name-matcher (configured under Providers → groups).</p>
      </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium disabled:opacity-60">
          <Save size={14} />{saving ? 'Saving…' : 'Save configuration'}
        </button>
        <Link href="/system/audit-events?type=vop" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ListChecks size={14} /> View verification logs in audit events
        </Link>
      </div>
      </fieldset>
    </div>
  );
}

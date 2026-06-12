'use client';
import { useState } from 'react';
import { Settings as SettingsIcon, Check, Lock } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { useDebugMode } from '../../../../lib/debugMode';
import { api } from '../../../../lib/api';

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF'];
const SETTLEMENT_OPTIONS = ['T+1', 'T+2', 'T+3'];

export default function SettingsSectionPage() {
  const { token, merchant, refresh } = useRequireActiveMerchant();
  const { debugMode } = useDebugMode();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const initialCurrencies = merchant?.merchantAllowedCurrencies ?? ['USD'];
  const [currencies, setCurrencies] = useState<string[]>(initialCurrencies);
  const [settlement, setSettlement] = useState<string>(merchant?.merchantSettlementSchedule ?? 'T+2');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  if (!merchant) return null;

  const options = Array.from(new Set([...CURRENCY_OPTIONS, ...initialCurrencies]));
  const dirty =
    JSON.stringify([...currencies].sort()) !== JSON.stringify([...initialCurrencies].sort()) ||
    settlement !== (merchant.merchantSettlementSchedule ?? 'T+2');

  function toggleCurrency(c: string) {
    setSaved(false);
    setCurrencies((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function save() {
    if (currencies.length === 0) { setError('Select at least one currency.'); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      await api.merchants.update(
        merchantId,
        { merchantAllowedCurrencies: currencies, merchantSettlementSchedule: settlement },
        token,
      );
      setSaved(true);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    }
    setSaving(false);
  }

  const fmtLimit = (n?: number) =>
    n === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5 max-w-2xl">
      <SectionHeader
        icon={SettingsIcon}
        title="Settings"
        description="Operational configuration for your merchant account."
        info="You can self-serve operational settings here. Risk-governed values, such as your transaction limit and account status, are managed by the PSP and shown for reference."
        debugInfo="BIAN SD-89 Merchant Relations · PCI DSS Req 12.8 (TPSP responsibilities)"
      />

      {/* Operational settings (owner editable) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        <h2 className="font-semibold text-gray-800 text-sm">Operational settings</h2>

        {/* Allowed currencies */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Accepted currencies</label>
          <p className="text-xs text-gray-500 mb-2">Currencies you can charge on checkout sessions and payment links.</p>
          <div className="flex flex-wrap gap-2">
            {options.map((c) => {
              const on = currencies.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCurrency(c)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    on
                      ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {/* Settlement schedule */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Settlement schedule</label>
          <p className="text-xs text-gray-500 mb-2">How soon captured funds are settled to your account.</p>
          <select
            value={settlement}
            onChange={(e) => { setSettlement(e.target.value); setSaved(false); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
          >
            {SETTLEMENT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {saved && !dirty && (
            <span className="inline-flex items-center gap-1 text-sm text-green-600">
              <Check size={15} /> Saved
            </span>
          )}
        </div>
      </div>

      {/* PSP-governed (read-only) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Lock size={14} className="text-gray-400" />
          <h2 className="font-semibold text-gray-800 text-sm">PSP-governed</h2>
        </div>
        <p className="text-xs text-gray-500">
          These values are set by the PSP under your merchant agreement. Contact your merchant officer to request a change.
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-gray-500">Per-transaction limit</dt>
            <dd className="font-medium text-gray-800">{fmtLimit(merchant.merchantTransactionLimitAmount)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Account status</dt>
            <dd className="font-medium text-gray-800 capitalize">{merchant.merchantAgreementStatus}</dd>
          </div>
          {merchant.merchantTier && (
            <div>
              <dt className="text-gray-500">Tier</dt>
              <dd className="font-medium text-gray-800">{merchant.merchantTier}</dd>
            </div>
          )}
          {merchant.merchantRiskCategory && (
            <div>
              <dt className="text-gray-500">Risk category</dt>
              <dd className="font-medium text-gray-800 capitalize">{merchant.merchantRiskCategory}</dd>
            </div>
          )}
        </dl>
        {debugMode && (
          <p className="text-[10px] font-mono text-gray-400 pt-1">
            merchantTransactionLimitAmount, merchantAgreementStatus: PSP staff only (merchant_officer / security_auditor)
          </p>
        )}
      </div>
    </div>
  );
}

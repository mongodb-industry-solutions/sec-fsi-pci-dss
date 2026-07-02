'use client';
import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Check, Lock, AlertTriangle, X, Landmark } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { useRequireActiveMerchant } from '../../../../../lib/merchantContext';
import { useDebugMode } from '../../../../../lib/debugMode';
import { api } from '../../../../../lib/api';

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF'];
const SETTLEMENT_OPTIONS = ['T+1', 'T+2', 'T+3'];

interface PayoutAccountOption {
  payoutAccountInstanceReference: string;
  payoutAccountBankName?: string;
  payoutAccountCurrency: string;
  payoutAccountAlias?: string;
  payoutAccountIsDefault: boolean;
}

export default function SettingsSectionPage() {
  const { token, merchant, refresh } = useRequireActiveMerchant();
  const { debugMode } = useDebugMode();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const ownerPartyRef = (merchant as unknown as Record<string, unknown> | null)?.merchantOwnerPartyReference as string | undefined;

  const initialCurrencies = merchant?.merchantAllowedCurrencies ?? ['USD'];
  const [currencies, setCurrencies] = useState<string[]>(initialCurrencies);
  const [settlement, setSettlement] = useState<string>(merchant?.merchantSettlementSchedule ?? 'T+2');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Payout account selection (E3: default payout account for merchant settlement)
  const [payoutAccounts, setPayoutAccounts] = useState<PayoutAccountOption[]>([]);
  const [defaultPayoutRef, setDefaultPayoutRef] = useState<string>(
    ((merchant as unknown as Record<string, unknown> | null)?.merchantDefaultPayoutAccountReference as string | undefined) ?? ''
  );
  const [payoutAccountsLoaded, setPayoutAccountsLoaded] = useState(false);

  useEffect(() => {
    if (!ownerPartyRef || !token || payoutAccountsLoaded) return;
    api.accounts.list(ownerPartyRef, token, { status: 'active' })
      .then((r) => {
        setPayoutAccounts(r.results as unknown as PayoutAccountOption[]);
        setPayoutAccountsLoaded(true);
      })
      .catch(() => setPayoutAccountsLoaded(true));
  }, [ownerPartyRef, token, payoutAccountsLoaded]);

  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState('');

  async function deactivate() {
    setDeactivating(true);
    setDeactivateError('');
    try {
      await api.merchants.deactivate(merchantId, token, deactivateReason || undefined);
      refresh();
      setShowDeactivateModal(false);
    } catch (err) {
      setDeactivateError(err instanceof Error ? err.message : 'Failed to deactivate merchant.');
    }
    setDeactivating(false);
  }

  if (!merchant) return null;

  const options = Array.from(new Set([...CURRENCY_OPTIONS, ...initialCurrencies]));
  const initialDefaultPayoutRef = ((merchant as unknown as Record<string, unknown> | null)?.merchantDefaultPayoutAccountReference as string | undefined) ?? '';
  const dirty =
    JSON.stringify([...currencies].sort()) !== JSON.stringify([...initialCurrencies].sort()) ||
    settlement !== (merchant.merchantSettlementSchedule ?? 'T+2') ||
    defaultPayoutRef !== initialDefaultPayoutRef;

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
        {
          merchantAllowedCurrencies: currencies,
          merchantSettlementSchedule: settlement,
          ...(defaultPayoutRef ? { merchantDefaultPayoutAccountReference: defaultPayoutRef } : {}),
        },
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
    n === undefined ? '-' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
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

        {/* Default Payout Account (E3 — BIAN SD-89 / SD-66) */}
        {ownerPartyRef && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <span className="flex items-center gap-1.5">
                <Landmark size={14} className="text-gray-400" />
                Default Payout Account
              </span>
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Payout settlements are credited to this account. Must be one of your active bank accounts (BIAN SD-66).
            </p>
            {!payoutAccountsLoaded ? (
              <div className="text-xs text-gray-400">Loading accounts…</div>
            ) : payoutAccounts.length === 0 ? (
              <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No active payout accounts found. Register a bank account under Payout Accounts first.
              </div>
            ) : (
              <select
                value={defaultPayoutRef}
                onChange={(e) => { setDefaultPayoutRef(e.target.value); setSaved(false); }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 w-full max-w-sm"
              >
                <option value="">— Not set (fallback to owner default) —</option>
                {payoutAccounts.map((a) => (
                  <option key={a.payoutAccountInstanceReference} value={a.payoutAccountInstanceReference}>
                    {a.payoutAccountAlias || a.payoutAccountBankName || 'Account'} · {a.payoutAccountCurrency}
                    {a.payoutAccountIsDefault ? ' ★' : ''}
                  </option>
                ))}
              </select>
            )}
            {debugMode && (
              <p className="text-[10px] font-mono text-gray-400 mt-1">
                merchantDefaultPayoutAccountReference: FK → payoutAccountArrangement (SD-66). Ownership guard: account.partyInstanceReference must match merchantOwnerPartyReference.
              </p>
            )}
          </div>
        )}

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

      {/* Danger zone */}
      {merchant.merchantAgreementStatus !== 'suspended' && (
        <div className="bg-white rounded-xl border border-red-200 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-500" />
            <h2 className="font-semibold text-gray-800 text-sm">Danger zone</h2>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Deactivate this merchant account</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Suspends all payment processing, OAuth authentication, and new operations immediately.
                The account and all its data are retained for audit compliance (PCI DSS Req 10). You can request reactivation from your merchant officer.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setShowDeactivateModal(true); setDeactivateReason(''); setDeactivateError(''); }}
              className="shrink-0 border border-red-300 text-red-600 hover:bg-red-50 font-medium px-4 py-2 rounded-lg transition-colors text-sm"
            >
              Deactivate
            </button>
          </div>
        </div>
      )}

      {/* Deactivate confirmation modal */}
      {showDeactivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500 shrink-0" />
                <h3 className="font-semibold text-gray-900">Deactivate merchant account?</h3>
              </div>
              <button type="button" onClick={() => setShowDeactivateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              This will immediately suspend <strong>{merchant.merchantName}</strong>.
              No payments, OAuth logins, or new operations will be permitted.
              The account data is preserved for audit purposes and can be reactivated by your merchant officer.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reason (optional)</label>
              <textarea
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
                placeholder="e.g. Ceasing operations, switching provider..."
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
              />
            </div>
            {deactivateError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{deactivateError}</p>
            )}
            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowDeactivateModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deactivate}
                disabled={deactivating}
                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-60"
              >
                {deactivating ? 'Deactivating...' : 'Yes, deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

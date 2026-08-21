'use client';
import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Check, Lock, AlertTriangle, X, Landmark, ShieldCheck } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { useRequireActiveMerchant } from '../../../../../lib/merchantContext';
import { useDebugMode } from '../../../../../lib/debugMode';
import { api } from '../../../../../lib/api';
import { formatAmount } from '../../../../../lib/money';

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
  const { token, role, merchant, refresh } = useRequireActiveMerchant();
  const { debugMode } = useDebugMode();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const ownerPartyRef = (merchant as unknown as Record<string, unknown> | null)?.merchantOwnerPartyReference as string | undefined;

  // v18 B-09: commission rate is editable only for roles with merchants:manage, the merchant
  // owner (customer) or PSP staff (merchant_officer / security_auditor). Others see it read-only.
  const canManageCommission = role === 'customer' || role === 'merchant_officer' || role === 'security_auditor';

  const initialCurrencies = merchant?.merchantAllowedCurrencies ?? ['USD'];
  const [currencies, setCurrencies] = useState<string[]>(initialCurrencies);
  const [settlement, setSettlement] = useState<string>(merchant?.merchantSettlementSchedule ?? 'T+2');
  // v18 B-07: commission per operation, stored 0..1, displayed as %.
  const initialCommissionPct = merchant?.merchantCommissionRate !== undefined
    ? String(Number((merchant.merchantCommissionRate * 100).toFixed(2)))
    : '';
  const [commissionPct, setCommissionPct] = useState<string>(initialCommissionPct);
  const [commissionError, setCommissionError] = useState('');
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
        const accts = r.results as unknown as PayoutAccountOption[];
        setPayoutAccounts(accts);
        setPayoutAccountsLoaded(true);
        // Auto-select: if no merchant default is set, pre-select the owner's primary account
        if (!defaultPayoutRef) {
          const primary = accts.find((a) => a.payoutAccountIsDefault) ?? accts[0];
          if (primary) setDefaultPayoutRef(primary.payoutAccountInstanceReference);
        }
      })
      .catch(() => setPayoutAccountsLoaded(true));
  }, [ownerPartyRef, token, payoutAccountsLoaded, defaultPayoutRef]);

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
    defaultPayoutRef !== initialDefaultPayoutRef ||
    commissionPct.trim() !== initialCommissionPct;

  function toggleCurrency(c: string) {
    setSaved(false);
    setCurrencies((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function save() {
    if (currencies.length === 0) { setError('Select at least one currency.'); return; }
    // v18 B-08: validate commission rate client-side (stored 0..1, entered as %).
    let commissionRate: number | undefined;
    if (canManageCommission && commissionPct.trim() !== '') {
      const pct = Number(commissionPct);
      if (!isFinite(pct) || pct < 0 || pct > 100) {
        setCommissionError('Commission must be a percentage between 0 and 100.');
        return;
      }
      commissionRate = Number((pct / 100).toFixed(4)); // 0..1, max 4 decimals
    }
    setCommissionError('');
    setSaving(true); setError(''); setSaved(false);
    try {
      await api.merchants.update(
        merchantId,
        {
          merchantAllowedCurrencies: currencies,
          merchantSettlementSchedule: settlement,
          ...(defaultPayoutRef ? { merchantDefaultPayoutAccountReference: defaultPayoutRef } : {}),
          ...(commissionRate !== undefined ? { merchantCommissionRate: commissionRate } : {}),
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
    n === undefined ? '-' : formatAmount(n, 'USD');

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={SettingsIcon}
        title="Settings"
        description="Operational configuration for your merchant account."
        info="You can self-serve operational settings here. Risk-governed values, such as your transaction limit and account status, are managed by the PSP and shown for reference."
        debugInfo="Merchant Relations · PCI DSS (TPSP responsibilities)"
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

        {/* Commission per operation (v18 B-07:) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Commission per operation</label>
          <p className="text-xs text-gray-500 mb-2">
            The fee this merchant charges per operation, recognized as commission revenue.
          </p>
          {canManageCommission ? (
            <>
              <div className="flex items-center gap-2 max-w-[200px]">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={commissionPct}
                  onChange={(e) => { setCommissionPct(e.target.value); setSaved(false); setCommissionError(''); }}
                  placeholder="e.g. 2.5"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
              {commissionError && <p className="text-xs text-red-600 mt-1">{commissionError}</p>}
            </>
          ) : (
            <p className="text-sm font-medium text-gray-800">
              {merchant.merchantCommissionRate !== undefined
                ? `${Number((merchant.merchantCommissionRate * 100).toFixed(2))}%`
                : 'Not set'}
            </p>
          )}
          {debugMode && (
            <p className="text-[10px] font-mono text-gray-400 mt-1">
              merchantCommissionRate (0..1, ≤4 decimals) · editable: merchants:manage · audited on change
            </p>
          )}
        </div>

        {/* Default Payout Account (E3:) */}
        {ownerPartyRef && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <span className="flex items-center gap-1.5">
                <Landmark size={14} className="text-gray-400" />
                Settlement payout account
              </span>
            </label>
            <p className="text-xs text-gray-500 mb-2">
              All customer payments and settlements will be credited to this bank account. Choose from your registered active accounts.
            </p>
            {!payoutAccountsLoaded ? (
              <div className="text-xs text-gray-400">Loading accounts…</div>
            ) : payoutAccounts.length === 0 ? (
              <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No active payout accounts found. Register a bank account under <strong>Payout Accounts</strong> first.
              </div>
            ) : (
              <div className="space-y-2">
                <select
                  value={defaultPayoutRef}
                  onChange={(e) => { setDefaultPayoutRef(e.target.value); setSaved(false); }}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 w-full max-w-md"
                >
                  {payoutAccounts.map((a) => (
                    <option key={a.payoutAccountInstanceReference} value={a.payoutAccountInstanceReference}>
                      {a.payoutAccountIsDefault ? '★ ' : ''}{a.payoutAccountAlias || a.payoutAccountBankName || 'Account'} · {a.payoutAccountCurrency}
                    </option>
                  ))}
                </select>
                {/* Preview of selected account */}
                {defaultPayoutRef && (() => {
                  const selected = payoutAccounts.find(a => a.payoutAccountInstanceReference === defaultPayoutRef);
                  if (!selected) return null;
                  return (
                    <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <Landmark size={12} className="text-gray-400 shrink-0" />
                      <span className="font-medium text-gray-700">{selected.payoutAccountAlias || selected.payoutAccountBankName || 'Account'}</span>
                      <span className="text-gray-300">·</span>
                      <span>{selected.payoutAccountCurrency}</span>
                      {selected.payoutAccountIsDefault && (
                        <span className="text-amber-500 font-medium">★ Primary</span>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            {debugMode && (
              <p className="text-[10px] font-mono text-gray-400 mt-1">
                merchantDefaultPayoutAccountReference → payoutAccountArrangement. Guard: account.partyInstanceReference must equal merchantOwnerPartyReference.
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

      {/* Business verification (KYB): read-only, active merchants */}
      {merchant.merchantAgreementKybCheck && (() => {
        const kyb = merchant.merchantAgreementKybCheck;
        const KYB_COLORS: Record<string, string> = {
          verified: 'bg-green-100 text-green-800 border-green-200',
          initiated: 'bg-amber-100 text-amber-800 border-amber-200',
          rejected: 'bg-red-100 text-red-800 border-red-200',
          expired: 'bg-orange-100 text-orange-800 border-orange-200',
        };
        const KYB_LABELS: Record<string, string> = {
          verified: 'Verified',
          initiated: 'Pending',
          rejected: 'Rejected',
          expired: 'Expired',
        };
        const status = kyb.merchantAgreementKybCheckStatus;
        return (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-gray-400" />
              <h2 className="font-semibold text-gray-800 text-sm">Business verification (KYB)</h2>
            </div>
            <p className="text-xs text-gray-500">
              Know Your Business identity verification performed by the PSP during onboarding (PCI DSS).
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div className="text-gray-500">KYB status</div>
              <div>
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${KYB_COLORS[status] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                  {KYB_LABELS[status] ?? status}
                </span>
              </div>
              {kyb.merchantAgreementKybCheckCompletedDate && (
                <>
                  <div className="text-gray-500">Completed on</div>
                  <div className="text-gray-800">
                    {new Date(kyb.merchantAgreementKybCheckCompletedDate).toLocaleDateString()}
                  </div>
                </>
              )}
              {debugMode && kyb.merchantAgreementKybCheckReference && (
                <>
                  <div className="text-gray-500">Reference</div>
                  <div className="font-mono text-xs text-gray-500">{kyb.merchantAgreementKybCheckReference}</div>
                </>
              )}
              {debugMode && kyb.merchantAgreementKybCheckNotes && (
                <>
                  <div className="text-gray-500">Notes</div>
                  <div className="text-xs text-gray-500">{kyb.merchantAgreementKybCheckNotes}</div>
                </>
              )}
            </div>
            {debugMode && (
              <p className="text-[10px] font-mono text-gray-400 pt-1">
                KybCheck · PCI DSS
              </p>
            )}
          </div>
        );
      })()}

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
                The account and all its data are retained for audit compliance (PCI DSS). You can request reactivation from your merchant officer.
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

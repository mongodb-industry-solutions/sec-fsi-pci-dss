'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { useDebugMode } from '../../../lib/debugMode';
import {
  Link2, ShoppingCart, Key, Webhook, Copy, Check, Plus, Trash2, ExternalLink,
  Clock, CheckCircle2, XCircle, Store, ChevronRight, ShieldCheck,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'checkout' | 'links' | 'keys' | 'webhook';
type MerchantState = 'loading' | 'no_merchant' | 'under_review' | 'agreed' | 'active' | 'rejected' | 'analyst_list';

type KybCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

interface MerchantAgreementKybCheck {
  merchantAgreementKybCheckStatus: KybCheckStatus;
  merchantAgreementKybCheckCompletedDate?: string;
  merchantAgreementKybCheckReference?: string;
  merchantAgreementKybCheckNotes?: string;
  merchantAgreementKybCheckPerformedByPartyReference?: string;
}

interface MerchantRecord {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantCategoryCode: string;
  merchantCountryCode: string;
  merchantAgreementStatus: string;
  merchantWebhookEndpoint?: string;
  merchantRiskCategory?: string;
  merchantTier?: string;
  merchantAllowedCurrencies?: string[];
  merchantTransactionLimitAmount?: number;
  merchantSettlementSchedule?: string;
  merchantReviewNote?: string;
  merchantAgreementKybCheck?: MerchantAgreementKybCheck;  // BQ:Step — BIAN SD-89. PCI DSS Req 12.8
  recordCreatedDateTime?: string;
}

const KYB_STATUS_COLORS: Record<KybCheckStatus, string> = {
  verified: 'bg-green-100 text-green-800 border-green-200',
  initiated: 'bg-amber-100 text-amber-800 border-amber-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  expired: 'bg-orange-100 text-orange-800 border-orange-200',
};

const KYB_STATUS_LABELS: Record<KybCheckStatus, string> = {
  verified: 'KYB Verified',
  initiated: 'KYB Pending',
  rejected: 'KYB Rejected',
  expired: 'KYB Expired',
};

function KybStatusBadge({ kyb, compact }: { kyb: MerchantAgreementKybCheck; compact?: boolean }) {
  const { debugMode } = useDebugMode();
  const status = kyb.merchantAgreementKybCheckStatus;
  const colorClass = KYB_STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  const label = KYB_STATUS_LABELS[status] ?? status;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${colorClass}`}>
        <ShieldCheck size={10} />{label}
      </span>
      {!compact && debugMode && (
        <>
          <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-teal-50 text-teal-700 border-teal-200">SD-89 · BQ:Step</span>
          <span className="text-xs px-1.5 py-0.5 rounded border font-mono bg-slate-50 text-slate-600 border-slate-200">PCI Req 12.8</span>
        </>
      )}
    </div>
  );
}

interface PaymentLink {
  paymentLinkInstanceReference: string;
  paymentLinkCode: string;
  paymentLinkAmount: number;
  paymentLinkCurrency: string;
  paymentLinkDescription: string;
  paymentLinkStatus: string;
  paymentLinkUsageType: string;
  paymentLinkCurrentUses: number;
  paymentLinkCreatedDateTime: string;
}

// ── Application Form (customer with no merchant) ──────────────────────────────

function MerchantApplicationForm({ token, onSubmitted }: { token: string; onSubmitted: () => void }) {
  const [name, setName] = useState('');
  const [legalRef, setLegalRef] = useState('');
  const [mcc, setMcc] = useState('5812');
  const [country, setCountry] = useState('US');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const PRESETS = [
    { label: 'Coffee Shop', name: 'My Coffee Shop Ltd', legalRef: '12-3456789', mcc: '5812', country: 'US' },
    { label: 'Online Store', name: 'Digital Store LLC', legalRef: '98-7654321', mcc: '5999', country: 'US' },
    { label: 'Consulting',  name: 'Consulting Group GmbH', legalRef: 'DE123456789', mcc: '7389', country: 'DE' },
  ];

  const { debugMode } = useDebugMode();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.merchants.create({ merchantName: name, merchantLegalEntityReference: legalRef, merchantCategoryCode: mcc, merchantCountryCode: country }, token);
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed.');
    }
    setLoading(false);
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Store size={20} className="text-gray-500" />
          <h1 className="text-2xl font-bold">Request Merchant Account</h1>
        </div>
        <p className="text-sm text-gray-500">
          Submit your merchant application. A Merchant Acquiring officer will review within 2 business days.
        </p>
      </div>

      {/* BIAN badge + presets — debug mode only */}
      {debugMode && (
        <>
          <div className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 text-xs text-blue-700 font-medium">
            <span className="font-bold">BIAN SD-89</span>
            <ChevronRight size={10} />
            <span>Action: Initiate</span>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-2">Quick-fill with demo data:</p>
            <div className="flex gap-2 flex-wrap">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { setName(p.name); setLegalRef(p.legalRef); setMcc(p.mcc); setCountry(p.country); }}
                  className="px-3 py-1 rounded-full border border-gray-300 text-xs text-gray-600 hover:border-[#00ED64] hover:text-[#00ED64] transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Business Name</label>
          <input
            required value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Acme Retail Ltd"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tax ID / Company Registration</label>
          <input
            required value={legalRef} onChange={(e) => setLegalRef(e.target.value)}
            placeholder="12-3456789"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Merchant Category (MCC)</label>
            <select
              value={mcc} onChange={(e) => setMcc(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            >
              <option value="5812">5812 — Restaurants</option>
              <option value="5411">5411 — Grocery Stores</option>
              <option value="5999">5999 — Retail</option>
              <option value="7389">7389 — Consulting</option>
              <option value="6011">6011 — ATM / Cash (High Risk)</option>
              <option value="7995">7995 — Gambling (High Risk)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Country</label>
            <select
              value={country} onChange={(e) => setCountry(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            >
              {['US', 'GB', 'DE', 'FR', 'BR', 'CO', 'MX'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <button
          type="submit" disabled={loading}
          className="w-full bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm"
        >
          {loading ? 'Submitting…' : 'Submit Application'}
        </button>
        {debugMode && (
          <p className="text-xs text-gray-400 text-center font-mono">
            PCI DSS Req 12.8 · documented merchant agreement required before processing payments
          </p>
        )}
      </form>
    </div>
  );
}

// ── Under Review View ─────────────────────────────────────────────────────────

function UnderReviewView({ merchant }: { merchant: MerchantRecord }) {
  const { debugMode } = useDebugMode();
  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <div className="flex items-center gap-2">
        <Clock size={20} className="text-amber-500" />
        <h1 className="text-2xl font-bold">Application Under Review</h1>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Clock size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium text-amber-800">Your application is being reviewed</div>
            <div className="text-xs text-amber-700 mt-0.5">
              A Merchant Acquiring officer will review your application within 2 business days.
              You will be able to access the merchant sandbox once approved.
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 text-sm">Application Details</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Business Name</dt>
            <dd className="font-medium text-gray-800">{merchant.merchantName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">MCC</dt>
            <dd className="font-mono text-gray-700">{merchant.merchantCategoryCode}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Country</dt>
            <dd className="text-gray-700">{merchant.merchantCountryCode}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Status</dt>
            <dd className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">under_review</dd>
          </div>
          {merchant.recordCreatedDateTime && (
            <div className="flex justify-between">
              <dt className="text-gray-500">Submitted</dt>
              <dd className="text-gray-600 text-xs">{new Date(merchant.recordCreatedDateTime).toLocaleString()}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-gray-500">Application ID</dt>
            <dd className="font-mono text-xs text-gray-400 truncate max-w-[180px]">{merchant.merchantAgreementInstanceReference}</dd>
          </div>
          {merchant.merchantAgreementKybCheck && (
            <div className="flex justify-between items-center pt-1 border-t border-gray-100">
              <dt className="text-gray-500">KYB Check</dt>
              <dd><KybStatusBadge kyb={merchant.merchantAgreementKybCheck} compact /></dd>
            </div>
          )}
        </dl>
      </div>

      {debugMode && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-500 space-y-1 font-mono">
          <div className="font-semibold text-gray-600 mb-1.5 not-italic">BIAN SD-89 · MerchantAgreementProcedure</div>
          <div>status = <span className="text-amber-600">under_review</span></div>
          <div>next → <span className="text-gray-700">Control (approve) → agreed</span> · actor: merchant_officer</div>
          <div className="mt-1 text-gray-400">PCI DSS Req 12.8 · KYB review required before merchant activation</div>
        </div>
      )}
    </div>
  );
}

// ── Rejected View ─────────────────────────────────────────────────────────────

function RejectedView({ merchant, onReapply }: { merchant: MerchantRecord; onReapply: () => void }) {
  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <div className="flex items-center gap-2">
        <XCircle size={20} className="text-red-500" />
        <h1 className="text-2xl font-bold">Application Not Approved</h1>
      </div>

      <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
        <div className="text-sm font-medium text-red-800">Your merchant application was not approved.</div>
        {merchant.merchantReviewNote && (
          <div className="text-xs text-red-700 bg-white border border-red-100 rounded-lg px-3 py-2">
            <span className="font-medium">Officer note: </span>{merchant.merchantReviewNote}
          </div>
        )}
      </div>

      <button
        onClick={onReapply}
        className="w-full bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium py-2 rounded-lg transition-colors text-sm"
      >
        Submit New Application
      </button>
    </div>
  );
}

// ── Merchant Sandbox (agreed / active) ────────────────────────────────────────

function MerchantSandbox({ token, merchants, onRefresh }: { token: string; merchants: MerchantRecord[]; onRefresh: () => void }) {
  const [tab, setTab] = useState<Tab>('checkout');
  const [selectedMerchantId, setSelectedMerchantId] = useState(merchants[0]?.merchantAgreementInstanceReference ?? '');
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);

  const [csAmount, setCsAmount] = useState('99.00');
  const [csCurrency, setCsCurrency] = useState('USD');
  const [csDescription, setCsDescription] = useState('Demo Order #1234');
  const [csReturnUrl, setCsReturnUrl] = useState('https://example.com/success');
  const [csCancelUrl, setCsCancelUrl] = useState('https://example.com/cancel');
  const [csRef, setCsRef] = useState('ORDER-001');
  const [csResult, setCsResult] = useState<{ paymentPageUrl: string; expiresAt: string } | null>(null);
  const [csLoading, setCsLoading] = useState(false);
  const [csError, setCsError] = useState('');

  const [plAmount, setPlAmount] = useState('49.99');
  const [plCurrency, setPlCurrency] = useState('USD');
  const [plDescription, setPlDescription] = useState('Consulting Session');
  const [plMessage, setPlMessage] = useState('');
  const [plUsageType, setPlUsageType] = useState<'single_use' | 'multi_use'>('single_use');
  const [plResult, setPlResult] = useState<{ paymentUrl: string; paymentLinkCode: string } | null>(null);
  const [plLoading, setPlLoading] = useState(false);
  const [plError, setPlError] = useState('');

  const [apiKeyResult, setApiKeyResult] = useState<{ merchantApiKey: string; keyId: string; keyPrefix: string } | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookSaved, setWebhookSaved] = useState(false);

  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const m = merchants.find((m) => m.merchantAgreementInstanceReference === selectedMerchantId);
    if (m) setWebhookUrl(m.merchantWebhookEndpoint ?? '');
  }, [selectedMerchantId, merchants]);

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const loadLinks = useCallback(async () => {
    if (!token || !selectedMerchantId) return;
    setLoadingLinks(true);
    try {
      const res = await api.paymentLinks.list(selectedMerchantId, token);
      setLinks(res.results as unknown as PaymentLink[]);
    } catch {}
    setLoadingLinks(false);
  }, [token, selectedMerchantId]);

  useEffect(() => {
    if (tab === 'links') loadLinks();
  }, [tab, loadLinks]);

  async function handleCreateSession(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMerchantId) return;
    setCsLoading(true);
    setCsError('');
    setCsResult(null);
    try {
      const result = await api.checkout.createSession({
        merchantAgreementInstanceReference: selectedMerchantId,
        amount: parseFloat(csAmount),
        currency: csCurrency,
        description: csDescription,
        returnUrl: csReturnUrl,
        cancelUrl: csCancelUrl,
        merchantReference: csRef,
      }, token);
      setCsResult(result);
    } catch (err) {
      setCsError(err instanceof Error ? err.message : 'Failed to create session.');
    }
    setCsLoading(false);
  }

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMerchantId) return;
    setPlLoading(true);
    setPlError('');
    setPlResult(null);
    try {
      const result = await api.paymentLinks.create({
        merchantAgreementInstanceReference: selectedMerchantId,
        amount: parseFloat(plAmount),
        currency: plCurrency,
        description: plDescription,
        customerMessage: plMessage || undefined,
        usageType: plUsageType,
      }, token);
      setPlResult(result);
      if (tab === 'links') loadLinks();
    } catch (err) {
      setPlError(err instanceof Error ? err.message : 'Failed to create link.');
    }
    setPlLoading(false);
  }

  async function handleGenerateKey() {
    if (!selectedMerchantId) return;
    setKeyLoading(true);
    setApiKeyResult(null);
    try {
      const result = await api.merchants.generateKey(selectedMerchantId, token);
      setApiKeyResult(result);
    } catch {}
    setKeyLoading(false);
  }

  async function handleSaveWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMerchantId || !webhookUrl) return;
    setWebhookSaving(true);
    try {
      await api.merchants.registerWebhook(selectedMerchantId, webhookUrl, token);
      setWebhookSaved(true);
      setTimeout(() => setWebhookSaved(false), 3000);
    } catch {}
    setWebhookSaving(false);
  }

  async function handleDeactivateLink(id: string) {
    if (!selectedMerchantId) return;
    try {
      await api.paymentLinks.deactivate(id, selectedMerchantId, token);
      loadLinks();
    } catch {}
  }

  const selectedMerchant = merchants.find((m) => m.merchantAgreementInstanceReference === selectedMerchantId);

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'checkout', label: 'Checkout Session', icon: <ShoppingCart size={15} /> },
    { key: 'links',    label: 'Payment Links',    icon: <Link2 size={15} /> },
    { key: 'keys',     label: 'API Keys',          icon: <Key size={15} /> },
    { key: 'webhook',  label: 'Webhook',           icon: <Webhook size={15} /> },
  ];

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-gray-500" />
            <h1 className="text-2xl font-bold">Merchant Sandbox</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Test Redirect Checkout and Payment Links integration.</p>
        </div>
        <button onClick={onRefresh} className="text-xs text-gray-400 hover:text-gray-600">Refresh</button>
      </div>

      {/* Merchant selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <label className="block text-xs text-gray-500 mb-1.5">Active Merchant</label>
        <select
          value={selectedMerchantId}
          onChange={(e) => { setSelectedMerchantId(e.target.value); setCsResult(null); setPlResult(null); setApiKeyResult(null); }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
        >
          {merchants.map((m) => (
            <option key={m.merchantAgreementInstanceReference} value={m.merchantAgreementInstanceReference}>
              {m.merchantName} ({m.merchantAgreementStatus})
            </option>
          ))}
        </select>
        {selectedMerchant && (
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-400 font-mono truncate">
              ID: {selectedMerchant.merchantAgreementInstanceReference}
            </span>
            {selectedMerchant.merchantAgreementKybCheck && (
              <KybStatusBadge kyb={selectedMerchant.merchantAgreementKybCheck} compact />
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab: Checkout Session */}
      {tab === 'checkout' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-800">Create Checkout Session</h2>
            <p className="text-xs text-gray-500 mt-0.5">Merchant redirects buyer to the hosted payment page. SAQ A compliance.</p>
          </div>
          <form onSubmit={handleCreateSession} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount</label>
                <input required type="number" step="0.01" min="0.01" value={csAmount} onChange={(e) => setCsAmount(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Currency</label>
                <select value={csCurrency} onChange={(e) => setCsCurrency(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                  {['USD', 'EUR', 'GBP', 'BRL', 'COP'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <input required type="text" value={csDescription} onChange={(e) => setCsDescription(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Merchant Reference (order ID)</label>
              <input required type="text" value={csRef} onChange={(e) => setCsRef(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Return URL</label>
                <input required type="url" value={csReturnUrl} onChange={(e) => setCsReturnUrl(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cancel URL</label>
                <input required type="url" value={csCancelUrl} onChange={(e) => setCsCancelUrl(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              </div>
            </div>
            {csError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{csError}</div>}
            <button type="submit" disabled={csLoading || !selectedMerchantId}
              className="w-full bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
              {csLoading ? 'Creating...' : 'Create Session'}
            </button>
          </form>
          {csResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
              <div className="text-sm font-medium text-green-800">Session created. Redirect buyer to:</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 font-mono text-xs text-green-700 bg-white border border-green-200 rounded px-2 py-1.5 truncate">{csResult.paymentPageUrl}</div>
                <button onClick={() => copyToClipboard(csResult.paymentPageUrl, 'csUrl')} className="shrink-0 p-1.5 rounded hover:bg-green-100">
                  {copied === 'csUrl' ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
                </button>
                <a href={csResult.paymentPageUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1.5 rounded hover:bg-green-100">
                  <ExternalLink size={14} className="text-green-600" />
                </a>
              </div>
              <div className="text-xs text-green-600">Expires: {new Date(csResult.expiresAt).toLocaleString()} (30 min)</div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Payment Links */}
      {tab === 'links' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-gray-800">Create Payment Link</h2>
              <p className="text-xs text-gray-500 mt-0.5">Shareable URL for email, QR codes, or social media.</p>
            </div>
            <form onSubmit={handleCreateLink} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount</label>
                  <input required type="number" step="0.01" min="0.01" value={plAmount} onChange={(e) => setPlAmount(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Currency</label>
                  <select value={plCurrency} onChange={(e) => setPlCurrency(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                    {['USD', 'EUR', 'GBP', 'BRL', 'COP'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <input required type="text" value={plDescription} onChange={(e) => setPlDescription(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Customer Message (optional)</label>
                <input type="text" value={plMessage} onChange={(e) => setPlMessage(e.target.value)} placeholder="Message shown to buyer"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Usage Type</label>
                <select value={plUsageType} onChange={(e) => setPlUsageType(e.target.value as 'single_use' | 'multi_use')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                  <option value="single_use">Single Use (invoice / one-time)</option>
                  <option value="multi_use">Multi Use (store / recurring)</option>
                </select>
              </div>
              {plError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{plError}</div>}
              <button type="submit" disabled={plLoading || !selectedMerchantId}
                className="w-full bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
                {plLoading ? 'Creating...' : 'Create Payment Link'}
              </button>
            </form>
            {plResult && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                <div className="text-sm font-medium text-green-800">Payment link created. Share this URL:</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 font-mono text-xs text-green-700 bg-white border border-green-200 rounded px-2 py-1.5 truncate">{plResult.paymentUrl}</div>
                  <button onClick={() => copyToClipboard(plResult.paymentUrl, 'plUrl')} className="shrink-0 p-1.5 rounded hover:bg-green-100">
                    {copied === 'plUrl' ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
                  </button>
                  <a href={plResult.paymentUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1.5 rounded hover:bg-green-100">
                    <ExternalLink size={14} className="text-green-600" />
                  </a>
                </div>
                <div className="text-xs text-green-600 font-mono">Code: {plResult.paymentLinkCode}</div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="font-medium text-gray-800 text-sm">Active Links</h3>
              <button onClick={loadLinks} className="text-xs text-[#00ED64] hover:underline">Refresh</button>
            </div>
            {loadingLinks ? (
              <div className="px-5 py-6 text-center text-sm text-gray-400">Loading...</div>
            ) : links.length === 0 ? (
              <div className="px-5 py-6 text-center text-sm text-gray-400">No payment links yet.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {links.map((link) => (
                  <li key={link.paymentLinkInstanceReference} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-600">{link.paymentLinkCode}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          link.paymentLinkStatus === 'active' ? 'bg-green-100 text-green-700' :
                          link.paymentLinkStatus === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                        }`}>{link.paymentLinkStatus}</span>
                        <span className="text-xs text-gray-400">{link.paymentLinkUsageType}</span>
                      </div>
                      <div className="text-sm text-gray-700 mt-0.5 truncate">{link.paymentLinkDescription}</div>
                      <div className="text-xs text-gray-400">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: link.paymentLinkCurrency }).format(link.paymentLinkAmount)}
                        {' · '}{link.paymentLinkCurrentUses} use{link.paymentLinkCurrentUses !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a href={`/gateway/pay/${link.paymentLinkCode}`} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700">
                        <ExternalLink size={13} />
                      </a>
                      {link.paymentLinkStatus === 'active' && (
                        <button onClick={() => handleDeactivateLink(link.paymentLinkInstanceReference)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Tab: API Keys */}
      {tab === 'keys' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-800">API Key Management</h2>
            <p className="text-xs text-gray-500 mt-0.5">Generate API keys for programmatic merchant access. Keys are shown once and stored as bcrypt hashes.</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
            PCI DSS: API keys are never stored in plaintext. Only bcrypt hashes are persisted. Save each key immediately after generation.
          </div>
          <button onClick={handleGenerateKey} disabled={keyLoading || !selectedMerchantId}
            className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
            <Plus size={15} />
            {keyLoading ? 'Generating...' : 'Generate New API Key'}
          </button>
          {apiKeyResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-medium text-green-800">New API Key Generated. Save it now - it will NOT be shown again.</div>
              <div>
                <div className="text-xs text-gray-500 mb-1">API Key (full, shown once)</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 font-mono text-xs text-green-800 bg-white border border-green-200 rounded px-3 py-2 break-all select-all">
                    {apiKeyResult.merchantApiKey}
                  </div>
                  <button onClick={() => copyToClipboard(apiKeyResult.merchantApiKey, 'apiKey')} className="shrink-0 p-2 rounded hover:bg-green-100">
                    {copied === 'apiKey' ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                Key ID: <span className="font-mono">{apiKeyResult.keyId}</span>
                {' · '}Prefix: <span className="font-mono">{apiKeyResult.keyPrefix}</span>
              </div>
              <div className="text-xs text-gray-500">
                Use as: <code className="bg-white border border-gray-200 rounded px-1">X-Merchant-Api-Key: {apiKeyResult.merchantApiKey}</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Webhook */}
      {tab === 'webhook' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-800">Webhook Configuration</h2>
            <p className="text-xs text-gray-500 mt-0.5">Configure an HTTPS endpoint to receive payment event notifications.</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs space-y-1 text-gray-600">
            <div className="font-medium text-gray-700 mb-2">Events delivered:</div>
            <div><code className="bg-white border border-gray-200 rounded px-1">checkout.completed</code> - Buyer completed checkout session</div>
            <div><code className="bg-white border border-gray-200 rounded px-1">payment_link.completed</code> - Buyer paid via payment link</div>
            <div className="mt-2 text-gray-500">Delivery: up to 3 attempts with exponential backoff. Signed with <code>X-Webhook-Signature: sha256=...</code></div>
          </div>
          <form onSubmit={handleSaveWebhook} className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Webhook Endpoint URL</label>
              <input required type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhooks/payments"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </div>
            <button type="submit" disabled={webhookSaving || !selectedMerchantId}
              className={`w-full font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm ${
                webhookSaved ? 'bg-green-500 text-white' : 'bg-[#001E2B] hover:bg-[#001E2B]/80 text-white'
              }`}>
              {webhookSaving ? 'Saving...' : webhookSaved ? 'Saved!' : 'Save Webhook URL'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ── Analyst View (full merchant list) ─────────────────────────────────────────

function AnalystMerchantView({ token }: { token: string }) {
  const { debugMode } = useDebugMode();
  const [merchants, setMerchants] = useState<MerchantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    api.merchants.list(statusFilter ? { status: statusFilter } : {}, token)
      .then((res) => setMerchants(res.results as unknown as MerchantRecord[]))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, statusFilter]);

  const STATUS_COLORS: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    agreed: 'bg-blue-100 text-blue-700',
    under_review: 'bg-amber-100 text-amber-700',
    suspended: 'bg-red-100 text-red-700',
    rejected: 'bg-gray-100 text-gray-500',
    closed: 'bg-gray-100 text-gray-500',
  };

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Merchant Agreements</h1>
          {debugMode && <p className="text-xs text-gray-400 font-mono mt-0.5">SD-89 · MerchantAgreementProcedure</p>}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
        >
          <option value="">All statuses</option>
          {['initiated','under_review','agreed','active','amended','suspended','rejected','closed'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : merchants.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">No merchants found.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {merchants.map((m) => (
            <div key={m.merchantAgreementInstanceReference} className="px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{m.merchantName}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[m.merchantAgreementStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                    {m.merchantAgreementStatus}
                  </span>
                  {m.merchantRiskCategory === 'high' && (
                    <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">high risk</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-gray-400 font-mono">
                    MCC {m.merchantCategoryCode} · {m.merchantCountryCode}
                    {m.merchantTier && ` · ${m.merchantTier}`}
                  </span>
                  {m.merchantAgreementKybCheck && (
                    <KybStatusBadge kyb={m.merchantAgreementKybCheck} compact />
                  )}
                </div>
              </div>
              <div className="text-xs text-gray-400 font-mono shrink-0 hidden sm:block truncate max-w-[180px]">
                {m.merchantAgreementInstanceReference}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root Page: Role-Based State Machine ───────────────────────────────────────

export default function MerchantPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  const [merchantState, setMerchantState] = useState<MerchantState>('loading');
  const [ownMerchant, setOwnMerchant] = useState<MerchantRecord | null>(null);
  const [analystMerchants, setAnalystMerchants] = useState<MerchantRecord[]>([]);

  const loadOwnMerchant = useCallback(async (tok: string) => {
    try {
      const res = await api.merchants.getMe(tok);
      if (!res.found || !res.merchant) {
        setMerchantState('no_merchant');
      } else {
        const m = res.merchant as unknown as MerchantRecord;
        setOwnMerchant(m);
        const s = m.merchantAgreementStatus;
        if (s === 'under_review' || s === 'initiated') setMerchantState('under_review');
        else if (s === 'rejected') setMerchantState('rejected');
        else setMerchantState('active');
      }
    } catch {
      setMerchantState('no_merchant');
    }
  }, []);

  const loadAnalystList = useCallback(async (tok: string) => {
    try {
      const res = await api.merchants.list({}, tok);
      setAnalystMerchants(res.results as unknown as MerchantRecord[]);
      setMerchantState('analyst_list');
    } catch {
      setMerchantState('analyst_list');
    }
  }, []);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) return;
    const decoded = decodeToken(t);
    const r = decoded?.role ?? '';
    setRole(r);

    if (r === 'merchant_officer') {
      // Officers have a dedicated review page
      router.replace('/system/merchant/review');
      return;
    }

    if (r === 'customer') {
      loadOwnMerchant(t);
    } else {
      // level1_analyst, level2_investigator, security_auditor
      loadAnalystList(t);
    }
  }, [router, loadOwnMerchant, loadAnalystList]);

  if (merchantState === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  // Customer: no merchant yet
  if (merchantState === 'no_merchant') {
    return <MerchantApplicationForm token={token} onSubmitted={() => loadOwnMerchant(token)} />;
  }

  // Customer: application under review
  if (merchantState === 'under_review' && ownMerchant) {
    return <UnderReviewView merchant={ownMerchant} />;
  }

  // Customer: application rejected
  if (merchantState === 'rejected' && ownMerchant) {
    return <RejectedView merchant={ownMerchant} onReapply={() => setMerchantState('no_merchant')} />;
  }

  // Customer with active/agreed merchant OR analyst seeing their owned merchant
  if ((merchantState === 'active' || merchantState === 'agreed') && role === 'customer' && ownMerchant) {
    return (
      <MerchantSandbox
        token={token}
        merchants={[ownMerchant]}
        onRefresh={() => loadOwnMerchant(token)}
      />
    );
  }

  // Analysts: full list view + sandbox
  if (merchantState === 'analyst_list') {
    if (analystMerchants.length === 0) {
      return <AnalystMerchantView token={token} />;
    }
    return <MerchantSandbox token={token} merchants={analystMerchants} onRefresh={() => loadAnalystList(token)} />;
  }

  return <AnalystMerchantView token={token} />;
}

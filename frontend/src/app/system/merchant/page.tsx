'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { useMerchant } from '../../../lib/merchantContext';
import { useDebugMode } from '../../../lib/debugMode';
import {
  Check, Clock, CheckCircle2, XCircle, Store, ChevronRight, ShieldCheck,
  Building2, MapPin, FileText, ArrowRight, Info, Filter, Search, X, ClipboardCheck,
} from 'lucide-react';
import Link from 'next/link';
import { Pagination } from '../../../components/Pagination';
import { SectionHeader } from '../../../components/SectionHeader';

// ── Types ────────────────────────────────────────────────────────────────────

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
  merchantAgreementKybCheck?: MerchantAgreementKybCheck;  // BQ:Step, BIAN SD-89. PCI DSS Req 12.8
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
    { label: 'Coffee Shop',  name: 'My Coffee Shop Ltd',    legalRef: '12-3456789',  mcc: '5812', country: 'US', note: 'Restaurants · US' },
    { label: 'Online Store', name: 'Digital Store LLC',     legalRef: '98-7654321',  mcc: '5999', country: 'US', note: 'Retail · US'       },
    { label: 'Consulting',   name: 'Consulting Group GmbH', legalRef: 'DE123456789', mcc: '7389', country: 'DE', note: 'Services · DE'     },
  ];

  const selectedPreset = PRESETS.find(
    p => p.name === name && p.legalRef === legalRef && p.mcc === mcc && p.country === country
  );

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
          <Store size={20} className="text-[#001E2B]" />
          <h1 className="text-2xl font-bold">Request Merchant Account</h1>
        </div>
        <p className="text-sm text-gray-500">
          Submit your merchant application. A Merchant Acquiring officer will review within 2 business days.
        </p>
      </div>

      {/* BIAN badge + presets, debug mode only */}
      {debugMode && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Quick-fill with demo data</p>
            <div className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs text-blue-700 font-medium">
              <span className="font-bold">BIAN SD-89</span>
              <ChevronRight size={9} />
              <span>Action: Initiate</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setName(p.name); setLegalRef(p.legalRef); setMcc(p.mcc); setCountry(p.country); }}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  selectedPreset?.label === p.label
                    ? 'border-[#001E2B] bg-[#001E2B] text-white'
                    : 'hover:border-gray-400'
                }`}
              >
                <div className="text-xs font-semibold truncate">{p.label}</div>
                <div className={`text-xs mt-0.5 font-mono ${
                  selectedPreset?.label === p.label ? 'text-gray-300' : 'text-gray-400'
                }`}>{p.note}</div>
              </button>
            ))}
          </div>
        </div>
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
              <option value="5812">5812, Restaurants</option>
              <option value="5411">5411, Grocery Stores</option>
              <option value="5999">5999, Retail</option>
              <option value="7389">7389, Consulting</option>
              <option value="6011">6011, ATM / Cash (High Risk)</option>
              <option value="7995">7995, Gambling (High Risk)</option>
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

// ── MCC label lookup ──────────────────────────────────────────────────────────

const MCC_LABELS: Record<string, string> = {
  '5411': 'Grocery Stores',
  '5732': 'Electronics',
  '5812': 'Restaurants',
  '5813': 'Bars & Nightclubs',
  '5834': 'Pharmacy',
  '5999': 'Retail',
  '6011': 'ATM / Cash',
  '7011': 'Hotels',
  '7389': 'Consulting',
  '7995': 'Gambling',
};

// ── BIAN SD-89 lifecycle panel (debug) ────────────────────────────────────────

const SD89_STATES: { key: string; label: string; color: string }[] = [
  { key: 'initiated',    label: 'Initiated',    color: 'bg-gray-100 text-gray-600 border-gray-300' },
  { key: 'under_review', label: 'Under Review', color: 'bg-amber-100 text-amber-700 border-amber-400' },
  { key: 'agreed',       label: 'Agreed',       color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { key: 'active',       label: 'Active',       color: 'bg-green-100 text-green-700 border-green-300' },
];

function BianLifecyclePanel({ currentStatus }: { currentStatus: string }) {
  return (
    <div className="rounded-xl border border-[#001E2B]/15 overflow-hidden">
      {/* Header */}
      <div className="bg-[#001E2B] px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#00ED64] text-xs font-semibold">BIAN SD-89</span>
          <span className="text-gray-500 text-xs">·</span>
          <span className="text-gray-400 text-xs font-mono">MerchantAgreementProcedure</span>
        </div>
        <span className="text-gray-500 text-xs font-mono">PCI DSS Req 12.8</span>
      </div>

      {/* Lifecycle flow */}
      <div className="bg-[#001E2B]/3 px-4 py-4 space-y-3">
        {/* Main path */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Lifecycle · main path</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {SD89_STATES.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                  s.key === currentStatus
                    ? `${s.color} ring-2 ring-offset-1 ring-amber-300 font-semibold`
                    : s.color + ' opacity-60'
                }`}>
                  {s.key === currentStatus && <span className="mr-1">●</span>}{s.label}
                </span>
                {i < SD89_STATES.length - 1 && (
                  <ArrowRight size={12} className="text-gray-400 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Rejection branch */}
        <div className="flex items-center gap-2">
          <div className="w-px h-5 bg-gray-300 ml-[68px]" />
        </div>
        <div className="flex items-center gap-2 -mt-2">
          <div className="w-[78px] shrink-0" />
          <ArrowRight size={12} className="text-gray-400 rotate-90 shrink-0" />
          <span className="text-xs px-2.5 py-1 rounded-full border bg-red-50 text-red-600 border-red-200 opacity-70">
            Rejected
          </span>
        </div>

        {/* Control action */}
        <div className="border-t border-gray-200 pt-3 grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <p className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Pending action</p>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[#001E2B] bg-white border border-gray-200 px-1.5 py-0.5 rounded text-[11px]">Control</span>
              <ArrowRight size={10} className="text-gray-400" />
              <span className="font-mono text-gray-600 text-[11px]">approve | reject</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Actor</p>
            <div className="flex flex-col gap-0.5">
              <span className="text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded text-[11px] font-medium w-fit">
                Merchant Officer
              </span>
              <span className="font-mono text-gray-400 text-[10px]">merchant_officer</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Under Review View ─────────────────────────────────────────────────────────

const REVIEW_STEPS = [
  { label: 'Submitted',    done: true  },
  { label: 'Under Review', done: false, active: true },
  { label: 'Decision',     done: false },
];

function UnderReviewView({ merchant }: { merchant: MerchantRecord }) {
  const { debugMode } = useDebugMode();
  const mccLabel = MCC_LABELS[merchant.merchantCategoryCode] ?? merchant.merchantCategoryCode;
  const submittedDate = merchant.recordCreatedDateTime
    ? new Date(merchant.recordCreatedDateTime).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Merchant Application</h1>
        <p className="text-sm text-gray-500 mt-0.5">We received your request and a compliance officer is reviewing it.</p>
      </div>

      {/* Progress stepper */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-0">
          {REVIEW_STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step.done
                    ? 'bg-green-500 text-white'
                    : step.active
                    ? 'bg-amber-500 text-white ring-4 ring-amber-100'
                    : 'bg-gray-100 text-gray-400'
                }`}>
                  {step.done ? <Check size={14} /> : step.active ? <Clock size={14} /> : i + 1}
                </div>
                <span className={`text-xs font-medium whitespace-nowrap ${
                  step.active ? 'text-amber-600' : step.done ? 'text-green-600' : 'text-gray-400'
                }`}>{step.label}</span>
              </div>
              {i < REVIEW_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mb-5 rounded-full ${step.done ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Application summary */}
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Application Summary</h2>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <Building2 size={15} className="text-gray-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-400">Business name</p>
                <p className="text-sm font-semibold text-gray-900 truncate">{merchant.merchantName}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <FileText size={15} className="text-gray-500" />
              </div>
              <div>
                <p className="text-xs text-gray-400">Category</p>
                <p className="text-sm font-medium text-gray-800">
                  {mccLabel}
                  <span className="ml-1.5 font-mono text-xs text-gray-400">MCC {merchant.merchantCategoryCode}</span>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                <MapPin size={15} className="text-gray-500" />
              </div>
              <div>
                <p className="text-xs text-gray-400">Country</p>
                <p className="text-sm font-medium text-gray-800">{merchant.merchantCountryCode}</p>
              </div>
            </div>

            {submittedDate && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                  <Clock size={15} className="text-gray-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Submitted</p>
                  <p className="text-sm font-medium text-gray-800">{submittedDate}</p>
                </div>
              </div>
            )}
          </div>

          {merchant.merchantAgreementKybCheck && (
            <div className="border-t pt-3">
              <p className="text-xs text-gray-400 mb-1.5">Identity verification (KYB)</p>
              <KybStatusBadge kyb={merchant.merchantAgreementKybCheck} compact />
            </div>
          )}
        </div>

        {/* What to expect */}
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">What happens next</h2>

          <ol className="space-y-4">
            {[
              {
                n: 1,
                title: 'Compliance review',
                desc: 'A Merchant Acquiring officer verifies your business details and runs a KYB check against your submitted information.',
              },
              {
                n: 2,
                title: 'You get notified',
                desc: 'Once the review is complete you will see an update here. Reviews typically complete within 2 business days.',
              },
              {
                n: 3,
                title: 'Sandbox access',
                desc: 'After approval you can immediately start testing Checkout Sessions, Payment Links, API keys, and webhooks.',
              },
            ].map(item => (
              <li key={item.n} className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-[#001E2B]/8 text-[#001E2B] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {item.n}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{item.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="border-t pt-3">
            <div className="flex items-start gap-2 text-xs text-gray-400">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>You can leave this page. Your application status will be here when you return.</span>
            </div>
          </div>
        </div>
      </div>

      {/* BIAN lifecycle, debug only */}
      {debugMode && (
        <BianLifecyclePanel currentStatus={merchant.merchantAgreementStatus} />
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

// ── Analyst View (full merchant list) ─────────────────────────────────────────

const MERCHANT_PAGE_SIZE = 10;

const STATUS_COLORS: Record<string, string> = {
  active:       'bg-green-100 text-green-700',
  agreed:       'bg-blue-100 text-blue-700',
  under_review: 'bg-amber-100 text-amber-700',
  suspended:    'bg-red-100 text-red-700',
  rejected:     'bg-gray-100 text-gray-500',
  closed:       'bg-gray-100 text-gray-500',
};

// Statuses accessible to merchant_officer (PCI DSS Req 7.1, least privilege)
const STATUS_LABELS: Record<string, string> = {
  initiated:    'Initiated',
  under_review: 'Under Review',
  agreed:       'Agreed',
  active:       'Active',
  amended:      'Amended',
  suspended:    'Suspended',
  rejected:     'Rejected',
  closed:       'Closed',
};

const ALL_STATUSES = ['initiated', 'under_review', 'agreed', 'active', 'amended', 'suspended', 'rejected', 'closed'];

function AnalystMerchantView({ token, role }: { token: string; role: string }) {
  const { debugMode } = useDebugMode();
  const isMerchantOfficer = role === 'merchant_officer';

  const [merchants, setMerchants]   = useState<MerchantRecord[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(MERCHANT_PAGE_SIZE);
  const [loading, setLoading]       = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [nameInput, setNameInput]   = useState('');
  const [nameFilter, setNameFilter] = useState('');

  const load = useCallback(async (p: number, ps: number, status: string, name: string) => {
    setLoading(true);
    try {
      const filters: { page: number; limit: number; status?: string; name?: string } = { page: p, limit: ps };
      if (status) filters.status = status;
      if (name)   filters.name   = name;
      const res = await api.merchants.list(filters, token);
      setMerchants(res.results as unknown as MerchantRecord[]);
      setTotal(res.total);
    } catch {
      setMerchants([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-linkable: prefill status + name from ?status=&q= once on mount, then load.
  useEffect(() => {
    let status = statusFilter;
    let name = nameFilter;
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const s = sp.get('status');
      const q = sp.get('q');
      if (s) { status = s; setStatusFilter(s); }
      if (q) { name = q; setNameInput(q); setNameFilter(q); }
    }
    load(1, pageSize, status, name);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch() {
    const v = nameInput.trim();
    setNameFilter(v);
    setPage(1);
    load(1, pageSize, statusFilter, v);
  }

  function handleStatusChange(s: string) {
    setStatusFilter(s);
    setPage(1);
    load(1, pageSize, s, nameFilter);
  }

  function handleClear() {
    const defaultStatus = '';
    setNameInput('');
    setNameFilter('');
    setStatusFilter(defaultStatus);
    setPage(1);
    load(1, pageSize, defaultStatus, '');
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    load(newPage, pageSize, statusFilter, nameFilter);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleLimitChange(newLimit: number) {
    setPageSize(newLimit);
    setPage(1);
    load(1, newLimit, statusFilter, nameFilter);
  }

  const totalPages  = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters  = !!nameFilter || !!statusFilter;
  const statuses    = ALL_STATUSES;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">

      <SectionHeader
        icon={Store}
        title="Merchant Agreements"
        description={isMerchantOfficer
          ? 'Full merchant portfolio across the lifecycle.'
          : 'Read-only oversight of all merchant agreements.'}
        debugInfo="BIAN SD-89 MerchantAgreementProcedure · PCI DSS Req 7 (no CHD in merchant records) · Req 12.8"
        actions={isMerchantOfficer && (
          <Link href="/system/merchant/review"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] text-sm font-medium hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors shrink-0">
            <ClipboardCheck size={14} /> Review queue
          </Link>
        )}
      />

      {/* Search + filters */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by merchant name…"
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleSearch}
            disabled={!nameInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50"
          >
            <Search size={14} />
            <span className="hidden sm:inline">Search</span>
          </button>
          {hasFilters && (
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50"
            >
              <X size={14} />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          <Filter size={14} className="text-gray-400 shrink-0" />
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
          </select>
          <span className="text-gray-400 text-sm self-center ml-auto">{total} merchants</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : merchants.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No merchants found{hasFilters ? ' matching the current filters.' : '.'}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {merchants.map((m) => (
              <Link
                key={m.merchantAgreementInstanceReference}
                href={`/system/merchant/${m.merchantAgreementInstanceReference}`}
                className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">{m.merchantName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[m.merchantAgreementStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[m.merchantAgreementStatus] ?? m.merchantAgreementStatus}
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
                <div className="text-xs text-gray-400 font-mono shrink-0 hidden sm:block truncate max-w-[160px]">
                  {m.merchantAgreementInstanceReference}
                </div>
                <ChevronRight size={16} className="text-gray-300 group-hover:text-[#001E2B] transition-colors shrink-0" />
              </Link>
            ))}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={pageSize}
            onPageChange={handlePageChange}
            onLimitChange={handleLimitChange}
            limitOptions={[10, 20, 50]}
            noun="merchants"
          />
        </>
      )}
    </div>
  );
}

// ── Root index ────────────────────────────────────────────────────────────────
// The /system/merchant layout loads the caller's merchant into context. This index
// renders the onboarding states (no merchant / under review / rejected) and the
// staff merchant list. Active merchant owners are routed to the section dashboard
// (/system/merchant/overview); the per-section UIs live in their own routes.

export default function MerchantPage() {
  const router = useRouter();
  const { token, role, state, merchant, refresh } = useMerchant();
  const [reapply, setReapply] = useState(false);

  useEffect(() => {
    if ((state === 'active' || state === 'agreed') && role === 'customer' && merchant) {
      router.replace('/system/merchant/overview');
    }
  }, [state, role, merchant, router]);

  if (state === 'loading') {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>;
  }
  if (reapply || state === 'no_merchant') {
    return <MerchantApplicationForm token={token} onSubmitted={() => { setReapply(false); refresh(); }} />;
  }
  if (state === 'under_review' && merchant) {
    return <UnderReviewView merchant={merchant} />;
  }
  if (state === 'rejected' && merchant) {
    return <RejectedView merchant={merchant} onReapply={() => setReapply(true)} />;
  }
  if ((state === 'active' || state === 'agreed') && role === 'customer') {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Opening dashboard…</div>;
  }
  return <AnalystMerchantView token={token} role={role} />;
}

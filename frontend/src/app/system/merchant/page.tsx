'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { useDebugMode } from '../../../lib/debugMode';
import {
  Store, ChevronRight, ShieldCheck,
  Building2, MapPin, FileText, ArrowRight, Filter, Search, X, ClipboardCheck, Plus,
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
  merchantRiskCategory?: string;
  merchantTier?: string;
  merchantAgreementKybCheck?: MerchantAgreementKybCheck;
  recordCreatedDateTime?: string;
}

// ── Shared constants ──────────────────────────────────────────────────────────

const KYB_STATUS_COLORS: Record<KybCheckStatus, string> = {
  verified: 'bg-green-100 text-green-800 border-green-200',
  initiated: 'bg-amber-100 text-amber-800 border-amber-200',
  rejected:  'bg-red-100 text-red-800 border-red-200',
  expired:   'bg-orange-100 text-orange-800 border-orange-200',
};

const KYB_STATUS_LABELS: Record<KybCheckStatus, string> = {
  verified: 'KYB Verified',
  initiated: 'KYB Pending',
  rejected:  'KYB Rejected',
  expired:   'KYB Expired',
};

const STATUS_COLORS: Record<string, string> = {
  active:       'bg-green-100 text-green-700',
  agreed:       'bg-blue-100 text-blue-700',
  under_review: 'bg-amber-100 text-amber-700',
  suspended:    'bg-red-100 text-red-700',
  rejected:     'bg-gray-100 text-gray-500',
  closed:       'bg-gray-100 text-gray-500',
};

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

const MCC_LABELS: Record<string, string> = {
  '5411': 'Grocery Stores',
  '5732': 'Electronics',
  '5812': 'Restaurants',
  '5813': 'Bars and Nightclubs',
  '5834': 'Pharmacy',
  '5999': 'Retail',
  '6011': 'ATM / Cash',
  '7011': 'Hotels',
  '7389': 'Consulting',
  '7995': 'Gambling',
};

// ── KYB badge ─────────────────────────────────────────────────────────────────

function KybStatusBadge({ kyb }: { kyb: MerchantAgreementKybCheck }) {
  const status = kyb.merchantAgreementKybCheckStatus;
  const colorClass = KYB_STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${colorClass}`}>
      <ShieldCheck size={10} />{KYB_STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Merchant Application Form (first-time registration) ───────────────────────

const PRESETS = [
  { label: 'Coffee Shop',  name: 'My Coffee Shop Ltd',    legalRef: '12-3456789',  mcc: '5812', country: 'US', note: 'Restaurants · US' },
  { label: 'Online Store', name: 'Digital Store LLC',     legalRef: '98-7654321',  mcc: '5999', country: 'US', note: 'Retail · US'       },
  { label: 'Consulting',   name: 'Consulting Group GmbH', legalRef: 'DE123456789', mcc: '7389', country: 'DE', note: 'Services · DE'     },
];

function MerchantApplicationForm({
  token, onSubmitted, onCancel,
}: {
  token: string;
  onSubmitted: () => void;
  onCancel?: () => void;
}) {
  const { debugMode } = useDebugMode();
  const [name, setName] = useState('');
  const [legalRef, setLegalRef] = useState('');
  const [mcc, setMcc] = useState('5812');
  const [country, setCountry] = useState('US');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedPreset = PRESETS.find(
    p => p.name === name && p.legalRef === legalRef && p.mcc === mcc && p.country === country,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.merchants.create(
        { merchantName: name, merchantLegalEntityReference: legalRef, merchantCategoryCode: mcc, merchantCountryCode: country },
        token,
      );
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed.');
    }
    setLoading(false);
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Store size={20} className="text-[#001E2B]" />
            <h1 className="text-2xl font-bold">Register Merchant</h1>
          </div>
          <p className="text-sm text-gray-500">
            Submit your merchant application. A Merchant Acquiring officer will review within 2 business days.
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-[#001E2B] border border-gray-300 px-3 py-2 rounded-lg shrink-0"
          >
            Cancel
          </button>
        )}
      </div>

      {debugMode && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Quick-fill with demo data</p>
            <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 text-xs text-blue-700 font-medium">
              <span className="font-bold">BIAN SD-89</span>
              <ChevronRight size={9} />
              <span>Action: Initiate</span>
            </span>
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
                <div className={`text-xs mt-0.5 font-mono ${selectedPreset?.label === p.label ? 'text-gray-300' : 'text-gray-400'}`}>{p.note}</div>
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
          {loading ? 'Submitting...' : 'Submit Application'}
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

// ── BIAN SD-89 lifecycle debug panel ─────────────────────────────────────────

const SD89_STATES: { key: string; label: string; color: string }[] = [
  { key: 'initiated',    label: 'Initiated',    color: 'bg-gray-100 text-gray-600 border-gray-300' },
  { key: 'under_review', label: 'Under Review', color: 'bg-amber-100 text-amber-700 border-amber-400' },
  { key: 'agreed',       label: 'Agreed',       color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { key: 'active',       label: 'Active',       color: 'bg-green-100 text-green-700 border-green-300' },
];

function BianLifecyclePanel({ currentStatus }: { currentStatus: string }) {
  return (
    <div className="rounded-xl border border-[#001E2B]/15 overflow-hidden">
      <div className="bg-[#001E2B] px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#00ED64] text-xs font-semibold">BIAN SD-89</span>
          <span className="text-gray-500 text-xs">·</span>
          <span className="text-gray-400 text-xs font-mono">MerchantAgreementProcedure</span>
        </div>
        <span className="text-gray-500 text-xs font-mono">PCI DSS Req 12.8</span>
      </div>
      <div className="bg-[#001E2B]/3 px-4 py-4">
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
              {i < SD89_STATES.length - 1 && <ArrowRight size={12} className="text-gray-400 shrink-0" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Customer merchant list (multi-merchant) ───────────────────────────────────

function CustomerMerchantList({
  token, onRegister,
}: {
  token: string;
  onRegister: () => void;
}) {
  const { debugMode } = useDebugMode();
  const [merchants, setMerchants] = useState<MerchantRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [nameInput, setNameInput] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async (p: number, ps: number, status: string, name: string) => {
    setLoading(true);
    try {
      const filters: { page: number; limit: number; status?: string; name?: string } = { page: p, limit: ps };
      if (status) filters.status = status;
      if (name)   filters.name = name;
      const res = await api.merchants.list(filters, token);
      setMerchants(res.results as unknown as MerchantRecord[]);
      setTotal(res.total);
    } catch {
      setMerchants([]);
      setTotal(0);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(1, limit, statusFilter, nameFilter); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch() {
    const v = nameInput.trim();
    setNameFilter(v);
    setPage(1);
    load(1, limit, statusFilter, v);
  }

  function handleStatusChange(s: string) {
    setStatusFilter(s);
    setPage(1);
    load(1, limit, s, nameFilter);
  }

  function handleClear() {
    setNameInput(''); setNameFilter(''); setStatusFilter(''); setPage(1);
    load(1, limit, '', '');
  }

  function handlePageChange(p: number) {
    setPage(p);
    load(p, limit, statusFilter, nameFilter);
  }

  function handleLimitChange(l: number) {
    setLimit(l); setPage(1);
    load(1, l, statusFilter, nameFilter);
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = !!nameFilter || !!statusFilter;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Store}
        title="My Merchants"
        description="Manage your merchant agreements. Each merchant has independent credentials, webhooks, and OAuth integration."
        debugInfo="BIAN SD-89 MerchantAgreementProcedure · PCI DSS Req 12.8"
        actions={
          <button
            type="button"
            onClick={onRegister}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-medium hover:bg-[#001E2B]/80 transition-colors shrink-0"
          >
            <Plus size={14} /> Register merchant
          </button>
        }
      />

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by merchant name..."
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleSearch}
            disabled={!nameInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50"
          >
            <Search size={14} /><span className="hidden sm:inline">Search</span>
          </button>
          {hasFilters && (
            <button onClick={handleClear} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
              <X size={14} /><span className="hidden sm:inline">Clear</span>
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
            {['initiated', 'under_review', 'agreed', 'active', 'suspended', 'rejected', 'closed'].map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
            ))}
          </select>
          <span className="text-gray-400 text-sm self-center ml-auto">{total} merchant{total !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : merchants.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center space-y-3">
          <Store size={28} className="mx-auto text-amber-400" />
          <p className="text-sm text-amber-800 font-medium">No merchants found{hasFilters ? ' matching the current filters.' : '.'}</p>
          {!hasFilters && (
            <button
              type="button" onClick={onRegister}
              className="inline-flex items-center gap-1.5 text-sm bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg font-medium"
            >
              <Plus size={14} /> Register your first merchant
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {merchants.map((m) => (
              <Link
                key={m.merchantAgreementInstanceReference}
                href={`/system/merchant/${m.merchantAgreementInstanceReference}/overview`}
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
                      {MCC_LABELS[m.merchantCategoryCode] ?? m.merchantCategoryCode} · MCC {m.merchantCategoryCode} · {m.merchantCountryCode}
                      {m.merchantTier && ` · ${m.merchantTier}`}
                    </span>
                    {m.merchantAgreementKybCheck && <KybStatusBadge kyb={m.merchantAgreementKybCheck} />}
                  </div>
                  {debugMode && (
                    <p className="text-[10px] text-gray-300 font-mono mt-0.5">{m.merchantAgreementInstanceReference}</p>
                  )}
                </div>
                <ChevronRight size={16} className="text-gray-300 group-hover:text-[#001E2B] transition-colors shrink-0" />
              </Link>
            ))}
          </div>
          <Pagination
            page={page} totalPages={totalPages} total={total} limit={limit}
            onPageChange={handlePageChange} onLimitChange={handleLimitChange}
            limitOptions={[10, 20, 50]} noun="merchants"
          />
          {debugMode && merchants.length > 0 && (
            <BianLifecyclePanel currentStatus={merchants[0].merchantAgreementStatus} />
          )}
        </>
      )}
    </div>
  );
}

// ── Staff view (analyst / merchant_officer) ───────────────────────────────────

const ALL_STATUSES = ['initiated', 'under_review', 'agreed', 'active', 'amended', 'suspended', 'rejected', 'closed'];

function AnalystMerchantView({ token, role }: { token: string; role: string }) {
  const isMerchantOfficer = role === 'merchant_officer';
  const [merchants, setMerchants]       = useState<MerchantRecord[]>([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [pageSize, setPageSize]         = useState(10);
  const [loading, setLoading]           = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [nameInput, setNameInput]       = useState('');
  const [nameFilter, setNameFilter]     = useState('');

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
      setMerchants([]); setTotal(0);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    let status = ''; let name = '';
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const s = sp.get('status'); const q = sp.get('q');
      if (s) { status = s; setStatusFilter(s); }
      if (q) { name = q; setNameInput(q); setNameFilter(q); }
    }
    load(1, pageSize, status, name);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch() { const v = nameInput.trim(); setNameFilter(v); setPage(1); load(1, pageSize, statusFilter, v); }
  function handleStatusChange(s: string) { setStatusFilter(s); setPage(1); load(1, pageSize, s, nameFilter); }
  function handleClear() { setNameInput(''); setNameFilter(''); setStatusFilter(''); setPage(1); load(1, pageSize, '', ''); }
  function handlePageChange(p: number) { setPage(p); load(p, pageSize, statusFilter, nameFilter); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function handleLimitChange(l: number) { setPageSize(l); setPage(1); load(1, l, statusFilter, nameFilter); }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = !!nameFilter || !!statusFilter;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Store}
        title="Merchant Agreements"
        description={isMerchantOfficer ? 'Full merchant portfolio across the lifecycle.' : 'Read-only oversight of all merchant agreements.'}
        debugInfo="BIAN SD-89 MerchantAgreementProcedure · PCI DSS Req 7 · Req 12.8"
        actions={isMerchantOfficer && (
          <Link href="/system/merchant/review"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] text-sm font-medium hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors shrink-0">
            <ClipboardCheck size={14} /> Review queue
          </Link>
        )}
      />

      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text" value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by merchant name..."
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button onClick={handleSearch} disabled={!nameInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50">
            <Search size={14} /><span className="hidden sm:inline">Search</span>
          </button>
          {hasFilters && (
            <button onClick={handleClear} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
              <X size={14} /><span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
        <div className="flex gap-3 flex-wrap items-center">
          <Filter size={14} className="text-gray-400 shrink-0" />
          <select value={statusFilter} onChange={(e) => handleStatusChange(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">All statuses</option>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
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
              <Link key={m.merchantAgreementInstanceReference} href={`/system/merchant/${m.merchantAgreementInstanceReference}`}
                className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors group">
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
                    <span className="text-xs text-gray-400 font-mono">MCC {m.merchantCategoryCode} · {m.merchantCountryCode}{m.merchantTier && ` · ${m.merchantTier}`}</span>
                    {m.merchantAgreementKybCheck && <KybStatusBadge kyb={m.merchantAgreementKybCheck} />}
                  </div>
                </div>
                <div className="text-xs text-gray-400 font-mono shrink-0 hidden sm:block truncate max-w-[160px]">{m.merchantAgreementInstanceReference}</div>
                <ChevronRight size={16} className="text-gray-300 group-hover:text-[#001E2B] transition-colors shrink-0" />
              </Link>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} limit={pageSize}
            onPageChange={handlePageChange} onLimitChange={handleLimitChange} limitOptions={[10, 20, 50]} noun="merchants" />
        </>
      )}
    </div>
  );
}

// ── Root page ─────────────────────────────────────────────────────────────────

export default function MerchantPage() {
  const [token, setToken]             = useState('');
  const [role, setRole]               = useState('');
  const [loading, setLoading]         = useState(true);
  const [merchants, setMerchants]     = useState<MerchantRecord[] | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const loadMine = useCallback(async (t: string) => {
    try {
      const res = await api.merchants.list({ page: 1, limit: 50 }, t);
      setMerchants(res.results as unknown as MerchantRecord[]);
    } catch {
      setMerchants([]);
    }
  }, []);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    const r = decodeToken(t)?.role ?? '';
    setRole(r);
    if (r === 'customer') {
      loadMine(t).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [loadMine]);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>;
  }

  // Staff / analyst view
  if (role !== 'customer') {
    return <AnalystMerchantView token={token} role={role} />;
  }

  // Customer: registration form (first merchant or explicit register action)
  if (showRegister || (merchants !== null && merchants.length === 0)) {
    return (
      <MerchantApplicationForm
        token={token}
        onCancel={merchants && merchants.length > 0 ? () => setShowRegister(false) : undefined}
        onSubmitted={() => {
          setShowRegister(false);
          loadMine(token);
        }}
      />
    );
  }

  // Customer: merchant list
  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <CustomerMerchantList
        token={token}
        onRegister={() => setShowRegister(true)}
      />
    </div>
  );
}

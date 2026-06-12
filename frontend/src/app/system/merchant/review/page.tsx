'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useDebugMode } from '../../../../lib/debugMode';
import { Pagination } from '../../../../components/Pagination';

interface MerchantRecord {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantLegalEntityReference?: string;
  merchantCategoryCode: string;
  merchantCountryCode: string;
  merchantAgreementStatus: string;
  merchantRiskCategory?: string;
  merchantTier?: string;
  merchantOwnerPartyReference?: string;
  recordCreatedDateTime?: string;
}

interface ReviewState {
  merchantId: string;
  action: 'approve' | 'reject' | null;
  note: string;
  loading: boolean;
  done: boolean;
  error: string;
}

const MCC_LABELS: Record<string, string> = {
  '5411': 'Grocery Stores',
  '5812': 'Restaurants',
  '5999': 'Retail',
  '6011': 'ATM / Cash',
  '7371': 'IT Services',
  '7372': 'Software',
  '7389': 'Consulting',
  '7995': 'Gambling',
};

export default function MerchantReviewPage() {
  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  const [merchants, setMerchants] = useState<MerchantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewState, setReviewState] = useState<Record<string, ReviewState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterMcc, setFilterMcc] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const { debugMode } = useDebugMode();

  const loadQueue = useCallback(async (
    tok: string,
    p = 1,
    ps = 10,
    name = '',
    mcc = '',
    risk = '',
  ) => {
    setLoading(true);
    try {
      const res = await api.merchants.list({
        status: 'under_review',
        page: p,
        limit: ps,
        ...(name && { name }),
        ...(mcc && { mcc }),
        ...(risk && { risk }),
      }, tok);
      setMerchants(res.results as unknown as MerchantRecord[]);
      setTotal(res.total);
    } catch {}
    setLoading(false);
  }, []);

  function applySearch() {
    const name = searchInput.trim();
    setFilterName(name);
    setPage(1);
    loadQueue(token, 1, pageSize, name, filterMcc, filterRisk);
  }

  function handleMccChange(mcc: string) {
    setFilterMcc(mcc);
    setPage(1);
    loadQueue(token, 1, pageSize, filterName, mcc, filterRisk);
  }

  function handleRiskChange(risk: string) {
    setFilterRisk(risk);
    setPage(1);
    loadQueue(token, 1, pageSize, filterName, filterMcc, risk);
  }

  function clearFilters() {
    setSearchInput('');
    setFilterName('');
    setFilterMcc('');
    setFilterRisk('');
    setPage(1);
    loadQueue(token, 1, pageSize, '', '', '');
  }

  const hasFilters = filterName || filterMcc || filterRisk;

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) return;
    const decoded = decodeToken(t);
    setRole(decoded?.role ?? '');
    loadQueue(t, 1, pageSize, '', '', '');
  }, [loadQueue]);

  function initReview(merchantId: string, action: 'approve' | 'reject') {
    setReviewState((prev) => ({
      ...prev,
      [merchantId]: { merchantId, action, note: '', loading: false, done: false, error: '' },
    }));
    setExpanded((prev) => ({ ...prev, [merchantId]: true }));
  }

  function cancelReview(merchantId: string) {
    setReviewState((prev) => {
      const next = { ...prev };
      delete next[merchantId];
      return next;
    });
  }

  async function submitReview(merchantId: string) {
    const state = reviewState[merchantId];
    if (!state || !state.action) return;
    if (state.action === 'reject' && !state.note.trim()) {
      setReviewState((prev) => ({ ...prev, [merchantId]: { ...prev[merchantId], error: 'Review note is required for rejection.' } }));
      return;
    }
    setReviewState((prev) => ({ ...prev, [merchantId]: { ...prev[merchantId], loading: true, error: '' } }));
    try {
      await api.merchants.review(merchantId, { action: state.action, reviewNote: state.note || undefined }, token);
      setReviewState((prev) => ({ ...prev, [merchantId]: { ...prev[merchantId], loading: false, done: true } }));
      // Remove from queue after a short delay
      setTimeout(() => {
        setMerchants((prev) => prev.filter((m) => m.merchantAgreementInstanceReference !== merchantId));
        setReviewState((prev) => { const n = { ...prev }; delete n[merchantId]; return n; });
      }, 2000);
    } catch (err) {
      setReviewState((prev) => ({
        ...prev,
        [merchantId]: { ...prev[merchantId], loading: false, error: err instanceof Error ? err.message : 'Review failed.' },
      }));
    }
  }

  // Access guard: only merchant_officer and security_auditor
  if (role && role !== 'merchant_officer' && role !== 'security_auditor') {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center space-y-3">
        <AlertTriangle size={32} className="text-red-400 mx-auto" />
        <div className="text-gray-700 font-medium">Access Denied</div>
        <div className="text-sm text-gray-500">
          This page is restricted to <code className="bg-gray-100 px-1 rounded">merchant_officer</code> and <code className="bg-gray-100 px-1 rounded">security_auditor</code> roles.
        </div>
        {debugMode && <div className="text-xs text-gray-400 mt-2">PCI DSS Req 7.1, Least privilege access control</div>}
      </div>
    );
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Clock size={20} className="text-[#001E2B]" />
            <h1 className="text-xl font-bold text-gray-900">Merchant Review Queue</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {debugMode ? 'KYB review, BIAN SD-89 Action: Control. Approve or reject pending merchant applications.' : 'Approve or reject pending merchant applications.'}
          </p>
        </div>
        <button
          onClick={() => loadQueue(token, page, pageSize, filterName, filterMcc, filterRisk)}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* BIAN + PCI info strip, debug mode only */}
      {debugMode && (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full px-3 py-1 text-xs text-blue-700 font-medium">
            <span className="font-bold">BIAN SD-89</span> · Action: Control
          </span>
          <span className="inline-flex items-center gap-1 bg-purple-50 border border-purple-200 rounded-full px-3 py-1 text-xs text-purple-700">
            PCI DSS Req 7.1 · Req 12.8
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            placeholder="Search by merchant name…"
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={applySearch}
            disabled={!searchInput.trim() && !filterName}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50"
          >
            <Search size={14} />
            <span className="hidden sm:inline">Search</span>
          </button>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50"
            >
              <X size={14} />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterMcc}
            onChange={(e) => handleMccChange(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All categories</option>
            {Object.entries(MCC_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <select
            value={filterRisk}
            onChange={(e) => handleRiskChange(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All risk levels</option>
            <option value="low">Low risk</option>
            <option value="medium">Medium risk</option>
            <option value="high">High risk</option>
          </select>
          {!loading && (
            <span className="text-sm text-gray-400 self-center ml-auto">
              {total} application{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Queue */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading review queue...</div>
      ) : merchants.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center space-y-2">
          <CheckCircle2 size={28} className="text-green-600 mx-auto" />
          <div className="text-gray-700 font-medium">All caught up!</div>
          <div className="text-sm text-gray-500">No applications pending review.</div>
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {merchants.map((m) => {
            const rs = reviewState[m.merchantAgreementInstanceReference];
            const isExpanded = expanded[m.merchantAgreementInstanceReference];
            const isHighRisk = m.merchantRiskCategory === 'high' || ['6011', '7995'].includes(m.merchantCategoryCode);

            return (
              <div
                key={m.merchantAgreementInstanceReference}
                className={`bg-white rounded-xl border ${isHighRisk ? 'border-red-200' : 'border-gray-200'} overflow-hidden`}
              >
                {/* Card header */}
                <div
                  className="px-5 py-4 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpanded((prev) => ({ ...prev, [m.merchantAgreementInstanceReference]: !prev[m.merchantAgreementInstanceReference] }))}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800">{m.merchantName}</span>
                      <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">Pending Review</span>
                      <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                        {MCC_LABELS[m.merchantCategoryCode] ?? m.merchantCategoryCode}
                      </span>
                      {isHighRisk && (
                        <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full flex items-center gap-1">
                          <AlertTriangle size={10} /> High risk
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {m.merchantCountryCode}
                      {m.recordCreatedDateTime && ` · Submitted ${new Date(m.recordCreatedDateTime).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-gray-400">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Expanded details + review actions */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                    {/* Application details */}
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      {m.merchantLegalEntityReference && (
                        <>
                          <dt className="text-gray-500">Tax ID / Reg #</dt>
                          <dd className="font-mono text-gray-700">{m.merchantLegalEntityReference}</dd>
                        </>
                      )}
                      <dt className="text-gray-500">Tier</dt>
                      <dd className="text-gray-700">{m.merchantTier ?? 'standard'}</dd>
                      <dt className="text-gray-500">Risk Category</dt>
                      <dd className={`font-medium ${m.merchantRiskCategory === 'high' ? 'text-red-600' : 'text-green-600'}`}>
                        {m.merchantRiskCategory ?? 'low'}
                      </dd>
                      {m.merchantOwnerPartyReference && (
                        <>
                          <dt className="text-gray-500">Owner Party Ref</dt>
                          <dd className="font-mono text-xs text-gray-400 truncate">{m.merchantOwnerPartyReference}</dd>
                        </>
                      )}
                      <dt className="text-gray-500">Application ID</dt>
                      <dd className="font-mono text-xs text-gray-400 truncate">{m.merchantAgreementInstanceReference}</dd>
                    </dl>

                    {/* Review form */}
                    {rs?.done ? (
                      <div className={`rounded-lg px-3 py-2.5 text-sm ${
                        rs.action === 'approve' ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'
                      }`}>
                        <div className={`flex items-center gap-2 font-medium ${rs.action === 'approve' ? 'text-green-700' : 'text-gray-600'}`}>
                          {rs.action === 'approve'
                            ? <><CheckCircle2 size={16} /> Application approved</>
                            : <><XCircle size={16} /> Application rejected</>
                          }
                        </div>
                        {debugMode && (
                          <div className="mt-1.5 text-xs text-gray-500 font-mono">
                            KYB: merchantAgreementKybCheckStatus → <span className={rs.action === 'approve' ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                              {rs.action === 'approve' ? 'verified' : 'rejected'}
                            </span>
                            {' '}· SD-89 BQ:Step · PCI Req 12.8
                          </div>
                        )}
                      </div>
                    ) : rs ? (
                      <div className="space-y-3 bg-gray-50 rounded-lg p-3">
                        <div className={`text-sm font-medium ${rs.action === 'approve' ? 'text-green-700' : 'text-red-600'}`}>
                          {rs.action === 'approve' ? '✓ Approving application' : '✗ Rejecting application'}
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">
                            Review note {rs.action === 'reject' && <span className="text-red-500">*</span>}
                            {rs.action === 'approve' && <span className="text-gray-400"> (optional)</span>}
                          </label>
                          <textarea
                            value={rs.note}
                            onChange={(e) => setReviewState((prev) => ({ ...prev, [m.merchantAgreementInstanceReference]: { ...prev[m.merchantAgreementInstanceReference], note: e.target.value } }))}
                            placeholder={rs.action === 'reject' ? 'Reason for rejection (required)…' : 'Approval notes…'}
                            rows={2}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 resize-none"
                          />
                        </div>
                        {rs.error && <div className="text-xs text-red-600">{rs.error}</div>}
                        <div className="flex gap-2">
                          <button
                            onClick={() => submitReview(m.merchantAgreementInstanceReference)}
                            disabled={rs.loading}
                            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
                              rs.action === 'approve'
                                ? 'bg-[#00ED64] text-[#001E2B] hover:bg-[#00ED64]/80'
                                : 'bg-red-600 text-white hover:bg-red-700'
                            }`}
                          >
                            {rs.loading ? 'Submitting…' : rs.action === 'approve' ? 'Confirm Approve' : 'Confirm Reject'}
                          </button>
                          <button
                            onClick={() => cancelReview(m.merchantAgreementInstanceReference)}
                            disabled={rs.loading}
                            className="px-4 py-1.5 rounded-lg text-sm text-gray-600 border border-gray-300 hover:bg-gray-100 transition-colors disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => initReview(m.merchantAgreementInstanceReference, 'approve')}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-[#00ED64] text-[#001E2B] hover:bg-[#00ED64]/80 font-medium py-2 rounded-lg transition-colors text-sm"
                        >
                          <CheckCircle2 size={15} /> Approve
                        </button>
                        <button
                          onClick={() => initReview(m.merchantAgreementInstanceReference, 'reject')}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-red-300 text-red-600 hover:bg-red-50 font-medium py-2 rounded-lg transition-colors text-sm"
                        >
                          <XCircle size={15} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          total={total}
          limit={pageSize}
          onPageChange={(p) => { setPage(p); loadQueue(token, p, pageSize, filterName, filterMcc, filterRisk); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          onLimitChange={(ps) => { setPageSize(ps); setPage(1); loadQueue(token, 1, ps, filterName, filterMcc, filterRisk); }}
          limitOptions={[5, 10, 20, 50]}
          noun="applications"
        />
      </>
      )}

      <div className="text-xs text-gray-400 text-center pt-2">
        Reviewed by: <span className="font-medium">{role}</span>
        {debugMode && ' · Approval recorded to audit trail (SD-89 → merchantReviewedByPartyReference)'}
      </div>
    </div>
  );
}

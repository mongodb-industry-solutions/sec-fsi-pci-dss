'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, FraudCase } from '../../../lib/api';
import { CaseTable } from '../../../components/CaseTable';
import { Pagination } from '../../../components/Pagination';
import { EncryptedKycSearch } from '../../../components/EncryptedKycSearch';
import { getSimTokenForRole, getSimToken } from '../../../lib/simulatorAuth';
import { ROLE_LABELS } from '../../../lib/constants';
import { LoadingIndicator } from '../../../components/LoadingIndicator';
import { formatAmount } from '../../../lib/money';

type SearchField = 'caseRef' | 'email' | 'phone' | 'accountRef' | 'cardToken';

const FIELD_LABELS: Record<SearchField, string> = {
  caseRef:    'Case Reference',
  email:      'Email',
  phone:      'Phone',
  accountRef: 'Account Reference',
  cardToken:  'Card Token',
};

const PAGE_SIZE = 10;

interface SimPaymentStep3 {
  cardTransactionInstanceReference?: string;
  caseId?: string | null;
  email?: string;
  amount?: number;
  currency?: string;
  merchantName?: string;
  method?: string;
  customerName?: string;
}

export default function SimulatorInvestigationPage() {
  const router = useRouter();
  const [simPayment, setSimPayment] = useState<SimPaymentStep3 | null>(null);
  const [pinnedCase, setPinnedCase] = useState<FraudCase | null>(null);
  const [pinnedLoading, setPinnedLoading] = useState(false);
  const [dbTxCount, setDbTxCount] = useState<number | null>(null);

  const [searchField, setSearchField]     = useState<SearchField>('email');
  const [searchValue, setSearchValue]     = useState('');
  const [filterStatus, setFilterStatus]   = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [cases, setCases]   = useState<FraudCase[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(true);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // On mount: read sim_payment_step3 and pre-populate email search
  useEffect(() => {
    const raw = sessionStorage.getItem('sim_payment_step3');
    if (!raw) return;
    try {
      const saved: SimPaymentStep3 = JSON.parse(raw);
      setSimPayment(saved);
      if (saved.email) {
        setSearchValue(saved.email);
        // Confirm DB state: how many transactions exist for this email. Authenticate as the persona
        // (real JWT) and use the REAL transactions endpoint (works in local + production, no open surface).
        getSimToken(saved.email)
          .then((token) => api.transactions.list({ kind: 'card', email: saved.email, limit: 1 }, token))
          .then((res: { total: number }) => setDbTxCount(res.total))
          .catch(() => null);
      }
      // Fetch the pinned case if we have its ID
      if (saved.caseId) {
        setPinnedLoading(true);
        api.fraud.getById(saved.caseId, '').then((c) => {
          setPinnedCase(c);
        }).catch(() => {}).finally(() => setPinnedLoading(false));
      }
    } catch { /* ignore */ }
  }, []);

  const loadCases = useCallback(async (targetPage: number) => {
    setLoading(true);
    try {
      const caseReference = searchField === 'caseRef' && searchValue.trim() ? searchValue.trim() : undefined;
      const res = await api.fraud.list(
        {
          status:   filterStatus   || undefined,
          severity: filterSeverity || undefined,
          caseReference,
          page:     targetPage,
          limit:    PAGE_SIZE,
        },
        ''
      );
      setCases(res.results);
      setTotal(res.total);
    } catch {
      setCases([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterSeverity, searchField, searchValue]);

  // Reload from page 1 when filters change
  useEffect(() => {
    setPage(1);
    loadCases(1);
  }, [filterStatus, filterSeverity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-linkable: prefill from ?field=&q=&status=&severity= once on mount and run the query.
  const [autoApplied, setAutoApplied] = useState(false);
  useEffect(() => {
    if (autoApplied || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const field = sp.get('field') as SearchField | null;
    const q = sp.get('q');
    const status = sp.get('status');
    const severity = sp.get('severity');
    setAutoApplied(true);
    if (!field && !q && !status && !severity) return;
    if (field && FIELD_LABELS[field]) setSearchField(field);
    if (q) setSearchValue(q);
    if (status) setFilterStatus(status);
    if (severity) setFilterSeverity(severity);
    (async () => {
      setLoading(true);
      try {
        const caseReference = field === 'caseRef' && q ? q : undefined;
        const res = await api.fraud.list(
          { status: status || undefined, severity: severity || undefined, caseReference, page: 1, limit: PAGE_SIZE },
          '',
        );
        setCases(res.results);
        setTotal(res.total);
        setPage(1);
      } catch {
        setCases([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    })();
  }, [autoApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    loadCases(1);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    loadCases(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        Fraud Investigation
      </h1>

      {/* ── Pinned case banner ─────────────────────────────────────── */}
      {simPayment && (
        <div className="bg-[#001E2B] text-white rounded-xl border border-[#00ED64]/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[#00ED64] text-lg">✓</span>
              <div>
                <span className="font-semibold text-sm">Payment completed, fraud case opened</span>
                {simPayment.customerName && (
                  <div className="text-xs text-gray-300 mt-0.5">
                    Paid by <span className="text-white font-medium">{simPayment.customerName}</span>
                    {simPayment.email && <span className="text-gray-400"> · {simPayment.email}</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {dbTxCount !== null && (
                <span className="text-xs text-[#00ED64] bg-[#00ED64]/10 border border-[#00ED64]/30 rounded px-2 py-0.5 font-mono">
                  {dbTxCount} txn{dbTxCount !== 1 ? 's' : ''} in MongoDB
                </span>
              )}
              {simPayment.amount !== undefined && simPayment.currency && (
                <span className="text-xs text-gray-300 bg-white/10 rounded px-2 py-0.5">
                  {formatAmount(simPayment.amount, simPayment.currency)}
                  {simPayment.merchantName ? ` · ${simPayment.merchantName}` : ''}
                  {simPayment.method ? ` · ${simPayment.method}` : ''}
                </span>
              )}
            </div>
          </div>

          {simPayment.caseId ? (
            pinnedLoading ? (
              <LoadingIndicator inline label="Loading case details…" size={13} className="text-gray-300" />
            ) : pinnedCase ? (
              <div className="bg-white/10 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs space-y-0.5">
                  <div className="font-mono text-[#00ED64]">{pinnedCase.fraudDiagnosisCaseReference}</div>
                  <div className="text-gray-300">
                    Status: <span className="capitalize">{pinnedCase.caseStatus.replace(/_/g, ' ')}</span>
                    &nbsp;·&nbsp;Severity: <span className="uppercase">{pinnedCase.riskSeverity}</span>
                  </div>
                  <div className="text-gray-400 font-mono text-[10px]">ID: {pinnedCase.fraudDiagnosisInstanceReference}</div>
                </div>
                <button
                  onClick={() => router.push(`/simulator/investigation/${pinnedCase.fraudDiagnosisInstanceReference}`)}
                  className="shrink-0 bg-[#00ED64] text-[#001E2B] font-semibold text-xs px-4 py-2 rounded-lg hover:bg-[#00c94f] transition-colors"
                >
                  Open case →
                </button>
              </div>
            ) : (
              <div className="bg-white/10 rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="text-xs text-gray-300">
                  Case ID: <span className="font-mono text-[#00ED64]">{simPayment.caseId}</span>
                </div>
                <button
                  onClick={() => router.push(`/simulator/investigation/${simPayment.caseId}`)}
                  className="shrink-0 bg-[#00ED64] text-[#001E2B] font-semibold text-xs px-4 py-2 rounded-lg hover:bg-[#00c94f] transition-colors"
                >
                  Open case →
                </button>
              </div>
            )
          ) : (
            <p className="text-xs text-amber-400">
              No fraud case was created for this transaction. The transaction passed risk scoring without triggering a case.
            </p>
          )}

          {simPayment.cardTransactionInstanceReference && (
            <p className="text-[11px] text-gray-500 font-mono">
              txn: {simPayment.cardTransactionInstanceReference}
            </p>
          )}
        </div>
      )}

      {/* ── Search bar ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border p-4">
        <form onSubmit={handleSearch} className="flex gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Search by</label>
            <select
              value={searchField}
              onChange={(e) => setSearchField(e.target.value as SearchField)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              {(Object.keys(FIELD_LABELS) as SearchField[]).map((f) => (
                <option key={f} value={f}>{FIELD_LABELS[f]}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Value</label>
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={`Search by ${FIELD_LABELS[searchField]}...`}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
          >
            Search
          </button>
        </form>
        {searchField === 'caseRef' ? (
          <p className="mt-2 text-xs text-gray-500">
            Case reference (e.g. <span className="font-mono">FD-2026-001001</span>) is operational case
            metadata (no PII); matched directly on the fraud case record.
          </p>
        ) : searchField !== 'cardToken' ? (
          <p className="mt-2 text-xs text-gray-500">
            {FIELD_LABELS[searchField]} is a QE equality-searchable encrypted field. The server
            matches ciphertext-to-ciphertext without decrypting.
          </p>
        ) : (
          <p className="mt-2 text-xs text-gray-500">
            Card token uses a standard MongoDB index; it is a card surrogate, not CHD under
            PCI DSS v4.0.
          </p>
        )}
      </div>

      {/* ── Filters + count ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="text-sm text-gray-500">Filter:</span>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">All Status</option>
          {['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">All Severity</option>
          {['critical', 'high', 'medium', 'low'].map((s) => (
            <option key={s} value={s}>{s.toUpperCase()}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500 ml-auto">
          {total} case{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      {loading ? (
        <LoadingIndicator label="Loading cases…" className="py-10" />
      ) : (
        <>
          <CaseTable cases={cases} basePath="/simulator/investigation" />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={PAGE_SIZE}
            onPageChange={handlePageChange}
          />
        </>
      )}

      {/* ── Encrypted KYC search (Queryable Encryption showcase) ─────── */}
      <SimulatorKycSearchPanel />
    </div>
  );
}

const KYC_ROLES = ['level1_analyst', 'level2_investigator', 'security_auditor'] as const;
type KycRole = (typeof KYC_ROLES)[number];

// Simulator wrapper around the SHARED EncryptedKycSearch component. It adds the presenter
// narrative and a role switcher (there is no login in the simulator, so it obtains a real
// per-role JWT via the same login endpoint application mode uses). The search UI itself is
// not forked: it is the identical component mounted in the production investigation view.
function SimulatorKycSearchPanel() {
  // Default to L2 so the search is demoable immediately; switching to L1 shows the
  // least-privilege gate (blind lookup only), which is itself part of the narrative.
  const [role, setRole] = useState<KycRole>('level2_investigator');
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTokenError(null);
    setToken('');
    getSimTokenForRole(role)
      .then((t) => { if (!cancelled) setToken(t); })
      .catch((e) => { if (!cancelled) setTokenError((e as Error).message || 'Could not obtain a demo token'); });
    return () => { cancelled = true; };
  }, [role]);

  return (
    <section className="space-y-4 pt-2">
      <div className="rounded-xl border border-[#00ED64]/30 bg-[#001E2B] p-4 text-white">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span className="text-[#00ED64]">🔐</span> Search over encrypted data
        </h2>
        <p className="mt-1 text-sm text-gray-300">
          Every query below runs over <strong className="text-white">Queryable Encryption</strong> fields.
          MongoDB matches ciphertext-to-ciphertext and never sees the plaintext. Switch the analyst tier to
          see how the <em>same</em> search returns different fields: Level 1 triages on non-identifying
          attributes, Level 2 (with an approved escalation) and the auditor can also see contact and
          sensitive PII.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">Acting as:</span>
          {KYC_ROLES.map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                role === r ? 'bg-[#00ED64] text-[#001E2B]' : 'bg-white/10 text-gray-200 hover:bg-white/20'
              }`}
            >
              {ROLE_LABELS[r] ?? r}
            </button>
          ))}
        </div>
      </div>

      {tokenError ? (
        <div className="text-sm text-red-600">{tokenError}</div>
      ) : !token ? (
        <LoadingIndicator label={`Waiting for the server to load the ${ROLE_LABELS[role] ?? role} token…`} className="py-6" size={20} />
      ) : (
        <EncryptedKycSearch token={token} role={role} />
      )}
    </section>
  );
}


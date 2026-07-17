'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, FraudCase } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { CaseTable } from '../../../components/CaseTable';
import { Pagination } from '../../../components/Pagination';
import { useDebugMode } from '../../../lib/debugMode';
import { SectionHeader } from '../../../components/SectionHeader';
import { EncryptedKycSearch } from '../../../components/EncryptedKycSearch';
import { BriefcaseMedical, ShieldCheck } from 'lucide-react';

type SearchField = 'caseRef' | 'email' | 'phone' | 'accountRef' | 'cardToken' | 'customerId';

const PAGE_SIZE = 10;

const FIELD_LABELS: Record<SearchField, string> = {
  caseRef:    'Case Reference',
  email:      'Email (QE:equality)',
  phone:      'Phone (QE:equality)',
  accountRef: 'Account Ref (QE:equality)',
  cardToken:  'Card Token',
  customerId: 'Customer Ref (internal)',
};

const FIELD_PLACEHOLDERS: Record<SearchField, string> = {
  caseRef:    'FD-2026-001001',
  email:      'customer@example.com',
  phone:      '+1-555-0000',
  accountRef: 'ACC-001',
  cardToken:  'pm_xxxxxxxx',
  customerId: 'CUST-...',
};

export default function InvestigationPage() {
  const router = useRouter();
  const { debugMode } = useDebugMode();
  const [token, setToken] = useState('');
  const [user, setUser] = useState<ReturnType<typeof decodeToken>>(null);

  useEffect(() => {
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    setToken(t);
    setUser(u);
    if (u?.role === 'customer') {
      router.replace('/system/payment/history');
      return;
    }
    // Investigation is for fraud analyst/auditor roles only. Other authenticated roles
    // (manager, merchant_officer) are sent to their own hub. Mirrors the server-side guard.
    if (u && !['level1_analyst', 'level2_investigator', 'security_auditor'].includes(u.role)) {
      router.replace('/system');
      return;
    }
    if (u?.role === 'level2_investigator') {
      setFilterStatus('escalated');
    }
  }, [router]);

  const [cases, setCases]   = useState<FraudCase[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);

  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [searchField,    setSearchField]    = useState<SearchField>('email');
  const [searchValue,    setSearchValue]    = useState('');
  const [searchError,    setSearchError]    = useState<string | null>(null);
  const [isSearchMode,   setIsSearchMode]   = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadCases = useCallback(async (targetPage: number, ps: number) => {
    setLoading(true);
    try {
      const res = await api.fraud.list(
        {
          status:   filterStatus   || undefined,
          severity: filterSeverity || undefined,
          page:     targetPage,
          limit:    ps,
        },
        token
      );
      setCases(res.results);
      setTotal(res.total);
    } catch {
      setCases([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterSeverity, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isSearchMode && token) {
      setPage(1);
      loadCases(1, pageSize);
    }
  }, [filterStatus, filterSeverity, token, isSearchMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-linkable filters: prefill from ?field=&q=&status=&severity= and auto-run once.
  // Read window.location.search INSIDE the effect (post-commit) so it works with Next
  // client-side navigation (a Link click), not only on a full page load.
  const [autoApplied, setAutoApplied] = useState(false);
  useEffect(() => {
    if (autoApplied || !token || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const field = sp.get('field') as SearchField | null;
    const q = sp.get('q');
    const status = sp.get('status');
    const severity = sp.get('severity');
    if (!field && !q && !status && !severity) { setAutoApplied(true); return; }
    if (status) setFilterStatus(status);
    if (severity) setFilterSeverity(severity);
    if (field && FIELD_LABELS[field]) setSearchField(field);
    if (q) {
      setSearchValue(q);
      handleSearch(q, field && FIELD_LABELS[field] ? field : undefined);
    }
    setAutoApplied(true);
  }, [token, autoApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSearch(valueOverride?: string, fieldOverride?: SearchField) {
    const field = fieldOverride ?? searchField;
    const value = (valueOverride ?? searchValue).trim();
    if (!value) {
      // Clear search  -  back to full list
      setIsSearchMode(false);
      setSearchError(null);
      setPage(1);
      loadCases(1, pageSize);
      return;
    }

    setLoading(true);
    setSearchError(null);
    setIsSearchMode(true);

    try {
      let foundCases: FraudCase[] = [];

      if (field === 'caseRef') {
        // Case reference (e.g. FD-2026-001001): direct backend filter on the human reference.
        const res = await api.fraud.list({ caseReference: value, limit: 50 }, token);
        foundCases = res.results;

      } else if (field === 'customerId') {
        // Internal customer reference: cases referencing a customerAgreementInstanceReference.
        // Used to review orphaned references flagged by the data-integrity oversight.
        const res = await api.fraud.list({ customerId: value, limit: 50 }, token);
        foundCases = res.results;

      } else if (field === 'cardToken') {
        // Card token: get transactions for this token, then find their fraud cases
        const txnRes = await api.transactions.getByCardToken(value, token);
        if (!txnRes.results.length) {
          setCases([]);
          setTotal(0);
          setSearchError(`No transactions found for card token "${value}".`);
          return;
        }

        const casePromises = (txnRes.results as Array<{ cardTransactionInstanceReference?: string }>)
          .filter(t => t.cardTransactionInstanceReference)
          .map(t =>
            api.fraud.list({ transactionId: t.cardTransactionInstanceReference!, limit: 10 }, token)
              .catch(() => ({ results: [] as FraudCase[], total: 0, page: 1, limit: 10 }))
          );
        const resolved = await Promise.all(casePromises);
        const all = resolved.flatMap(r => r.results);

        // Deduplicate
        const seen = new Set<string>();
        foundCases = all.filter(c => {
          if (seen.has(c.fraudDiagnosisInstanceReference)) return false;
          seen.add(c.fraudDiagnosisInstanceReference);
          return true;
        });

      } else {
        // QE equality search: resolve customer UUID, then filter cases by customerId
        let customerData: Record<string, unknown> | null = null;
        try {
          if (field === 'email')      customerData = await api.customer.getByEmail(value, token);
          else if (field === 'phone') customerData = await api.customer.getByPhone(value, token);
          else                        customerData = await api.customer.getByAccountRef(value, token);
        } catch {
          setSearchError(`No customer found for this ${FIELD_LABELS[field].replace(' (QE:equality)', '')}.`);
          setCases([]);
          setTotal(0);
          return;
        }

        if (!customerData) {
          setSearchError('Customer not found.');
          setCases([]);
          setTotal(0);
          return;
        }

        const customerId = customerData['customerAgreementInstanceReference'] as string | undefined;
        if (!customerId) {
          setSearchError('Could not resolve customer ID.');
          setCases([]);
          setTotal(0);
          return;
        }

        const res = await api.fraud.list({ customerId, limit: 50 }, token);
        foundCases = res.results;
      }

      if (foundCases.length === 0) {
        setSearchError('No investigation cases found for this value.');
      }
      setCases(foundCases);
      setTotal(foundCases.length);

    } catch {
      setSearchError('Search failed. Please try again.');
      setCases([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  function clearSearch() {
    setSearchValue('');
    setSearchError(null);
    setIsSearchMode(false);
    setPage(1);
    loadCases(1, pageSize);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    if (!isSearchMode) {
      loadCases(newPage, pageSize);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleLimitChange(newLimit: number) {
    setPageSize(newLimit);
    setPage(1);
    if (!isSearchMode) {
      loadCases(1, newLimit);
    }
  }

  return (
    <div className="min-h-full bg-gray-50">
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
        <SectionHeader
          icon={BriefcaseMedical}
          title="Cases"
          description="Review, escalate and resolve fraud cases."
          debugInfo="BIAN SD-83 Fraud Diagnosis · PCI DSS Req 10.4 (audit trail)"
        />

        {/* Search */}
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex gap-3">
            <select
              value={searchField}
              onChange={(e) => { setSearchField(e.target.value as SearchField); setSearchValue(''); setSearchError(null); }}
              className="border rounded-lg px-3 py-2 text-sm bg-white"
            >
              {(Object.keys(FIELD_LABELS) as SearchField[]).map(f => (
                <option key={f} value={f}>{FIELD_LABELS[f]}</option>
              ))}
            </select>
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={FIELD_PLACEHOLDERS[searchField]}
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => handleSearch()}
              disabled={loading}
              className="bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors disabled:opacity-50"
            >
              Search
            </button>
            {isSearchMode && (
              <button
                onClick={clearSearch}
                className="px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50"
              >
                Clear
              </button>
            )}
          </div>
          {searchError && <p className="text-sm text-red-600">{searchError}</p>}
          {isSearchMode && !searchError && (
            <p className="text-xs text-blue-600">
              Showing search results for {FIELD_LABELS[searchField]}: <strong>{searchValue}</strong>
            </p>
          )}
        </div>

        {/* Filters (hidden in search mode) */}
        {!isSearchMode && (
          <div className="flex flex-wrap gap-3 items-center text-sm">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border rounded-lg px-3 py-1.5"
            >
              <option value="">All Status</option>
              {['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'].map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="border rounded-lg px-3 py-1.5"
            >
              <option value="">All Severity</option>
              {['critical', 'high', 'medium', 'low'].map((s) => (
                <option key={s} value={s}>{s.toUpperCase()}</option>
              ))}
            </select>
            {debugMode && user?.role === 'level2_investigator' && filterStatus === 'escalated' && (
              <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded">
                Showing escalated cases (L2 default)
              </span>
            )}
            <span className="text-gray-500 ml-auto">{total} cases</span>
          </div>
        )}

        {/* Table + Pagination */}
        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading...</div>
        ) : (
          <>
            <CaseTable cases={cases} basePath="/system/investigation" />
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={pageSize}
              onPageChange={handlePageChange}
              onLimitChange={handleLimitChange}
              limitOptions={[10, 20, 50, 100]}
              noun="cases"
            />
          </>
        )}

        {/* v27: encrypted-KYC search over Queryable Encryption. Same shared component used in the
            simulator. Result columns adapt to the acting role (from the JWT); the server is the
            security boundary. */}
        {token && user && (
          <section className="pt-2 space-y-4">
            <SectionHeader
              icon={ShieldCheck}
              title="Encrypted KYC search"
              description="Query encrypted KYC records with Queryable Encryption. The server matches ciphertext-to-ciphertext; visible fields follow your role."
              debugInfo="BIAN SD-53 Customer Agreement · PCI DSS Req 3/7 · MongoDB Queryable Encryption"
            />
            <EncryptedKycSearch token={token} role={user.role} />
          </section>
        )}
      </main>
    </div>
  );
}

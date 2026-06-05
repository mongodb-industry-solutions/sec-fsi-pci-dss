'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, FraudCase } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { CaseTable } from '../../../components/CaseTable';
import { Pagination } from '../../../components/Pagination';
import { ROLE_LABELS } from '../../../lib/constants';
import Link from 'next/link';

type SearchField = 'email' | 'phone' | 'accountRef' | 'cardToken';

const PAGE_SIZE = 10;

export default function InvestigationPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [user, setUser] = useState<ReturnType<typeof decodeToken>>(null);

  useEffect(() => {
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    setToken(t);
    setUser(u);
    if (u?.role === 'customer') {
      router.replace('/demo/payment/history');
      return;
    }
    // L2 Investigators see escalated cases first by default
    if (u?.role === 'level2_investigator') {
      setFilterStatus('escalated');
    }
  }, [router]);

  const [cases, setCases]   = useState<FraudCase[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(true);

  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [searchField,    setSearchField]    = useState<SearchField>('email');
  const [searchValue,    setSearchValue]    = useState('');

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadCases = useCallback(async (targetPage: number) => {
    setLoading(true);
    try {
      const res = await api.fraud.list(
        {
          status:   filterStatus   || undefined,
          severity: filterSeverity || undefined,
          page:     targetPage,
          limit:    PAGE_SIZE,
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
    setPage(1);
    loadCases(1);
  }, [filterStatus, filterSeverity]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePageChange(newPage: number) {
    setPage(newPage);
    loadCases(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex items-center justify-between">
        <span className="font-bold text-[#00ED64]">🏦 Payment Gateway</span>
        <div className="flex items-center gap-3 text-sm">
          {user && (
            <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">
              {user.name} · {ROLE_LABELS[user.role] ?? user.role}
            </span>
          )}
          <Link href="/demo" className="text-gray-400 hover:text-white">Sign out</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-5">
        <h1 className="text-2xl font-bold">Case Dashboard</h1>

        {/* Search */}
        <div className="bg-white rounded-xl border p-4">
          <div className="flex gap-3">
            <select
              value={searchField}
              onChange={(e) => setSearchField(e.target.value as SearchField)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="email">Email (QE)</option>
              <option value="phone">Phone (QE)</option>
              <option value="accountRef">Account Ref (QE)</option>
              <option value="cardToken">Card Token</option>
            </select>
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search value..."
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => { setPage(1); loadCases(1); }}
              className="bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
            >
              Search
            </button>
          </div>
        </div>

        {/* Filters */}
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
          {user?.role === 'level2_investigator' && filterStatus === 'escalated' && (
            <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded">
              Showing escalated cases (L2 default)
            </span>
          )}
          <span className="text-gray-500 ml-auto">{total} cases</span>
        </div>

        {/* Table + Pagination */}
        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading...</div>
        ) : (
          <>
            <CaseTable cases={cases} basePath="/demo/investigation" />
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={PAGE_SIZE}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </main>
    </div>
  );
}

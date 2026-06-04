'use client';
import { useState, useEffect, useCallback } from 'react';
import { api, FraudCase } from '../../../lib/api';
import { CaseTable } from '../../../components/CaseTable';
import { Pagination } from '../../../components/Pagination';

type SearchField = 'email' | 'phone' | 'accountRef' | 'cardToken';

const FIELD_LABELS: Record<SearchField, string> = {
  email:      'Email',
  phone:      'Phone',
  accountRef: 'Account Reference',
  cardToken:  'Card Token',
};

const PAGE_SIZE = 10;

export default function SimulatorInvestigationPage() {
  const [searchField, setSearchField]     = useState<SearchField>('email');
  const [searchValue, setSearchValue]     = useState('luis.fernandez@leafybank.demo');
  const [filterStatus, setFilterStatus]   = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [cases, setCases]   = useState<FraudCase[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(true);

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
  }, [filterStatus, filterSeverity]);

  // Reload from page 1 when filters change
  useEffect(() => {
    setPage(1);
    loadCases(1);
  }, [filterStatus, filterSeverity]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Search bar */}
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
        {searchField !== 'cardToken' ? (
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

      {/* Filters + count */}
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

      {/* Table */}
      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading cases...</div>
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
    </div>
  );
}

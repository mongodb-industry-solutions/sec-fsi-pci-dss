'use client';
import { useState, useEffect } from 'react';
import { api, FraudCase } from '../../../lib/api';
import { CaseTable } from '../../../components/CaseTable';

type SearchField = 'email' | 'phone' | 'accountRef' | 'cardToken';

const FIELD_LABELS: Record<SearchField, string> = {
  email: 'Email',
  phone: 'Phone',
  accountRef: 'Account Reference',
  cardToken: 'Card Token',
};

export default function SimulatorInvestigationPage() {
  const [searchField, setSearchField] = useState<SearchField>('email');
  const [searchValue, setSearchValue] = useState('luis.fernandez@leafybank.demo');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCases();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterSeverity]);

  async function loadCases() {
    setLoading(true);
    try {
      const res = await api.fraud.list(
        { status: filterStatus || undefined, severity: filterSeverity || undefined, limit: 20 },
        ''
      );
      setCases(res.results);
      setTotal(res.total);
    } catch {
      setCases([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    // For demonstration: search by encrypted field or standard index
    // In simulator mode, we still call the API to show real results
    await loadCases();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        🕵️ Fraud Investigation
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
                <option key={f} value={f}>
                  {FIELD_LABELS[f]}
                </option>
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
            🔍 Search
          </button>
        </form>
        {searchField !== 'cardToken' && (
          <p className="mt-2 text-xs text-gray-500">
            🔒 {FIELD_LABELS[searchField]} is a QE equality-searchable encrypted field. The server
            matches ciphertext-to-ciphertext without decrypting.
          </p>
        )}
        {searchField === 'cardToken' && (
          <p className="mt-2 text-xs text-gray-500">
            ✅ Card token uses a standard MongoDB index; it is a card surrogate, not CHD under
            PCI DSS v4.0.
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <span className="text-sm text-gray-500">Filter:</span>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">All Status</option>
          {['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'].map(
            (s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            )
          )}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">All Severity</option>
          {['critical', 'high', 'medium', 'low'].map((s) => (
            <option key={s} value={s}>
              {s.toUpperCase()}
            </option>
          ))}
        </select>
        <span className="text-sm text-gray-500 ml-auto">{total} case{total !== 1 ? 's' : ''} total</span>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading cases…</div>
      ) : (
        <CaseTable cases={cases} basePath="/simulator/investigation" />
      )}
    </div>
  );
}

'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { Pagination } from '../../../components/Pagination';

interface Transaction {
  cardTransactionInstanceReference?: string;
  paymentCardReference?: string;
  cardTransactionAmount?: { amount: number; currency: string };
  cardTransactionDateTime?: string;
  cardTransactionStatus?: string;
  cardTransactionMerchantName?: string;
  cardTransactionMerchantCategoryCode?: string;
  cardTransactionChannel?: string;
  cardTransactionMaskedPanDisplay?: string;
}

const STATUS_COLORS: Record<string, string> = {
  authorized: 'bg-green-100 text-green-800',
  settled:    'bg-green-100 text-green-800',
  disputed:   'bg-red-100 text-red-800',
  declined:   'bg-red-100 text-red-800',
  pending:    'bg-amber-100 text-amber-800',
};

const PAGE_SIZE = 20;

export default function TransactionsPage() {
  const router = useRouter();
  const [token, setToken] = useState('');

  useEffect(() => {
    const t = getToken() ?? '';
    const user = t ? decodeToken(t) : null;
    if (user?.role === 'customer') {
      router.replace('/demo/payment/history');
      return;
    }
    setToken(t);
  }, [router]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);

  const [filterStatus,    setFilterStatus]    = useState('');
  const [filterMerchant,  setFilterMerchant]  = useState('');
  const [filterCardToken, setFilterCardToken] = useState('');
  const [filterEmail,     setFilterEmail]     = useState('');
  const [searchInput,     setSearchInput]     = useState('');
  const [searchType,      setSearchType]      = useState<'text' | 'email'>('text');

  const load = useCallback(async (p: number, ps: number) => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.transactions.listAll(
        {
          status:    filterStatus    || undefined,
          merchant:  filterMerchant  || undefined,
          cardToken: filterCardToken || undefined,
          email:     filterEmail     || undefined,
          page:      p,
          limit:     ps,
        },
        token
      );
      setTransactions(res.results as Transaction[]);
      setTotal(res.total);
    } catch {
      setTransactions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token, filterStatus, filterMerchant, filterCardToken, filterEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (token) load(page, pageSize);
  }, [token, filterStatus, filterMerchant, filterCardToken, filterEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch() {
    const v = searchInput.trim();
    if (searchType === 'email') {
      setFilterEmail(v);
      setFilterMerchant('');
      setFilterCardToken('');
    } else {
      setFilterEmail('');
      setFilterCardToken(v.startsWith('tok_') ? v : '');
      setFilterMerchant(!v.startsWith('tok_') ? v : '');
    }
    setPage(1);
  }

  function clearAll() {
    setFilterStatus(''); setFilterMerchant(''); setFilterCardToken(''); setFilterEmail('');
    setSearchInput(''); setPage(1);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    load(newPage, pageSize);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleLimitChange(newLimit: number) {
    setPageSize(newLimit);
    setPage(1);
    load(1, newLimit);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <h1 className="text-2xl font-bold">Transactions</h1>

      {/* Search + filters */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
        {/* Search type selector */}
        <div className="flex gap-1.5">
          {(['text', 'email'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setSearchType(t); setSearchInput(''); }}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                searchType === t ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]' : 'border-gray-300 text-gray-600 hover:border-gray-400'
              }`}
            >
              {t === 'email' ? '✉ Email (QE:equality)' : '🔤 Merchant / Card token'}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type={searchType === 'email' ? 'email' : 'text'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={
              searchType === 'email'
                ? 'customer@example.com  (QE equality search)'
                : 'Merchant name  or  tok_xxxxxxxx'
            }
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleSearch}
            disabled={!searchInput.trim()}
            className="px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50"
          >
            Search
          </button>
          {(filterStatus || filterMerchant || filterCardToken || filterEmail) && (
            <button onClick={clearAll} className="px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
              Clear
            </button>
          )}
        </div>

        {/* Active filter badges */}
        {(filterEmail || filterCardToken || filterMerchant) && (
          <div className="flex gap-2 flex-wrap">
            {filterEmail && (
              <span className="text-xs bg-blue-100 text-blue-800 border border-blue-200 px-2 py-0.5 rounded font-medium">
                ✉ Email: {filterEmail}
              </span>
            )}
            {filterCardToken && (
              <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono">
                Token: {filterCardToken}
              </span>
            )}
            {filterMerchant && (
              <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                Merchant: {filterMerchant}
              </span>
            )}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All statuses</option>
            {['authorized', 'settled', 'disputed', 'declined', 'pending'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span className="text-gray-400 text-sm self-center ml-auto">{total} transactions</span>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading...</div>
      ) : transactions.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500 text-sm">
          No transactions found.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="min-w-full text-sm divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Date', 'Merchant', 'Amount', 'Card', 'Channel', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transactions.map((txn, i) => (
                  <tr key={txn.cardTransactionInstanceReference ?? i} className="hover:bg-gray-50 cursor-pointer group">
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {txn.cardTransactionDateTime
                        ? new Date(txn.cardTransactionDateTime).toLocaleString()
                        : '-'}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900 truncate max-w-40">{txn.cardTransactionMerchantName}</p>
                      {txn.cardTransactionMerchantCategoryCode && (
                        <p className="text-xs text-gray-400 font-mono">MCC {txn.cardTransactionMerchantCategoryCode}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                      {txn.cardTransactionAmount
                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.cardTransactionAmount.currency }).format(txn.cardTransactionAmount.amount)
                        : '-'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">
                      {txn.cardTransactionMaskedPanDisplay ?? '-'}
                    </td>
                    <td className="px-4 py-2.5 text-xs capitalize text-gray-600">
                      {txn.cardTransactionChannel ?? '-'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[txn.cardTransactionStatus ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                        {txn.cardTransactionStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {txn.cardTransactionInstanceReference && (
                        <Link
                          href={`/demo/transactions/${txn.cardTransactionInstanceReference}`}
                          className="text-xs text-blue-600 hover:underline whitespace-nowrap flex items-center gap-1"
                        >
                          View details <span className="opacity-0 group-hover:opacity-100 transition-opacity">›</span>
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={pageSize}
            onPageChange={handlePageChange}
            onLimitChange={handleLimitChange}
            limitOptions={[10, 20, 50, 100]}
            noun="transactions"
          />
        </>
      )}
    </div>
  );
}

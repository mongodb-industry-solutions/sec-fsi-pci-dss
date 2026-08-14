'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { Pagination } from '../../../components/Pagination';
import { Mail, Type, Search, X, Lock, CreditCard, ChevronRight } from 'lucide-react';
import { SectionHeader } from '../../../components/SectionHeader';
import { RequirePermission } from '../../../components/RequirePermission';
import { formatAmount } from '../../../lib/money';

// v36 (ADR-063): the collection returns normalized movement rows, so this list shows card payments,
// transfers and payment requests alike. L1 / L2 / auditor see every movement, each at their access level.
interface Movement {
  kind?: 'card' | 'transfer' | 'rtp';
  paymentExecutionInstanceReference?: string;
  direction?: 'sent' | 'received';
  grossAmount?: number;
  currency?: string;
  paymentExecutionStatus?: string;
  paymentExecutionRail?: string | null;
  concept?: string | null;
  beneficiaryName?: string | null;
  destinationAccountMasked?: string | null;
  merchantCategoryCode?: string | null;
  channel?: string | null;
  initiatedAt?: string | null;
  completedAt?: string | null;
  heldForReview?: boolean;
  fraudCase?: { created: boolean; status?: string | null; reference?: string | null };
}

const KIND_LABELS: Record<string, string> = { card: 'Card', transfer: 'Transfer', rtp: 'Request to Pay' };
const KIND_COLORS: Record<string, string> = {
  card:     'bg-[#001E2B] text-[#00ED64]',
  transfer: 'bg-blue-100 text-blue-800',
  rtp:      'bg-purple-100 text-purple-800',
};

const STATUS_COLORS: Record<string, string> = {
  authorized: 'bg-green-100 text-green-800',
  settled:    'bg-emerald-100 text-emerald-800 font-semibold',
  captured:   'bg-teal-100 text-teal-800',
  disputed:   'bg-red-100 text-red-800',
  declined:   'bg-red-100 text-red-800',
  pending:    'bg-amber-100 text-amber-800',
  voided:     'bg-gray-100 text-gray-500',
  refunded:   'bg-purple-100 text-purple-700',
  failed:     'bg-red-100 text-red-800',
  expired:    'bg-gray-100 text-gray-500',
};

const PAGE_SIZE = 10;

export default function TransactionsPage() {
  const router = useRouter();
  const [token, setToken] = useState('');

  useEffect(() => {
    const t = getToken() ?? '';
    const user = t ? decodeToken(t) : null;
    if (user?.role === 'customer') {
      router.replace('/system/payment/history');
      return;
    }
    setToken(t);
  }, [router]);

  const [transactions, setTransactions] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);

  const [filterStatus,    setFilterStatus]    = useState('');
  const [filterMerchant,  setFilterMerchant]  = useState('');
  const [filterCardToken, setFilterCardToken] = useState('');
  const [filterEmail,     setFilterEmail]     = useState('');
  const [filterTransactionId, setFilterTransactionId] = useState('');
  const [searchInput,     setSearchInput]     = useState('');
  const [searchType,      setSearchType]      = useState<'text' | 'email' | 'txnId'>('text');

  const load = useCallback(async (p: number, ps: number) => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.transactions.list(
        {
          // Every movement kind: this is the staff movement list, not a card-only view.
          status:    filterStatus    || undefined,
          merchant:  filterMerchant  || undefined,
          cardToken: filterCardToken || undefined,
          email:     filterEmail     || undefined,
          transactionId: filterTransactionId || undefined,
          page:      p,
          limit:     ps,
        },
        token
      );
      setTransactions(res.results as Movement[]);
      setTotal(res.total);
    } catch {
      setTransactions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token, filterStatus, filterMerchant, filterCardToken, filterEmail, filterTransactionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (token) load(page, pageSize);
  }, [token, filterStatus, filterMerchant, filterCardToken, filterEmail, filterTransactionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-linkable filters: prefill from ?status=&email=&cardToken=&merchant= once after mount.
  // Read window.location.search inside the effect so it works with Next client navigation too.
  const [autoApplied, setAutoApplied] = useState(false);
  useEffect(() => {
    if (autoApplied || !token || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const status = sp.get('status');
    const email = sp.get('email');
    const cardToken = sp.get('cardToken');
    const merchant = sp.get('merchant');
    if (status) setFilterStatus(status);
    if (email) { setSearchType('email'); setSearchInput(email); setFilterEmail(email); }
    else if (cardToken) { setSearchType('text'); setSearchInput(cardToken); setFilterCardToken(cardToken); }
    else if (merchant) { setSearchType('text'); setSearchInput(merchant); setFilterMerchant(merchant); }
    setAutoApplied(true);
  }, [token, autoApplied]);

  function handleSearch() {
    const v = searchInput.trim();
    if (searchType === 'email') {
      setFilterEmail(v);
      setFilterMerchant('');
      setFilterCardToken('');
      setFilterTransactionId('');
    } else if (searchType === 'txnId') {
      setFilterTransactionId(v);
      setFilterEmail('');
      setFilterMerchant('');
      setFilterCardToken('');
    } else {
      setFilterEmail('');
      setFilterTransactionId('');
      setFilterCardToken(v.startsWith('pm_') ? v : '');
      setFilterMerchant(!v.startsWith('pm_') ? v : '');
    }
    setPage(1);
  }

  function clearAll() {
    setFilterStatus(''); setFilterMerchant(''); setFilterCardToken(''); setFilterEmail(''); setFilterTransactionId('');
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
    <RequirePermission resource="transactions" action="view">
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={CreditCard}
        title="Transactions"
        description="Search and review card transactions."
        debugInfo="Card Transaction · PCI DSS · QE:none fields decrypt only for L2/auditor"
      />

      {/* Search + filters */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
        {/* Search type selector */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => { setSearchType('text'); setSearchInput(''); }}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              searchType === 'text' ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]' : 'border-gray-300 text-gray-600 hover:border-gray-400'
            }`}
          >
            <Type size={12} />
            Merchant / Card token
          </button>
          <button
            onClick={() => { setSearchType('email'); setSearchInput(''); }}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              searchType === 'email' ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]' : 'border-gray-300 text-gray-600 hover:border-gray-400'
            }`}
          >
            <Mail size={12} />
            <span>Email</span>
            <span className="inline-flex items-center gap-0.5 bg-blue-100 text-blue-700 border border-blue-200 px-1 py-0 rounded font-mono text-xs">
              <Lock size={9} />QE
            </span>
          </button>
          <button
            onClick={() => { setSearchType('txnId'); setSearchInput(''); }}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              searchType === 'txnId' ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]' : 'border-gray-300 text-gray-600 hover:border-gray-400'
            }`}
          >
            <CreditCard size={12} />
            Transaction ID
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type={searchType === 'email' ? 'email' : 'text'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={
              searchType === 'email'
                ? 'customer@example.com'
                : searchType === 'txnId'
                  ? 'Card Transaction Instance Reference (UUID)'
                  : 'Merchant name  or  pm_xxxxxxxx'
            }
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleSearch}
            disabled={!searchInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50"
          >
            <Search size={14} />
            <span className="hidden sm:inline">Search</span>
          </button>
          {(filterStatus || filterMerchant || filterCardToken || filterEmail || filterTransactionId) && (
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50"
            >
              <X size={14} />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>

        {/* Active filter badges */}
        {(filterEmail || filterCardToken || filterMerchant) && (
          <div className="flex gap-2 flex-wrap">
            {filterEmail && (
              <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 border border-blue-200 px-2 py-0.5 rounded font-medium">
                <Mail size={11} /> {filterEmail}
              </span>
            )}
            {filterCardToken && (
              <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono">
                Token: {filterCardToken}
              </span>
            )}
            {filterMerchant && (
              <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                <Type size={11} /> {filterMerchant}
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
                  {['Date', 'Type', 'Counterparty', 'Amount', 'Card / destination', 'Channel / rail', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transactions.map((m, i) => {
                  const at = m.completedAt ?? m.initiatedAt;
                  const kind = m.kind ?? 'card';
                  return (
                  <tr key={m.paymentExecutionInstanceReference ?? i} className="hover:bg-gray-50 cursor-pointer group">
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {at ? new Date(at).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${KIND_COLORS[kind] ?? 'bg-gray-100 text-gray-700'}`}>
                        {KIND_LABELS[kind] ?? kind}
                      </span>
                      {m.direction === 'received' && <span className="ml-1 text-xs text-gray-400">in</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900 truncate max-w-40">{m.beneficiaryName ?? m.concept ?? '-'}</p>
                      {m.merchantCategoryCode && (
                        <p className="text-xs text-gray-400 font-mono">MCC {m.merchantCategoryCode}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                      {m.grossAmount != null && m.currency
                        ? formatAmount(m.grossAmount, m.currency)
                        : '-'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">
                      {m.destinationAccountMasked ?? '-'}
                    </td>
                    <td className="px-4 py-2.5 text-xs capitalize text-gray-600">
                      {m.channel ?? m.paymentExecutionRail ?? '-'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[m.paymentExecutionStatus ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                        {m.paymentExecutionStatus}
                      </span>
                      {m.heldForReview && (
                        <span className="ml-1 text-xs px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-800" title="Funds held, not delivered">
                          held
                        </span>
                      )}
                      {m.fraudCase?.created && (
                        <span className="ml-1 text-xs px-2 py-0.5 rounded font-medium bg-red-50 text-red-700" title={`Case ${m.fraudCase.reference ?? ''}`}>
                          case
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {m.paymentExecutionInstanceReference && (
                        <Link
                          href={`/system/transactions/${m.paymentExecutionInstanceReference}`}
                          className="text-xs text-blue-600 hover:underline whitespace-nowrap flex items-center gap-1"
                        >
                          View details <ChevronRight size={13} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      )}
                    </td>
                  </tr>
                  );
                })}
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
    </RequirePermission>
  );
}

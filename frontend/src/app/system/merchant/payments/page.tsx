'use client';
import { useCallback, useEffect, useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { api } from '../../../../lib/api';
import { Pagination } from '../../../../components/Pagination';

interface Sale {
  cardTransactionInstanceReference: string;
  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionDateTime: string;
  cardTransactionStatus: string;
  cardTransactionType?: string;
  cardTransactionChannel?: string;
  cardTransactionMaskedPanDisplay: string;
  cardTransactionDescription?: string;
}

const STATUSES = ['authorized', 'settled', 'pending', 'declined', 'disputed'];

function statusClass(s: string) {
  if (s === 'authorized' || s === 'settled') return 'bg-green-100 text-green-700';
  if (s === 'disputed') return 'bg-red-100 text-red-700';
  if (s === 'declined') return 'bg-gray-200 text-gray-600';
  return 'bg-amber-100 text-amber-700';
}

export default function PaymentsSectionPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async (targetPage: number) => {
    if (!merchantId) return;
    setLoading(true);
    try {
      const res = await api.merchants.transactions(
        merchantId,
        { page: targetPage, limit: pageSize, status: status || undefined, search: search || undefined },
        token,
      );
      setSales(res.results);
      setTotal(res.total);
    } catch { setSales([]); setTotal(0); }
    setLoading(false);
  }, [merchantId, token, pageSize, status, search]);

  useEffect(() => { setPage(1); load(1); }, [load]);

  if (!merchant) return null;

  function onSearch(e: React.FormEvent) { e.preventDefault(); setSearch(searchInput.trim()); }
  function onPage(p: number) { setPage(p); load(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Payments Received</h1>
        <p className="text-sm text-gray-500 mt-0.5">Card payments settled to {merchant.merchantName}. BIAN SD-89 (acquiring view).</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-start gap-2">
        <ShieldCheck size={14} className="text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700">
          Data minimization (PCI DSS Req 3 &amp; 7): only the masked PAN and acquiring details are shown. The payer&apos;s account, email and gateway payload are never exposed.
        </p>
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap gap-3 items-end">
        <form onSubmit={onSearch} className="flex-1 min-w-[220px]">
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Masked PAN, descriptor…"
              className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </form>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={onSearch} className="bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors">
          Apply
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading...</div>
        ) : sales.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No payments match the current filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-2">Date</th>
                <th className="text-left font-medium px-4 py-2">Card</th>
                <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Description</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-right font-medium px-4 py-2">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sales.map((s) => (
                <tr key={s.cardTransactionInstanceReference} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{new Date(s.cardTransactionDateTime).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{s.cardTransactionMaskedPanDisplay}</td>
                  <td className="px-4 py-2.5 text-gray-600 hidden sm:table-cell truncate max-w-[220px]">{s.cardTransactionDescription ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusClass(s.cardTransactionStatus)}`}>{s.cardTransactionStatus}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: s.cardTransactionAmount.currency }).format(s.cardTransactionAmount.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={pageSize}
        onPageChange={onPage}
        onLimitChange={(l) => { setPageSize(l); setPage(1); }}
        limitOptions={[10, 20, 50]}
        noun="payments"
      />
    </div>
  );
}

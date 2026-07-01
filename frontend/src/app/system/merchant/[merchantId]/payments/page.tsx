'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, ShieldCheck, Receipt, X, ChevronRight } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { useRequireActiveMerchant } from '../../../../../lib/merchantContext';
import { useDebugMode } from '../../../../../lib/debugMode';
import { api } from '../../../../../lib/api';
import { Pagination } from '../../../../../components/Pagination';

interface Sale {
  cardTransactionInstanceReference: string;
  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionDateTime: string;
  cardTransactionStatus: string;
  cardTransactionType?: string;
  cardTransactionChannel?: string;
  cardTransactionMaskedPanDisplay: string;
  cardTransactionDescription?: string;
  paymentCardReference?: string;
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
  const { debugMode } = useDebugMode();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [txnIdInput, setTxnIdInput] = useState('');
  const [txnId, setTxnId] = useState('');
  const [cardTokenInput, setCardTokenInput] = useState('');
  const [cardToken, setCardToken] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilters = !!(status || search || txnId || cardToken || dateFrom || dateTo);

  const load = useCallback(async (targetPage: number, targetLimit: number) => {
    if (!merchantId) return;
    setLoading(true);
    try {
      const res = await api.merchants.transactions(
        merchantId,
        {
          page: targetPage,
          limit: targetLimit,
          status: status || undefined,
          search: search || undefined,
          txnId: txnId || undefined,
          cardToken: cardToken || undefined,
          dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
          dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
        },
        token,
      );
      setSales(res.results);
      setTotal(res.total);
    } catch { setSales([]); setTotal(0); }
    setLoading(false);
  }, [merchantId, token, status, search, txnId, cardToken, dateFrom, dateTo]);

  useEffect(() => { setPage(1); load(1, pageSize); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const [autoApplied, setAutoApplied] = useState(false);
  useEffect(() => {
    if (autoApplied || !merchantId || typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('status')) setStatus(sp.get('status')!);
    if (sp.get('q')) { setSearchInput(sp.get('q')!); setSearch(sp.get('q')!); }
    if (sp.get('txnId')) { setTxnIdInput(sp.get('txnId')!); setTxnId(sp.get('txnId')!); }
    if (sp.get('cardToken')) { setCardTokenInput(sp.get('cardToken')!); setCardToken(sp.get('cardToken')!); }
    if (sp.get('dateFrom')) setDateFrom(sp.get('dateFrom')!);
    if (sp.get('dateTo')) setDateTo(sp.get('dateTo')!);
    setAutoApplied(true);
  }, [merchantId, autoApplied]);

  if (!merchant) return null;

  function onSearch(e: React.FormEvent) { e.preventDefault(); setSearch(searchInput.trim()); setTxnId(txnIdInput.trim()); setCardToken(cardTokenInput.trim()); }
  function handlePageChange(p: number) { setPage(p); load(p, pageSize); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function handleLimitChange(l: number) { setPageSize(l); setPage(1); load(1, l); }
  function clearAll() {
    setStatus(''); setSearchInput(''); setSearch('');
    setTxnIdInput(''); setTxnId(''); setCardTokenInput(''); setCardToken('');
    setDateFrom(''); setDateTo(''); setPage(1);
  }

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={Receipt}
        title="Transactions"
        description={`All card transactions involving ${merchant.merchantName}.`}
        debugInfo="BIAN SD-89 acquiring view · PCI DSS Req 3 & 7 (masked PAN only, no payer PII)"
      />

      {debugMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-start gap-2">
          <ShieldCheck size={14} className="text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700">
            Data minimization (PCI DSS Req 3 &amp; 7): only the masked PAN and acquiring details are shown. The payer&apos;s account, email and gateway payload are never exposed.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <form onSubmit={onSearch} className="flex-1 min-w-[200px]">
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
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={onSearch} className="bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors">
            Apply
          </button>
          {hasActiveFilters && (
            <button onClick={clearAll} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
              <X size={14} /> Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[160px]">
            <label className="block text-xs text-gray-500 mb-1">Transaction ID</label>
            <input value={txnIdInput} onChange={(e) => setTxnIdInput(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === 'Enter') { setTxnId(txnIdInput.trim()); setPage(1); } }}
              placeholder="UUID…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div className="min-w-[160px]">
            <label className="block text-xs text-gray-500 mb-1">Card Token</label>
            <input value={cardTokenInput} onChange={(e) => setCardTokenInput(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === 'Enter') { setCardToken(cardTokenInput.trim()); setPage(1); } }}
              placeholder="tok_xxxxxxxx"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="datetime-local" value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="datetime-local" value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </div>

        {/* Active filter badges */}
        {hasActiveFilters && (
          <div className="flex gap-2 flex-wrap pt-1">
            {status && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">Status: {status}</span>}
            {search && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">Search: {search}</span>}
            {txnId && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono">TxnID: {txnId.slice(0, 12)}…</span>}
            {cardToken && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono">Token: {cardToken}</span>}
            {dateFrom && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">From: {dateFrom}</span>}
            {dateTo && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">To: {dateTo}</span>}
            <span className="text-xs text-gray-400 self-center ml-auto">{total} transaction{total !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading...</div>
        ) : sales.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No transactions match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-2">Date &amp; Time</th>
                <th className="text-left font-medium px-4 py-2">Card</th>
                <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Type</th>
                <th className="text-left font-medium px-4 py-2 hidden lg:table-cell">Channel</th>
                <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Description</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-right font-medium px-4 py-2">Amount</th>
                <th className="text-left font-medium px-4 py-2 w-[1%]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sales.map((s) => {
                const dt = new Date(s.cardTransactionDateTime);
                return (
                <tr key={s.cardTransactionInstanceReference} className="hover:bg-gray-50 group">
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    <span>{dt.toLocaleDateString()}</span>
                    <span className="text-gray-400 ml-1 text-xs">{dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{s.cardTransactionMaskedPanDisplay}</td>
                  <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell capitalize">{s.cardTransactionType ?? '-'}</td>
                  <td className="px-4 py-2.5 text-gray-600 hidden lg:table-cell capitalize">{s.cardTransactionChannel ?? '-'}</td>
                  <td className="px-4 py-2.5 text-gray-600 hidden sm:table-cell truncate max-w-[220px]">{s.cardTransactionDescription ?? '-'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusClass(s.cardTransactionStatus)}`}>{s.cardTransactionStatus}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: s.cardTransactionAmount.currency }).format(s.cardTransactionAmount.amount)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/system/merchant/${merchantId}/payments/${s.cardTransactionInstanceReference}`}
                      className="text-xs text-blue-600 hover:underline whitespace-nowrap flex items-center gap-1"
                    >
                      Details <ChevronRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
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
    </div>
  );
}

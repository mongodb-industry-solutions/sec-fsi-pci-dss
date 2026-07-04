'use client';
import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, Trash2, Link2, Search } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Pagination } from '../../../../../components/Pagination';
import { useRequireActiveMerchant } from '../../../../../lib/merchantContext';
import { api } from '../../../../../lib/api';

interface PaymentLink {
  paymentLinkInstanceReference: string;
  paymentLinkCode: string;
  paymentLinkAmount: number;
  paymentLinkCurrency: string;
  paymentLinkDescription: string;
  paymentLinkStatus: string;
  paymentLinkUsageType: string;
  paymentLinkCurrentUses: number;
}

export default function LinksSectionPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [amount, setAmount] = useState('49.99');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('Consulting Session');
  const [message, setMessage] = useState('');
  const [usageType, setUsageType] = useState<'single_use' | 'multi_use'>('single_use');
  const [result, setResult] = useState<{ paymentUrl: string; paymentLinkCode: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadLinks = useCallback(async () => {
    if (!merchantId) return;
    setLoadingLinks(true);
    try {
      const res = await api.paymentLinks.list(merchantId, token);
      setLinks(res.results as unknown as PaymentLink[]);
    } catch { setLinks([]); }
    setLoadingLinks(false);
  }, [merchantId, token]);

  useEffect(() => { if (merchantId) loadLinks(); }, [merchantId, loadLinks]);

  if (!merchant) return null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await api.paymentLinks.create({
        merchantAgreementInstanceReference: merchantId,
        amount: parseFloat(amount), currency, description,
        customerMessage: message || undefined, usageType,
      }, token);
      setResult(res);
      loadLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link.');
    }
    setLoading(false);
  }

  async function deactivate(id: string) {
    try { await api.paymentLinks.deactivate(id, merchantId, token); loadLinks(); } catch {}
  }

  const q = search.trim().toLowerCase();
  const filtered = links.filter((link) => {
    if (statusFilter === 'active' && link.paymentLinkStatus !== 'active') return false;
    if (statusFilter === 'completed' && link.paymentLinkStatus !== 'completed') return false;
    if (statusFilter === 'inactive' && (link.paymentLinkStatus === 'active' || link.paymentLinkStatus === 'completed')) return false;
    if (q && !(link.paymentLinkCode.toLowerCase().includes(q) || (link.paymentLinkDescription ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
  const activeCount = links.filter((l) => l.paymentLinkStatus === 'active').length;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={Link2}
        title="Payment Links"
        description="Create a shareable payment link."
        debugInfo="BIAN SD-64 Payment Order · PCI DSS Req 3 (PAN captured on the hosted page)"
      />

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <form onSubmit={create} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount</label>
              <input required type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                {(merchant.merchantAllowedCurrencies ?? ['USD', 'EUR', 'GBP']).map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description</label>
            <input required type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Customer Message (optional)</label>
            <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message shown to buyer"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Usage Type</label>
            <select value={usageType} onChange={(e) => setUsageType(e.target.value as 'single_use' | 'multi_use')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
              <option value="single_use">Single Use (invoice / one-time)</option>
              <option value="multi_use">Multi Use (store / recurring)</option>
            </select>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <button type="submit" disabled={loading}
            className="w-full bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
            {loading ? 'Creating...' : 'Create Payment Link'}
          </button>
        </form>

        {result && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <div className="text-sm font-medium text-green-800">Payment link created. Share this URL:</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-xs text-green-700 bg-white border border-green-200 rounded px-2 py-1.5 truncate">{result.paymentUrl}</div>
              <button onClick={() => { navigator.clipboard.writeText(result.paymentUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="shrink-0 p-1.5 rounded hover:bg-green-100">
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
              </button>
              <a href={result.paymentUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1.5 rounded hover:bg-green-100">
                <ExternalLink size={14} className="text-green-600" />
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="font-medium text-gray-800 text-sm">
            Payment links <span className="text-gray-400 font-normal">({activeCount} active of {links.length})</span>
          </h3>
          <button onClick={loadLinks} className="text-xs text-[#001E2B] font-medium hover:underline">Refresh</button>
        </div>

        {/* Filter + search */}
        <div className="flex flex-wrap gap-2 items-center px-5 py-3 border-b border-gray-100 bg-gray-50/60">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by code or description…"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as 'all' | 'active' | 'completed' | 'inactive'); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {loadingLinks ? (
          <div className="px-5 py-6 text-center text-sm text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-gray-400">{links.length === 0 ? 'No payment links yet.' : 'No links match the current filters.'}</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {paginated.map((link) => (
              <li key={link.paymentLinkInstanceReference} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-600">{link.paymentLinkCode}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      link.paymentLinkStatus === 'active' ? 'bg-green-100 text-green-700' :
                      link.paymentLinkStatus === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>{link.paymentLinkStatus}</span>
                    <span className="text-xs text-gray-400">{link.paymentLinkUsageType}</span>
                  </div>
                  <div className="text-sm text-gray-700 mt-0.5 truncate">{link.paymentLinkDescription}</div>
                  <div className="text-xs text-gray-400">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: link.paymentLinkCurrency }).format(link.paymentLinkAmount)}
                    {' · '}{link.paymentLinkCurrentUses} use{link.paymentLinkCurrentUses !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a href={`/gateway/pay/${link.paymentLinkCode}`} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700">
                    <ExternalLink size={13} />
                  </a>
                  {link.paymentLinkStatus === 'active' && (
                    <button onClick={() => deactivate(link.paymentLinkInstanceReference)}
                      className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loadingLinks && filtered.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-100">
            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={filtered.length}
              limit={pageSize}
              onPageChange={setPage}
              onLimitChange={(l) => { setPageSize(l); setPage(1); }}
              limitOptions={[10, 20, 50]}
              noun="links"
            />
          </div>
        )}
      </div>
    </div>
  );
}

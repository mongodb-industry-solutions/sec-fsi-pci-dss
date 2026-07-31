'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Plus, Search, Star } from 'lucide-react';
import { api } from '../lib/api';
import { useDebugMode } from '../lib/debugMode';
import { Pagination } from './Pagination';
import { DebugChip } from './DebugChip';

// Customer-managed stored cards (BIAN SD-88): searchable / filterable / paginated list. Only the
// masked PAN, network, status, alias and registration date are shown here; the full PAN and CVV
// are never stored. Ownership is enforced by the backend. Clicking a row opens the card detail.
interface CardRow {
  paymentCardInstanceReference: string;
  paymentCardMaskedPanDisplay: string;
  paymentCardNetwork: string;
  paymentCardStatus: string;
  paymentCardIsPreferred?: boolean;
  paymentCardAlias?: string;
  recordCreatedDateTime?: string;
}

const NETWORKS = ['VISA', 'MASTERCARD', 'AMEX', 'ELO'];
const STATUSES = ['active', 'expired', 'blocked', 'suspended', 'pending_activation'];

function statusClass(status: string): string {
  switch (status) {
    case 'active':  return 'bg-green-100 text-green-700';
    case 'expired': return 'bg-amber-100 text-amber-700';
    case 'blocked':
    case 'suspended': return 'bg-red-100 text-red-700';
    default:        return 'bg-gray-100 text-gray-500';
  }
}

function fmtDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function SavedCardsPanel({ agreementId, token }: { agreementId: string | null; token: string }) {
  const router = useRouter();
  const { debugMode } = useDebugMode();
  const [cards, setCards] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter / search / pagination state
  const [search, setSearch] = useState('');
  const [network, setNetwork] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(6);

  const loadCards = useCallback(async () => {
    if (!agreementId || !token) { setLoading(false); return; }
    setLoading(true);
    try { setCards(((await api.customer.getCards(agreementId, token)).results ?? []) as unknown as CardRow[]); }
    catch { setCards([]); }
    finally { setLoading(false); }
  }, [agreementId, token]);

  useEffect(() => { loadCards(); }, [loadCards]);

  // Client-side filtering; a customer has only a handful of cards, so the full list is returned
  // once and filtered/paginated in the browser (no extra round-trips).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (network && c.paymentCardNetwork !== network) return false;
      if (status && c.paymentCardStatus !== status) return false;
      if (q) {
        const hay = `${c.paymentCardMaskedPanDisplay} ${c.paymentCardAlias ?? ''} ${c.paymentCardNetwork}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, search, network, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const pageClamped = Math.min(page, totalPages);
  const pageItems = filtered.slice((pageClamped - 1) * limit, pageClamped * limit);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => { setPage(1); }, [search, network, status, limit]);

  const hasFilters = !!(search || network || status);

  return (
    <div className="bg-white rounded-xl border p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-gray-500 shrink-0" />
          <h2 className="font-semibold text-gray-800 text-sm">Saved Payment Methods</h2>
          {!loading && <span className="text-xs text-gray-400">({filtered.length})</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {debugMode && (
            <DebugChip label="SD-88 · paymentCardManagement · PCI Req 3.4" />
          )}
          <button
            onClick={() => router.push('/system/cards/new')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors"
          >
            <Plus size={13} /> Add a card
          </button>
        </div>
      </div>

      {/* Filter / search toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by nickname or last 4 digits…"
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20"
          />
        </div>
        <select value={network} onChange={(e) => setNetwork(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20">
          <option value="">All networks</option>
          {NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading cards…</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-gray-400">No saved cards. A card is saved when you opt in during a payment.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400">No cards match {hasFilters ? 'these filters' : 'your search'}.</p>
      ) : (
        <div className="space-y-2">
          {pageItems.map((card) => {
            const cardId = card.paymentCardInstanceReference;
            return (
              <button
                key={cardId}
                onClick={() => router.push(`/system/cards/${cardId}`)}
                className="w-full flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg border border-gray-100 bg-gray-50 hover:border-gray-300 hover:bg-white text-left transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <CreditCard size={18} className="text-gray-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {card.paymentCardAlias || card.paymentCardNetwork || 'Card'}
                      </span>
                      {card.paymentCardIsPreferred && (
                        <span title="Default card" className="inline-flex items-center gap-0.5 text-xs text-amber-500">
                          <Star size={11} className="fill-amber-400 text-amber-400" />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 flex items-center gap-2">
                      <span className="font-mono">{card.paymentCardMaskedPanDisplay}</span>
                      {card.paymentCardNetwork && <><span>·</span><span>{card.paymentCardNetwork}</span></>}
                      <span className="hidden sm:inline">·</span>
                      <span className="hidden sm:inline">Added {fmtDate(card.recordCreatedDateTime)}</span>
                    </div>
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${statusClass(card.paymentCardStatus)}`}>
                  {card.paymentCardStatus}
                </span>
              </button>
            );
          })}

          <Pagination
            page={pageClamped}
            totalPages={totalPages}
            total={filtered.length}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={setLimit}
            limitOptions={[6, 12, 24]}
            noun="cards"
          />
        </div>
      )}

      <p className="text-xs text-gray-400">
        Only the masked card number is shown. The full card number and CVV are never stored
        {debugMode ? ' (PCI DSS Req 3.2 / 3.4; token is a surrogate, expiry is QE:none).' : '.'}
      </p>
    </div>
  );
}

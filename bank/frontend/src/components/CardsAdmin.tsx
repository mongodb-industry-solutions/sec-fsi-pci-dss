'use client';
import { useCallback, useEffect, useState } from 'react';
import { CreditCard, RefreshCw } from 'lucide-react';
import { FilterBar, Pager, StatusBadge, StatusSummary, type FilterSpec } from './DataTable';
import { BankError, Empty } from './States';

// The cards this bank issued: list, filter, search, page, and act.
//
// It is the issuer's own estate, so the actions are the issuer's own lifecycle rather than a generic CRUD:
// `issued → active` is the approval, a suspension is reversible, and a revocation is not. The number is never
// here and never fetched: what a screen needs is the masked display, and the exact-number lookup is a
// separate, audited disclosure on the card surface.

interface Card {
  cardToken: string;
  network: string;
  bin: string;
  lastFour: string;
  maskedDisplay: string;
  status: string;
  expiryMonth?: string;
  expiryYear?: string;
  limits?: { perTransactionAmount?: number; limitCurrency?: string };
}

const FILTERS: FilterSpec[] = [
  { key: 'network', label: 'Network', options: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'] },
  { key: 'last4', label: 'Last 4', placeholder: '4242' },
  { key: 'bin', label: 'BIN', placeholder: '453210' },
];

// What each status may become. Mirrors the bank's own state machine, so the screen offers only moves the
// server will accept: a button that reliably fails teaches an operator to distrust the screen.
const NEXT: Record<string, string[]> = {
  issued: ['active', 'revoked'],
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  revoked: [],
};

export function CardsAdmin() {
  const [rows, setRows] = useState<Card[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search.trim()) params.set('q', search.trim());
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);

    try {
      const response = await fetch(`/api/admin/cards?${params.toString()}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body as { error?: string })?.error ?? `the bank answered ${response.status}`);
      setRows((body.results ?? []) as Card[]);
      setTotal(body.total ?? 0);
      setByStatus(body.byStatus ?? {});
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters]);

  // Debounced, so typing a search does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function act(card: Card, status: string) {
    setBusy(card.cardToken);
    try {
      const response = await fetch(`/api/admin/cards/${encodeURIComponent(card.cardToken)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body as { error?: string })?.error ?? `the bank answered ${response.status}`);
      setError(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function setFilter(key: string, value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-4">
      <StatusSummary
        counts={byStatus}
        active={filters.status ?? ''}
        onPick={(status) => setFilter('status', status)}
      />

      <FilterBar
        filters={FILTERS}
        values={filters}
        onChange={setFilter}
        onSearch={(value) => { setPage(1); setSearch(value); }}
        searchValue={search}
        searchHint="Token, last four, BIN or holder reference"
        total={total}
      />

      {error && <BankError message={error} />}
      {loading && rows.length === 0 && <p className="text-sm text-ink-soft">Loading…</p>}
      {!loading && !error && rows.length === 0 && <Empty>No card matches those filters.</Empty>}

      {rows.length > 0 && (
        <>
          {/* Cards on a phone, table from `md`: eight columns of card data at 380px is unreadable. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((card) => (
              <li key={card.cardToken} className="space-y-3 rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm">{card.maskedDisplay}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-soft">{card.cardToken}</p>
                  </div>
                  <StatusBadge status={card.status} />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-ink-soft">Network</dt><dd>{card.network}</dd></div>
                  <div><dt className="text-ink-soft">BIN</dt><dd>{card.bin}</dd></div>
                  <div><dt className="text-ink-soft">Expiry</dt><dd>{card.expiryMonth ? `${card.expiryMonth}/${card.expiryYear}` : '—'}</dd></div>
                  <div>
                    <dt className="text-ink-soft">Limit</dt>
                    <dd>{card.limits?.perTransactionAmount ?? '—'}</dd>
                  </div>
                </dl>
                <Actions card={card} busy={busy === card.cardToken} onAct={act} />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
            <table className="min-w-full text-xs">
              <thead className="bg-surface-alt">
                <tr>
                  {['Card', 'Token', 'Network', 'BIN', 'Expiry', 'Limit', 'Status', ''].map((head) => (
                    <th key={head} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-ink-soft">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((card) => (
                  <tr key={card.cardToken} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{card.maskedDisplay}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2 text-ink-soft" title={card.cardToken}>{card.cardToken}</td>
                    <td className="whitespace-nowrap px-3 py-2">{card.network}</td>
                    <td className="whitespace-nowrap px-3 py-2">{card.bin}</td>
                    <td className="whitespace-nowrap px-3 py-2">{card.expiryMonth ? `${card.expiryMonth}/${card.expiryYear}` : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{card.limits?.perTransactionAmount ?? '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={card.status} /></td>
                    <td className="px-3 py-2"><Actions card={card} busy={busy === card.cardToken} onAct={act} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager page={page} limit={limit} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function Actions({ card, busy, onAct }: { card: Card; busy: boolean; onAct: (card: Card, status: string) => void }) {
  const next = NEXT[card.status] ?? [];
  if (next.length === 0) {
    // Revoked is terminal, and the screen says so rather than offering a move that would be refused.
    return <span className="text-[11px] text-ink-soft">terminal</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {next.map((status) => (
        <button
          key={status}
          type="button"
          disabled={busy}
          onClick={() => onAct(card, status)}
          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] transition hover:border-accent disabled:opacity-40"
        >
          {busy && <RefreshCw size={11} className="animate-spin" aria-hidden />}
          {status === 'active' && card.status === 'issued' ? 'approve' : status}
        </button>
      ))}
    </div>
  );
}

export const CardsIcon = CreditCard;

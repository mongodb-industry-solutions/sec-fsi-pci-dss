'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { FilterBar, Pager, StatusBadge, StatusSummary, type FilterSpec } from './DataTable';
import { BankError, Empty } from './States';

// The accounts this bank holds: list, filter, search, page, and act.
//
// The search deserves a note, because what it can honestly offer is decided by the encryption. The IBAN is
// encrypted with an equality index, so an EXACT IBAN is findable and a partial one is not; the holder's name
// has no query index and is not searchable at all. So the free text runs over the masked IBAN, the alias, the
// BIC and the references, and the placeholder says so rather than inviting a search that would match nothing.

interface Account {
  accountArrangementInstanceReference: string;
  accountHolderInstanceReference: string;
  accountHolderName?: string;
  accountKind: string;
  accountStatus: string;
  accountAlias?: string;
  accountCurrency: string;
  accountMaskedIban: string;
  accountBic: string;
  availableAmount: number;
  reservedAmount: number;
}

const FILTERS: FilterSpec[] = [
  { key: 'kind', label: 'Kind', options: ['current', 'savings'] },
  { key: 'currency', label: 'Currency', placeholder: 'EUR' },
];

// The bank's own transitions. `closed` is terminal, so one reference never means two relationships.
const NEXT: Record<string, string[]> = {
  pending_approval: ['active', 'closed'],
  active: ['blocked', 'closed'],
  blocked: ['active', 'closed'],
  closed: [],
};

export function AccountsAdmin() {
  const [rows, setRows] = useState<Account[]>([]);
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
      const response = await fetch(`/api/admin/accounts?${params.toString()}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body as { error?: string })?.error ?? `the bank answered ${response.status}`);
      setRows((body.results ?? []) as Account[]);
      setTotal(body.total ?? 0);
      setByStatus(body.byStatus ?? {});
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function act(account: Account, status: string) {
    setBusy(account.accountArrangementInstanceReference);
    try {
      const response = await fetch(
        `/api/admin/accounts/${encodeURIComponent(account.accountArrangementInstanceReference)}/status`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) },
      );
      const body = await response.json().catch(() => null);
      // A refused close carries the balance that blocks it, which is the one thing the operator needs.
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

  const money = (amount: number, currency: string) => `${amount.toFixed(2)} ${currency}`;

  return (
    <div className="space-y-4">
      <StatusSummary counts={byStatus} active={filters.status ?? ''} onPick={(status) => setFilter('status', status)} />

      <FilterBar
        filters={FILTERS}
        values={filters}
        onChange={setFilter}
        onSearch={(value) => { setPage(1); setSearch(value); }}
        searchValue={search}
        searchHint="Masked IBAN, alias, BIC, reference, or a full IBAN"
        total={total}
      />

      {error && <BankError message={error} />}
      {loading && rows.length === 0 && <p className="text-sm text-ink-soft">Loading…</p>}
      {!loading && !error && rows.length === 0 && <Empty>No account matches those filters.</Empty>}

      {rows.length > 0 && (
        <>
          <ul className="space-y-3 md:hidden">
            {rows.map((account) => (
              <li key={account.accountArrangementInstanceReference} className="space-y-3 rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm">{account.accountMaskedIban}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-soft">
                      {account.accountHolderName ?? account.accountHolderInstanceReference}
                    </p>
                  </div>
                  <StatusBadge status={account.accountStatus} />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-ink-soft">Kind</dt><dd>{account.accountKind}</dd></div>
                  <div><dt className="text-ink-soft">Alias</dt><dd className="truncate">{account.accountAlias ?? '—'}</dd></div>
                  <div><dt className="text-ink-soft">Available</dt><dd>{money(account.availableAmount, account.accountCurrency)}</dd></div>
                  <div><dt className="text-ink-soft">Reserved</dt><dd>{money(account.reservedAmount, account.accountCurrency)}</dd></div>
                </dl>
                <Actions account={account} busy={busy === account.accountArrangementInstanceReference} onAct={act} />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
            <table className="min-w-full text-xs">
              <thead className="bg-surface-alt">
                <tr>
                  {['Account', 'Holder', 'Kind', 'Available', 'Reserved', 'Status', ''].map((head) => (
                    <th key={head} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-ink-soft">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => (
                  <tr key={account.accountArrangementInstanceReference} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{account.accountMaskedIban}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2">
                      {account.accountHolderName ?? account.accountHolderInstanceReference}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{account.accountKind}</td>
                    <td className="whitespace-nowrap px-3 py-2">{money(account.availableAmount, account.accountCurrency)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{money(account.reservedAmount, account.accountCurrency)}</td>
                    <td className="px-3 py-2"><StatusBadge status={account.accountStatus} /></td>
                    <td className="px-3 py-2">
                      <Actions account={account} busy={busy === account.accountArrangementInstanceReference} onAct={act} />
                    </td>
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

function Actions({ account, busy, onAct }: {
  account: Account;
  busy: boolean;
  onAct: (account: Account, status: string) => void;
}) {
  const next = NEXT[account.accountStatus] ?? [];
  if (next.length === 0) return <span className="text-[11px] text-ink-soft">terminal</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {next.map((status) => (
        <button
          key={status}
          type="button"
          disabled={busy}
          onClick={() => onAct(account, status)}
          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] transition hover:border-accent disabled:opacity-40"
        >
          {busy && <RefreshCw size={11} className="animate-spin" aria-hidden />}
          {status === 'active' && account.accountStatus === 'pending_approval' ? 'approve' : status}
        </button>
      ))}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { admin, AdminError, type PagedResult } from '../../lib/adminClient';
import { BankError, Empty } from '../States';

/**
 * One account's ledger entries: transfers, returns, and what a card authorisation left behind.
 *
 * A plain fetch of its own rather than the shared `DataList`, deliberately: this panel sits on the same
 * page as the account's card list, and `DataList` keeps its page and filters in the URL with no
 * namespace, so a second instance on one page would fight the first over `page` and `limit`. This one
 * has no URL state at all, which is the right trade for a fixed, small page size on an already-scoped
 * account rather than a full searchable list.
 */

interface Movement {
  accountMovementInstanceReference: string;
  movementKind: string;
  movementDirection: 'debit' | 'credit';
  movementAmount: number;
  movementCurrency: string;
  movementBalanceAfter: number;
  movementRemittanceInformation?: string;
  movementValueDateTime: string;
}

const KIND_LABEL: Record<string, string> = {
  book_transfer_debit: 'Transfer out',
  book_transfer_credit: 'Transfer in',
  credit_transfer_debit: 'Transfer out',
  credit_transfer_credit: 'Transfer in',
  card_authorisation_hold: 'Card hold',
  card_authorisation_release: 'Card hold released',
  card_settlement: 'Card purchase',
  return: 'Returned',
  demo_credit: 'Deposit',
};

function amount(movement: Movement): string {
  const signed = movement.movementDirection === 'debit' ? -movement.movementAmount : movement.movementAmount;
  const formatted = `${signed >= 0 ? '+' : ''}${signed.toFixed(2)} ${movement.movementCurrency}`;
  return formatted;
}

export function AccountMovements({ accountReference }: { accountReference: string }) {
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    admin.list<Movement>(`accounts/${encodeURIComponent(accountReference)}/movements`, { limit: 20 })
      .then((page: PagedResult<Movement>) => { if (live) { setRows(page.results); setError(null); } })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof AdminError ? cause.message : String(cause));
      });
    return () => { live = false; };
  }, [accountReference]);

  if (error) return <BankError message={error} />;
  if (!rows) return <p className="text-sm text-ink-soft">Reading the movements…</p>;
  if (rows.length === 0) return <Empty>No movements on this account yet.</Empty>;

  return (
    <ul className="divide-y divide-line">
      {rows.map((movement) => (
        <li
          key={movement.accountMovementInstanceReference}
          className="flex items-center justify-between gap-3 py-2.5 text-sm"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {KIND_LABEL[movement.movementKind] ?? movement.movementKind}
            </p>
            <p className="truncate text-xs text-ink-soft">
              {new Date(movement.movementValueDateTime).toLocaleString()}
              {movement.movementRemittanceInformation ? ` · ${movement.movementRemittanceInformation}` : ''}
            </p>
          </div>
          <span
            className={`shrink-0 font-mono text-sm font-semibold ${
              movement.movementDirection === 'debit' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {amount(movement)}
          </span>
        </li>
      ))}
    </ul>
  );
}

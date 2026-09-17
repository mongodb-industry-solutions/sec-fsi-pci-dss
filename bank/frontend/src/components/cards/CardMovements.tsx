'use client';
import { useEffect, useState } from 'react';
import { admin, AdminError, type PagedResult } from '../../lib/adminClient';
import { BankError, Empty } from '../States';

/**
 * One card's own ledger entries: the holds and settlements it authorised, newest first.
 *
 * Same shape and the same plain fetch as `AccountMovements`, narrowed to this card rather than the whole
 * account it draws on. An account can fund several cards, so an account's movements answer "what happened
 * on this balance" while this answers "what did THIS card do", which is the question a cardholder reviewing
 * one card's spending, or an investigator tracing one card, actually asks.
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
  card_authorisation_hold: 'Card hold',
  card_authorisation_release: 'Card hold released',
  card_settlement: 'Card purchase',
  return: 'Returned',
};

function amount(movement: Movement): string {
  const signed = movement.movementDirection === 'debit' ? -movement.movementAmount : movement.movementAmount;
  return `${signed >= 0 ? '+' : ''}${signed.toFixed(2)} ${movement.movementCurrency}`;
}

export function CardMovements({ cardToken }: { cardToken: string }) {
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    admin.list<Movement>(`cards/${encodeURIComponent(cardToken)}/movements`, { limit: 20 })
      .then((page: PagedResult<Movement>) => { if (live) { setRows(page.results); setError(null); } })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof AdminError ? cause.message : String(cause));
      });
    return () => { live = false; };
  }, [cardToken]);

  if (error) return <BankError message={error} />;
  if (!rows) return <p className="text-sm text-ink-soft">Reading the movements…</p>;
  if (rows.length === 0) return <Empty>No movements on this card yet.</Empty>;

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

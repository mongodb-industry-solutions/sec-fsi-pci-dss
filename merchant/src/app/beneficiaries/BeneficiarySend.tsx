'use client';
// Per-row send control (C-14): mirrors the PSP send-to-beneficiary flow from the merchant.
// Reveals an inline amount input + source-account picker + description, calls the sendToBeneficiary
// server action for THIS beneficiary token, and shows the transfer reference/status or an error inline.
// The merchant only ever sends amount + opaque token + a source account reference + a description
// (never IBAN/PAN/CHD). The source account defaults to the first option (default account first).
import { useState, useTransition } from 'react';
import { Send, Loader2, CheckCircle2, TriangleAlert, X } from 'lucide-react';
import { sendToBeneficiary } from '@/lib/actions';
import { Tip } from '@/components/ui/Tooltip';
import type { AccountOption } from '@/lib/accounts';

export default function BeneficiarySend({
  beneficiaryToken,
  currency = 'EUR',
  accounts = [],
}: {
  beneficiaryToken: string;
  currency?: string;
  accounts?: AccountOption[];
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [fromAccountRef, setFromAccountRef] = useState(accounts[0]?.ref ?? '');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean>(true);

  const hasAccounts = accounts.length > 0;

  function onSend() {
    const value = Number(amount);
    if (!(value > 0)) {
      setOk(false);
      setMsg('Enter an amount greater than zero.');
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await sendToBeneficiary({
        beneficiaryToken,
        amount: value,
        currency,
        fromAccountRef: fromAccountRef || undefined,
        note: note.trim() || undefined,
      });
      setOk(!!res.ok);
      setMsg(res.message ?? (res.ok ? 'Sent.' : 'Failed.'));
      if (res.ok) { setAmount(''); setNote(''); }
    });
  }

  if (!open) {
    return (
      <Tip label={hasAccounts ? 'Send money to this beneficiary.' : 'Add a payout account to send money.'}>
        <button
          onClick={() => { setOpen(true); setMsg(null); }}
          disabled={!hasAccounts}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-leaf-deep hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
        >
          <Send className="h-3.5 w-3.5" aria-hidden /> Send
        </button>
      </Tip>
    );
  }

  return (
    <div className="flex w-full max-w-sm shrink-0 flex-col items-end gap-2">
      {!hasAccounts ? (
        <p className="text-xs text-muted">You have no active payout account to send from.</p>
      ) : (
        <>
          <label className="w-full text-xs text-muted">
            <span className="mb-0.5 block">From account</span>
            <select
              value={fromAccountRef}
              onChange={(e) => setFromAccountRef(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              {accounts.map((a) => (
                <option key={a.ref} value={a.ref}>{a.label}{a.isDefault ? ' (default)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="w-full text-xs text-muted">
            <span className="mb-0.5 block">Description</span>
            <input
              type="text"
              maxLength={140}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. invoice 1042"
              className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`amt-${beneficiaryToken}`}>Amount to send ({currency})</label>
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1">
              <span className="text-xs text-muted">{currency}</span>
              <input
                id={`amt-${beneficiaryToken}`}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
                placeholder="0.00"
                autoFocus
                className="w-24 bg-transparent text-right text-sm text-ink outline-none"
              />
            </div>
            <Tip label="Confirm and send.">
              <button onClick={onSend} disabled={pending} className="btn-primary text-sm">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                {pending ? 'Sending…' : 'Send'}
              </button>
            </Tip>
            <Tip label="Cancel.">
              <button
                onClick={() => { setOpen(false); setMsg(null); }}
                aria-label="Cancel"
                className="inline-flex items-center rounded-lg p-1 text-muted hover:text-ink"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </Tip>
          </div>
        </>
      )}
      {msg && (
        <p className={`flex items-center gap-1.5 text-xs ${ok ? 'text-leaf-deep' : 'text-[var(--err)]'}`}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
          {msg}
        </p>
      )}
    </div>
  );
}

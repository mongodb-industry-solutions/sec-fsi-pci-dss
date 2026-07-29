'use client';
// Unified beneficiary action modal (v28). One component drives BOTH "Send money" (P2P, SD-65) and
// "Request money" (RTP, SD-65 intent) so the two flows share an identical, simplified UI. The row only
// shows a compact button; all data capture happens in a modal (portalled to <body> to escape any
// transformed ancestor). Reuses the existing server actions and the PSP API only.
//
// After a successful action both modes show the SAME confirmation state (Repeat / Close) so it is
// always clear the action completed. A beneficiary request is delivered to the payer in-app (approval
// inbox), so no QR/deep-link is shown here (the link target is the PSP app, not a public page).
import { useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { Send, HandCoins, Loader2, CheckCircle2, TriangleAlert, X, RotateCcw } from 'lucide-react';
import { sendToBeneficiary, requestMoney } from '@/lib/actions';
import { Tip } from '@/components/ui/Tooltip';
import type { AccountOption } from '@/lib/accounts';

type Mode = 'send' | 'request';

const COPY: Record<Mode, { verb: string; icon: typeof Send; title: string; tip: string; note: string; done: string }> = {
  send: {
    verb: 'Send', icon: Send, title: 'Send money',
    tip: 'Send a payment to this beneficiary.',
    note: 'The PSP moves the funds. The merchant never sees the IBAN or card.',
    done: 'Payment sent.',
  },
  request: {
    verb: 'Request', icon: HandCoins, title: 'Request money',
    tip: 'Request money from this beneficiary (they approve to pay).',
    note: 'The beneficiary gets an in-app approval request. Nothing moves until they approve.',
    done: 'Request sent for approval.',
  },
};

export default function BeneficiaryPayModal({
  mode,
  beneficiaryToken,
  beneficiaryLabel,
  accounts = [],
  currency = 'EUR',
}: {
  mode: Mode;
  beneficiaryToken: string;
  beneficiaryLabel?: string;
  accounts?: AccountOption[];
  currency?: string;
}) {
  const cfg = COPY[mode];
  const Icon = cfg.icon;
  const hasAccounts = accounts.length > 0;
  const sendDisabled = mode === 'send' && !hasAccounts;

  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [amount, setAmount] = useState('');
  const [fromAccountRef, setFromAccountRef] = useState(accounts[0]?.ref ?? '');
  const [text, setText] = useState(''); // description (send) / purpose (request)
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);

  function reset() { setAmount(''); setText(''); setMsg(null); setOk(true); setDone(false); }
  function close() { setOpen(false); reset(); }

  function submit() {
    const value = Number(amount);
    if (!(value > 0)) { setOk(false); setMsg('Enter an amount greater than zero.'); return; }
    setMsg(null);
    start(async () => {
      const res = mode === 'send'
        ? await sendToBeneficiary({ beneficiaryToken, amount: value, currency, fromAccountRef: fromAccountRef || undefined, note: text.trim() || undefined })
        : await requestMoney({ amount: value, currency, purpose: text.trim() || undefined, payerCounterpartyReference: beneficiaryToken });
      setOk(!!res.ok);
      if (res.ok) { setDone(true); setMsg(res.message ?? cfg.done); }
      else setMsg(res.message ?? 'Failed.');
    });
  }

  return (
    <>
      <Tip label={sendDisabled ? 'Add a payout account to send money.' : cfg.tip}>
        <button
          onClick={() => { reset(); setOpen(true); }}
          disabled={sendDisabled}
          className="btn-ghost shrink-0 text-sm text-leaf-deep disabled:cursor-not-allowed disabled:text-muted"
        >
          <Icon className="h-3.5 w-3.5" aria-hidden /> {cfg.verb}
        </button>
      </Tip>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div role="dialog" aria-modal="true" aria-label={cfg.title} className="glass w-full max-w-sm rounded-2xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-ink"><Icon className="h-5 w-5 text-leaf-deep" aria-hidden /> {cfg.title}</h3>
              <button onClick={close} aria-label="Close" className="text-muted hover:text-ink"><X className="h-5 w-5" aria-hidden /></button>
            </div>
            {beneficiaryLabel && <p className="mb-3 text-sm text-muted">To <span className="font-medium text-ink">{beneficiaryLabel}</span></p>}

            {done ? (
              /* Confirmation state — identical for send and request. Only Repeat / Close. */
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-2 py-2 text-center">
                  <CheckCircle2 className="h-10 w-10 text-leaf-deep" aria-hidden />
                  <p className="text-sm font-medium text-ink">{msg ?? cfg.done}</p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Tip label="Start another with a clean form.">
                    <button onClick={reset} className="btn-ghost text-sm"><RotateCcw className="h-4 w-4" aria-hidden /> Repeat</button>
                  </Tip>
                  <button onClick={close} className="btn-primary text-sm">Close</button>
                </div>
              </div>
            ) : mode === 'send' && !hasAccounts ? (
              <p className="text-sm text-[var(--err)]">You have no active payout account to send from.</p>
            ) : (
              <div className="space-y-3">
                {mode === 'send' && (
                  <label className="block text-xs text-muted">
                    <span className="mb-0.5 block">From account</span>
                    <select value={fromAccountRef} onChange={(e) => setFromAccountRef(e.target.value)}
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30">
                      {accounts.map((a) => <option key={a.ref} value={a.ref}>{a.label}{a.isDefault ? ' (default)' : ''}</option>)}
                    </select>
                  </label>
                )}
                <label className="block text-xs text-muted">
                  <span className="mb-0.5 block">{mode === 'send' ? 'Description' : 'Purpose'}</span>
                  <input type="text" maxLength={140} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. invoice 1042"
                    className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
                </label>
                <label className="block text-xs text-muted">
                  <span className="mb-0.5 block">Amount</span>
                  <div className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1.5">
                    <span className="text-xs text-muted">{currency}</span>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={amount} autoFocus
                      onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                      placeholder="0.00" className="w-full bg-transparent text-right text-sm text-ink outline-none" />
                  </div>
                </label>

                <p className="text-[11px] leading-snug text-muted">{cfg.note}</p>

                {msg && !ok && (
                  <p className="flex items-center gap-1.5 text-xs text-[var(--err)]">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {msg}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button onClick={close} className="btn-ghost text-sm">Cancel</button>
                  <button onClick={submit} disabled={pending} className="btn-primary text-sm">
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
                    {pending ? `${cfg.verb}ing…` : cfg.verb}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

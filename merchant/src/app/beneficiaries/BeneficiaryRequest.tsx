'use client';
// Per-row "Request money" control (v28 RTP): the merchant requests money FROM this beneficiary.
// Mirrors BeneficiarySend but calls the requestMoney server action with the opaque beneficiary token
// (payerCounterpartyReference) — the PSP resolves the payer party from it. Never handles raw party
// refs/IBAN/PAN. On success it surfaces the RTP reference + the shareable QR/deep-link.
import { useState, useTransition } from 'react';
import { HandCoins, Loader2, CheckCircle2, TriangleAlert, X, Copy } from 'lucide-react';
import { requestMoney } from '@/lib/actions';
import { Tip } from '@/components/ui/Tooltip';

export default function BeneficiaryRequest({ beneficiaryToken, currency = 'EUR' }: { beneficiaryToken: string; currency?: string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function onRequest() {
    const value = Number(amount);
    if (!(value > 0)) { setOk(false); setMsg('Enter an amount greater than zero.'); return; }
    setMsg(null); setPayUrl(null);
    startTransition(async () => {
      const res = await requestMoney({ amount: value, currency, purpose: purpose.trim() || undefined, payerCounterpartyReference: beneficiaryToken });
      setOk(!!res.ok);
      setMsg(res.ok ? 'Request sent for approval.' : (res.message ?? 'Failed.'));
      if (res.ok) { setAmount(''); setPurpose(''); setPayUrl(res.paymentUrl ?? null); }
    });
  }

  if (!open) {
    return (
      <Tip label="Request money from this beneficiary (they approve to pay).">
        <button onClick={() => { setOpen(true); setMsg(null); setPayUrl(null); }}
          className="btn-ghost shrink-0 text-sm text-leaf-deep">
          <HandCoins className="h-3.5 w-3.5" aria-hidden /> Request
        </button>
      </Tip>
    );
  }

  return (
    <div className="flex w-full max-w-sm shrink-0 flex-col items-end gap-2">
      <label className="w-full text-xs text-muted">
        <span className="mb-0.5 block">Purpose</span>
        <input type="text" maxLength={140} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. invoice 1042"
          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
      </label>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1">
          <span className="text-xs text-muted">{currency}</span>
          <input type="number" min="0" step="0.01" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onRequest(); }}
            placeholder="0.00" autoFocus className="w-24 bg-transparent text-right text-sm text-ink outline-none" />
        </div>
        <Tip label="Send the request for approval.">
          <button onClick={onRequest} disabled={pending} className="btn-primary text-sm">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <HandCoins className="h-4 w-4" aria-hidden />}
            {pending ? 'Requesting…' : 'Request'}
          </button>
        </Tip>
        <Tip label="Cancel.">
          <button onClick={() => { setOpen(false); setMsg(null); setPayUrl(null); }} aria-label="Cancel"
            className="inline-flex items-center rounded-lg p-1 text-muted hover:text-ink"><X className="h-4 w-4" aria-hidden /></button>
        </Tip>
      </div>
      {msg && (
        <p className={`flex items-center gap-1.5 text-xs ${ok ? 'text-leaf-deep' : 'text-[var(--err)]'}`}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
          {msg}
        </p>
      )}
      {payUrl && (
        <button onClick={() => { navigator.clipboard.writeText(payUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
          className="inline-flex items-center gap-1 text-xs text-leaf-deep hover:underline">
          <Copy className="h-3 w-3" aria-hidden /> {copied ? 'Copied link' : 'Copy payment link'}
        </button>
      )}
    </div>
  );
}

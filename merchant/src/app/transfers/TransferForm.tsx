'use client';
// Bank transfer: preview → execute. Rails ACH / SEPA / SWIFT.
import { useState, useTransition } from 'react';
import { CheckCircle2, Eye, Loader2, Send, TriangleAlert } from 'lucide-react';
import { previewTransfer, bankTransfer, type ActionResult } from '@/lib/actions';
import { InfoHint } from '@/components/ui/Bits';
import { Tip } from '@/components/ui/Tooltip';
import type { AccountOption } from '@/lib/accounts';
import { BRAND } from '@/lib/brand';

const RAILS = ['sepa', 'ach', 'swift'] as const;

// Per-field guidance: what to enter and why.
const HELP: Record<string, string> = {
  amount: 'Amount to send, in the currency below.',
  currency: 'ISO currency code, e.g. EUR, USD, GBP.',
  beneficiaryName: 'Name of the account holder receiving the money.',
  countryCode: 'ISO country of the destination account, e.g. DE, US, GB.',
  reference: 'Optional note shown on the transfer (e.g. invoice number).',
  iban: 'International account number, used for SEPA / SWIFT. Masked in transit.',
  bic: 'Bank identifier (SWIFT/BIC), required for SWIFT and optional for SEPA.',
  accountNumber: 'Domestic account number, used for ACH.',
  routingNumber: 'Bank routing (ABA) number, used for ACH.',
};

export default function TransferForm({ accounts = [] }: { accounts?: AccountOption[] }) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    amount: '100', currency: 'EUR', countryCode: 'DE', rail: 'sepa',
    beneficiaryName: '', iban: '', accountNumber: '', routingNumber: '', bic: '', reference: '',
    fromAccountRef: accounts[0]?.ref ?? '',
  });
  const [preview, setPreview] = useState<ActionResult | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const payload = () => ({
    amount: Number(form.amount), currency: form.currency, countryCode: form.countryCode, rail: form.rail,
    beneficiaryName: form.beneficiaryName || undefined, iban: form.iban || undefined,
    accountNumber: form.accountNumber || undefined, routingNumber: form.routingNumber || undefined,
    bic: form.bic || undefined, reference: form.reference || undefined,
    fromAccountRef: form.fromAccountRef || undefined,
  });

  function onPreview() {
    setResult(null);
    startTransition(async () => setPreview(await previewTransfer(payload())));
  }
  function onSend() {
    startTransition(async () => setResult(await bankTransfer(payload())));
  }

  const field = (label: string, k: keyof typeof form, type = 'text') => (
    <label className="block text-sm">
      <span className="flex items-center gap-1 text-muted">
        {label} <InfoHint label={HELP[k]} />
      </span>
      <input
        type={type}
        value={form[k]}
        onChange={upd(k)}
        className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
    </label>
  );

  return (
    <div className="space-y-6">
      <div className="glass space-y-3 rounded-2xl p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {field('Amount', 'amount', 'number')}
          {field('Currency', 'currency')}
          {field('Beneficiary name', 'beneficiaryName')}
          {field('Country code', 'countryCode')}
          {accounts.length > 0 && (
            <label className="block text-sm">
              <span className="flex items-center gap-1 text-muted">
                From account <InfoHint label="Your payout account the money leaves from. IBAN is masked; the merchant never sees it in clear." />
              </span>
              <select
                value={form.fromAccountRef}
                onChange={upd('fromAccountRef')}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              >
                {accounts.map((a) => (
                  <option key={a.ref} value={a.ref}>{a.label}{a.isDefault ? ' (default)' : ''}</option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm">
            <span className="flex items-center gap-1 text-muted">
              Rail <InfoHint label="Payment network: SEPA (EU), ACH (US domestic), or SWIFT (international)." />
            </span>
            <select
              value={form.rail}
              onChange={upd('rail')}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              {RAILS.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </select>
          </label>
          {field('Reference', 'reference')}
          {field('IBAN', 'iban')}
          {field('BIC / SWIFT', 'bic')}
          {field('Account number', 'accountNumber')}
          {field('Routing number', 'routingNumber')}
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <Tip label="Estimate fees and the rail without sending money.">
            <button onClick={onPreview} disabled={pending} className="btn-ghost text-sm">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />} Preview
            </button>
          </Tip>
          <Tip label={`Submit the transfer for execution by ${BRAND.full}.`}>
            <button onClick={onSend} disabled={pending} className="btn-primary text-sm">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Send transfer
            </button>
          </Tip>
        </div>
      </div>

      <div className="space-y-4">
        {preview && (
          <div className="glass rounded-2xl p-5">
            <h3 className="mb-2 flex items-center gap-2 font-semibold">
              <Eye className="h-4 w-4 text-muted" aria-hidden /> Preview
            </h3>
            {preview.ok ? (
              <pre className="overflow-auto rounded-lg bg-surface-alt p-3 text-xs text-ink">{JSON.stringify(preview.data, null, 2)}</pre>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-[var(--err)]"><TriangleAlert className="h-4 w-4" aria-hidden /> {preview.message}</p>
            )}
          </div>
        )}
        {result && (
          <div className={`rounded-2xl border p-5 ${result.ok ? 'border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-[var(--ok-bg)]' : 'border-[color-mix(in_srgb,var(--err)_35%,transparent)] bg-[var(--err-bg)]'}`}>
            <h3 className={`mb-2 flex items-center gap-2 font-semibold ${result.ok ? 'text-[var(--ok)]' : 'text-[var(--err)]'}`}>
              {result.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <TriangleAlert className="h-4 w-4" aria-hidden />}
              {result.ok ? 'Submitted' : 'Failed'}
            </h3>
            <p className="text-sm text-ink/80">{result.message}</p>
            {result.data ? <pre className="mt-2 overflow-auto rounded-lg bg-surface/60 p-3 text-xs text-ink">{JSON.stringify(result.data, null, 2)}</pre> : null}
          </div>
        )}
      </div>
    </div>
  );
}

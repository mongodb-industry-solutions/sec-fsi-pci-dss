'use client';
// Bank transfer: preview → execute. Rails ACH / SEPA / SWIFT.
import { useState, useTransition } from 'react';
import { previewTransfer, bankTransfer, type ActionResult } from '@/lib/actions';

const RAILS = ['sepa', 'ach', 'swift'] as const;

export default function TransferForm() {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    amount: '100',
    currency: 'EUR',
    countryCode: 'DE',
    rail: 'sepa',
    beneficiaryName: '',
    iban: '',
    accountNumber: '',
    routingNumber: '',
    bic: '',
    reference: '',
  });
  const [preview, setPreview] = useState<ActionResult | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const upd = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const payload = () => ({
    amount: Number(form.amount),
    currency: form.currency,
    countryCode: form.countryCode,
    rail: form.rail,
    beneficiaryName: form.beneficiaryName || undefined,
    iban: form.iban || undefined,
    accountNumber: form.accountNumber || undefined,
    routingNumber: form.routingNumber || undefined,
    bic: form.bic || undefined,
    reference: form.reference || undefined,
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
      <span className="text-espresso-light">{label}</span>
      <input type={type} value={form[k]} onChange={upd(k)} className="mt-1 w-full rounded border border-espresso/20 px-2 py-1.5" />
    </label>
  );

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3 rounded-xl border border-espresso/10 bg-white p-5">
        <div className="grid grid-cols-2 gap-3">
          {field('Amount', 'amount', 'number')}
          {field('Currency', 'currency')}
          {field('Beneficiary name', 'beneficiaryName')}
          {field('Country code', 'countryCode')}
          <label className="block text-sm">
            <span className="text-espresso-light">Rail</span>
            <select value={form.rail} onChange={upd('rail')} className="mt-1 w-full rounded border border-espresso/20 px-2 py-1.5">
              {RAILS.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </select>
          </label>
          {field('Reference', 'reference')}
          {field('IBAN', 'iban')}
          {field('BIC / SWIFT', 'bic')}
          {field('Account number', 'accountNumber')}
          {field('Routing number', 'routingNumber')}
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onPreview} disabled={pending} className="rounded border border-espresso px-4 py-2 text-sm disabled:opacity-50">Preview</button>
          <button onClick={onSend} disabled={pending} className="rounded bg-espresso text-crema px-4 py-2 text-sm disabled:opacity-50">Send transfer</button>
        </div>
      </div>

      <div className="space-y-4">
        {preview && (
          <div className="rounded-xl border border-espresso/10 bg-white p-5">
            <h3 className="font-semibold mb-2">Preview</h3>
            {preview.ok
              ? <pre className="text-xs overflow-auto">{JSON.stringify(preview.data, null, 2)}</pre>
              : <p className="text-sm text-red-700">{preview.message}</p>}
          </div>
        )}
        {result && (
          <div className={`rounded-xl border p-5 ${result.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <h3 className="font-semibold mb-2">{result.ok ? 'Submitted' : 'Failed'}</h3>
            <p className="text-sm">{result.message}</p>
            {result.data ? <pre className="text-xs overflow-auto mt-2">{JSON.stringify(result.data, null, 2)}</pre> : null}
          </div>
        )}
      </div>
    </div>
  );
}

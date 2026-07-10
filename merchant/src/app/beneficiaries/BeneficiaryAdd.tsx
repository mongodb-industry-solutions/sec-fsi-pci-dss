'use client';
// Add-beneficiary control (SD-54). Everything goes through the PSP API: the merchant submits only a
// phone/email + optional label to the addBeneficiary server action; the PSP resolves it to an opaque
// token (the merchant never learns the recipient's identity). On success the list is refreshed.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Loader2, CheckCircle2, TriangleAlert, X } from 'lucide-react';
import { addBeneficiary } from '@/lib/actions';
import { Tip } from '@/components/ui/Tooltip';

export default function BeneficiaryAdd() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lookupType, setLookupType] = useState<'email' | 'phone'>('email');
  const [lookupValue, setLookupValue] = useState('');
  const [label, setLabel] = useState('');
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);

  function reset() {
    setLookupValue('');
    setLabel('');
    setMsg(null);
  }

  function onAdd() {
    if (!lookupValue.trim()) {
      setOk(false);
      setMsg(lookupType === 'email' ? 'Enter an email address.' : 'Enter a phone number.');
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await addBeneficiary({ lookupType, lookupValue, label });
      setOk(!!res.ok);
      setMsg(res.message ?? (res.ok ? 'Added.' : 'Failed.'));
      if (res.ok) {
        reset();
        router.refresh(); // re-fetch the server-rendered list so the new beneficiary appears
      }
    });
  }

  if (!open) {
    return (
      <Tip label="Add a payee by their Leafy Pay email or phone.">
        <button onClick={() => { setOpen(true); setMsg(null); }} className="btn-primary text-sm">
          <UserPlus className="h-4 w-4" aria-hidden /> Add beneficiary
        </button>
      </Tip>
    );
  }

  return (
    <div className="glass w-full max-w-md rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <UserPlus className="h-4 w-4 text-leaf-deep" aria-hidden /> Add beneficiary
        </h2>
        <button onClick={() => { setOpen(false); reset(); }} className="text-muted hover:text-ink" aria-label="Cancel">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Identifier type</span>
          <select
            value={lookupType}
            onChange={(e) => setLookupType(e.target.value as 'email' | 'phone')}
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          >
            <option value="email">Email</option>
            <option value="phone">Phone</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          <span className="mb-0.5 block">{lookupType === 'email' ? 'Email address' : 'Phone number'}</span>
          <input
            type={lookupType === 'email' ? 'email' : 'tel'}
            value={lookupValue}
            onChange={(e) => setLookupValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
            placeholder={lookupType === 'email' ? 'name@example.com' : '+34 600 000 000'}
            autoFocus
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <label className="text-xs text-muted">
          <span className="mb-0.5 block">Label <span className="text-muted/70">(optional)</span></span>
          <input
            type="text"
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Supplier, Acme"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>

        <div className="mt-1 flex items-center justify-end gap-2">
          <button onClick={onAdd} disabled={pending} className="btn-primary text-sm">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />}
            {pending ? 'Adding…' : 'Add'}
          </button>
        </div>

        {msg && (
          <p className={`mt-1 flex items-center gap-1.5 text-xs ${ok ? 'text-leaf-deep' : 'text-red-600'}`}>
            {ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}

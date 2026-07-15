'use client';
// Remove-beneficiary control (SD-54). Sends only the opaque token to the removeBeneficiary server action;
// the PSP soft-deletes the arrangement scoped to the acting user. A two-step confirm avoids accidental
// deletes. On success the list is refreshed.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2, TriangleAlert } from 'lucide-react';
import { removeBeneficiary } from '@/lib/actions';
import { Tip } from '@/components/ui/Tooltip';

export default function BeneficiaryRemove({ beneficiaryToken, label }: { beneficiaryToken: string; label?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onRemove() {
    setErr(null);
    startTransition(async () => {
      const res = await removeBeneficiary({ beneficiaryToken });
      if (res.ok) {
        router.refresh();
      } else {
        setErr(res.message ?? 'Failed to remove.');
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Remove{label ? ` ${label}` : ''}?</span>
        <button
          onClick={onRemove}
          disabled={pending}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition duration-200 hover:brightness-110 active:scale-[.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
          {pending ? 'Removing…' : 'Confirm'}
        </button>
        <button onClick={() => setConfirming(false)} disabled={pending} className="btn-ghost text-xs">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <>
      <Tip label="Remove this beneficiary.">
        <button onClick={() => setConfirming(true)} className="btn-ghost text-sm text-red-600" aria-label="Remove beneficiary">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </Tip>
      {err && (
        <span className="flex items-center gap-1 text-xs text-red-600">
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {err}
        </span>
      )}
    </>
  );
}

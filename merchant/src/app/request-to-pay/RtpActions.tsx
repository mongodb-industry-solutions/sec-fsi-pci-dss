'use client';
// Client actions for a merchant RTP row: approve/reject (payer view) or cancel (payee view). Backed by
// the 'use server' actions in lib/actions.ts (authenticated OAuth session; no CIBA).
import { useState, useTransition } from 'react';
import { approveRtp, rejectRtp, cancelRtp } from '@/lib/actions';

export default function RtpActions({ reference, mode }: { reference: string; mode: 'approve' | 'cancel' }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => start(async () => {
    const r = await fn();
    setMsg(r.ok ? 'Done' : (r.message ?? 'Failed'));
    if (r.ok) setTimeout(() => window.location.reload(), 800);
  });

  if (mode === 'cancel') {
    return (
      <div className="flex items-center gap-2">
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
        <button disabled={pending} onClick={() => run(() => cancelRtp(reference))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Cancel</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      <button disabled={pending} onClick={() => run(() => approveRtp(reference))} className="rounded-lg bg-leaf px-3 py-1.5 text-sm font-semibold text-leaf-deep disabled:opacity-50">Approve</button>
      <button disabled={pending} onClick={() => run(() => rejectRtp(reference))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50">Reject</button>
    </div>
  );
}

'use client';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function CallbackInner() {
  const params = useSearchParams();

  // The PSP callback carries the outcome (result), the surrogate card token, the response code and
  // (on failure) the decline reason — never the PAN/CVV. `result` is the new field; fall back to the
  // legacy `status` param. Map to the status the simulator parent already understands.
  const result = params.get('result') ?? params.get('status') ?? 'approved';
  const approved = result === 'approved' || result === 'success' || result === 'paid';
  const cancelled = result === 'cancelled';
  const reason = params.get('reason') ?? '';

  useEffect(() => {
    const status = approved ? 'success' : cancelled ? 'cancelled' : 'declined';
    window.parent?.postMessage(
      {
        type: 'sim_payment_complete',
        status,
        result,
        sessionId: params.get('session') ?? '',
        txnId: params.get('txn') ?? '',
        caseId: params.get('case') ?? '',
        cardToken: params.get('token') ?? '',
        responseCode: params.get('code') ?? '',
        reason,
      },
      window.location.origin
    );
  }, [params, approved, cancelled, result, reason]);

  return (
    <div className="flex items-center justify-center h-screen bg-white">
      <div className="text-center px-6">
        <div className="text-4xl mb-3">{approved ? '✅' : cancelled ? '↩️' : '⚠️'}</div>
        <p className="text-sm font-medium text-gray-700">
          {approved ? 'Payment confirmed' : cancelled ? 'Payment cancelled' : 'Payment declined'}
        </p>
        {!approved && !cancelled && reason && (
          <p className="text-xs text-gray-500 mt-1">{reason}</p>
        )}
        <p className="text-xs text-gray-400 mt-2">Returning to simulator…</p>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense>
      <CallbackInner />
    </Suspense>
  );
}

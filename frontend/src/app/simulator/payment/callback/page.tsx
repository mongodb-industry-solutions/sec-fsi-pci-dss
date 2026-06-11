'use client';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function CallbackInner() {
  const params = useSearchParams();

  useEffect(() => {
    const status = params.get('status') ?? 'success';
    const sessionId = params.get('session') ?? '';
    const txnId = params.get('txn') ?? '';

    window.parent?.postMessage(
      { type: 'sim_payment_complete', status, sessionId, txnId },
      window.location.origin
    );
  }, [params]);

  return (
    <div className="flex items-center justify-center h-screen bg-white">
      <div className="text-center">
        <div className="text-4xl mb-3">✅</div>
        <p className="text-sm text-gray-500">Returning to simulator…</p>
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

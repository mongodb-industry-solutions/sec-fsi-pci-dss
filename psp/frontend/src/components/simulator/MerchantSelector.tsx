'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { getSimToken } from '../../lib/simulatorAuth';

export interface SimMerchant { id: string; name: string; mcc?: string }

// The real merchant agreements, read from the gateway with a real token for the payer persona, the
// same call and the same authorization the payment form makes. It used to derive the list from the
// demo roster instead, which stopped carrying merchants when the roster moved to the identity
// authority: merchants are the platform's own records, not the authority's, so the roster answered
// with nothing and the simulator said there were none.
export function MerchantSelector({ payerEmail, selected, onSelect }: {
  payerEmail: string | null;
  selected: string | null;
  onSelect: (m: SimMerchant) => void;
}) {
  const [merchants, setMerchants] = useState<SimMerchant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!payerEmail) { setMerchants([]); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSimToken(payerEmail)
      .then((token) => api.merchants.picker({ limit: 12 }, token))
      .then((r) => {
        if (cancelled) return;
        setMerchants((r.results ?? []).map((m) => ({
          id: m.merchantAgreementInstanceReference,
          name: m.merchantName,
          ...(m.merchantCategoryCode ? { mcc: m.merchantCategoryCode } : {}),
        })));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMerchants([]);
        setError(e instanceof Error ? e.message : 'Could not load merchants.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [payerEmail]);

  if (!payerEmail) {
    return <p className="text-sm text-gray-400">Select a customer scenario first.</p>;
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[0, 1].map((i) => <div key={i} className="rounded-lg border px-3 py-3 animate-pulse bg-gray-50 h-[60px]" />)}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-600">Could not load merchants: {error}</p>;
  }

  if (merchants.length === 0) {
    return <p className="text-sm text-gray-400">No active merchant agreements on this platform.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {merchants.map((m) => {
        const active = selected === m.id;
        return (
          <button key={m.id} onClick={() => onSelect(m)}
            className={`rounded-lg border px-3 py-3 text-left transition-colors ${
              active ? 'border-[#001E2B] bg-[#001E2B] text-white' : 'hover:border-gray-400'
            }`}>
            <div className="flex items-center gap-2">
              <span className="text-base">🏬</span>
              <span className="text-sm font-semibold truncate">{m.name}</span>
            </div>
            <div className={`text-xs mt-0.5 font-mono ${active ? 'text-gray-300' : 'text-gray-400'}`}>
              {m.mcc ? `MCC ${m.mcc}` : 'Merchant'}
            </div>
          </button>
        );
      })}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import demoRoster from '../../config/demoRoster.json';

export interface SimMerchant { id: string; name: string; mcc?: string }

// Lists the real merchants owned by featured customers (the shared demo roster, NON-hardcoded):
// e.g. luis.fernandez → Espresso Works, amara.okafor → Okafor Digital Services. Same source as the
// /system login, so everything done here is reviewable in the system under that merchant.
export function MerchantSelector({ selected, onSelect }: {
  selected: string | null;
  onSelect: (m: SimMerchant) => void;
}) {
  const [merchants, setMerchants] = useState<SimMerchant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.system.users(demoRoster.simulatorMerchants)
      .then((r) => {
        const seen = new Set<string>();
        const list = (r.users ?? [])
          .map((u) => u.merchant)
          .filter((m): m is SimMerchant => !!m && !seen.has(m.id) && (seen.add(m.id), true));
        setMerchants(list);
      })
      .catch(() => setMerchants([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[0, 1].map((i) => <div key={i} className="rounded-lg border px-3 py-3 animate-pulse bg-gray-50 h-[60px]" />)}
      </div>
    );
  }

  if (merchants.length === 0) {
    return <p className="text-sm text-gray-400">No merchants available in the demo roster.</p>;
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

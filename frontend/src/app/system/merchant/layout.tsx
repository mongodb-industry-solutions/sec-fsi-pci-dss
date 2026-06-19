'use client';
import { useCallback, useEffect, useState } from 'react';
import { getToken, decodeToken } from '../../../lib/auth';
import { api } from '../../../lib/api';
import {
  MerchantContext, MerchantContextValue, MerchantPanelState, MerchantRecord, isActiveOwner,
} from '../../../lib/merchantContext';
import { MerchantNav } from '../../../components/merchant/MerchantNav';

// Nested layout for /system/merchant: loads the caller's merchant once, exposes it
// via context, and renders the section sidebar for active merchant owners. Onboarding
// states and staff views render without the sidebar (full width).
export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  const [state, setState] = useState<MerchantPanelState>('loading');
  const [merchant, setMerchant] = useState<MerchantRecord | null>(null);

  const load = useCallback(async () => {
    const t = getToken() ?? '';
    setToken(t);
    const r = decodeToken(t)?.role ?? '';
    setRole(r);
    if (r !== 'customer') { setMerchant(null); setState('analyst_list'); return; }
    try {
      const res = await api.merchants.getMe(t);
      if (!res.found || !res.merchant) { setMerchant(null); setState('no_merchant'); return; }
      const m = res.merchant as unknown as MerchantRecord;
      setMerchant(m);
      const s = m.merchantAgreementStatus;
      if (s === 'under_review' || s === 'initiated') setState('under_review');
      else if (s === 'rejected') setState('rejected');
      else if (s === 'agreed') setState('agreed');
      else setState('active');
    } catch {
      setMerchant(null);
      setState('no_merchant');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ctx: MerchantContextValue = { token, role, state, merchant, refresh: load };

  return (
    <MerchantContext.Provider value={ctx}>
      {state === 'loading' ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
      ) : isActiveOwner(ctx) ? (
        <div className="flex flex-col md:flex-row min-h-full bg-gray-50">
          <MerchantNav merchantName={merchant?.merchantName} />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      ) : (
        children
      )}
    </MerchantContext.Provider>
  );
}

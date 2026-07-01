'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getToken, decodeToken } from '../../../../lib/auth';
import { api } from '../../../../lib/api';
import {
  MerchantContext, MerchantContextValue, MerchantPanelState, MerchantRecord,
} from '../../../../lib/merchantContext';
import { MerchantNav } from '../../../../components/merchant/MerchantNav';

export default function MerchantDetailLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ merchantId: string }>();
  const merchantId = params?.merchantId ?? '';

  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  const [state, setState] = useState<MerchantPanelState>('loading');
  const [merchant, setMerchant] = useState<MerchantRecord | null>(null);

  const load = useCallback(async () => {
    const t = getToken() ?? '';
    setToken(t);
    const r = decodeToken(t)?.role ?? '';
    setRole(r);
    if (!merchantId) { setState('no_merchant'); return; }
    try {
      const m = await api.merchants.getById(merchantId, t) as unknown as MerchantRecord;
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
  }, [merchantId]);

  useEffect(() => { load(); }, [load]);

  const ctx: MerchantContextValue = { token, role, state, merchant, refresh: load };

  if (state === 'loading') {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading...</div>;
  }

  // Only lock the nav for customer-facing portals. Staff can navigate freely.
  const navState = role === 'customer' ? state : undefined;

  return (
    <MerchantContext.Provider value={ctx}>
      <div className="flex flex-col md:flex-row min-h-full bg-gray-50">
        <MerchantNav merchantId={merchantId} merchantName={merchant?.merchantName} state={navState} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </MerchantContext.Provider>
  );
}

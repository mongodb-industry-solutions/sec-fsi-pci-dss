'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { SectionHeader } from '../../../components/SectionHeader';
import { SavedCardsPanel } from '../../../components/SavedCardsPanel';
import { Breadcrumb } from '../../../components/Breadcrumb';

// Dedicated customer card-on-file management . View, add and remove saved cards.
// Customer-only: staff manage no cards here. Ownership + audit are enforced server-side.
export default function CardsPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = getToken() ?? '';
    const role = t ? decodeToken(t)?.role : null;
    if (role !== 'customer') { router.replace('/system'); return; }
    setToken(t);
    api.auth.me(t)
      .then((me) => {
        const id = (me.agreement as { customerAgreementInstanceReference?: string } | null)?.customerAgreementInstanceReference;
        setAgreementId(id ?? null);
      })
      .catch(() => setAgreementId(null))
      .finally(() => setReady(true));
  }, [router]);

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Payment Methods' }]} />
      <SectionHeader
        icon={CreditCard}
        title="Payment Methods"
        description="View, add and remove your saved cards."
        info="Only the masked card number is shown. Your full card number and CVV are never stored. Removing a card cancels any recurring use of it."
        debugInfo="Payment Card · PCI DSS (no PAN/CVV) (own cards only) (audited)"
      />
      {!ready ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : agreementId ? (
        <SavedCardsPanel agreementId={agreementId} token={token} />
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No payment agreement is linked to your account yet. Make a payment to start saving cards.
        </div>
      )}
    </div>
  );
}

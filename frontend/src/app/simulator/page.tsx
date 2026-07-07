'use client';
import { useRouter } from 'next/navigation';
import { CreditCard, Search, Store, ArrowRight } from 'lucide-react';
import { MERCHANT_PUBLIC_URL } from '../../lib/constants';

interface HubCard {
  key: string;
  title: string;
  description: string;
  icon: typeof CreditCard;
  cta: string;
  onSelect: () => void;
}

export default function SimulatorHubPage() {
  const router = useRouter();

  const cards: HubCard[] = [
    {
      key: 'payment',
      title: 'Simulate Payment',
      description:
        'Configure a payment method, customer scenario and merchant, then walk through the full PCI DSS payment flow with Queryable Encryption.',
      icon: CreditCard,
      cta: 'Start payment',
      onSelect: () => router.push('/simulator/setup'),
    },
    {
      key: 'investigation',
      title: 'Simulate Investigation',
      description:
        'Jump straight into the fraud investigation dashboard to search cases, transactions and sensitive data. Reached automatically after a simulated payment.',
      icon: Search,
      cta: 'Start investigation',
      onSelect: () => router.push('/simulator/investigation'),
    },
    {
      key: 'merchant',
      title: 'Simulate Merchant',
      description:
        'Open the external merchant app (Espresso Works) that integrates with the PSP purely via OAuth2/OIDC SSO and the payment API.',
      icon: Store,
      cta: 'Open merchant app',
      onSelect: () => {
        window.location.href = MERCHANT_PUBLIC_URL;
      },
    },
  ];

  return (
    <div className="max-w-5xl mx-auto mt-8 pb-12">
      <div className="text-center mb-10">
        <div className="text-5xl mb-3">🎬</div>
        <h1 className="text-2xl font-bold text-[#001E2B] mb-2">Simulator Mode</h1>
        <p className="text-gray-600 text-sm max-w-xl mx-auto">
          Choose which part of the PCI DSS payment story you want to explore.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              onClick={c.onSelect}
              className="group text-left bg-white rounded-xl border p-6 shadow-sm hover:shadow-md hover:border-[#00ED64] transition-all flex flex-col"
            >
              <div className="w-11 h-11 rounded-lg bg-[#001E2B] text-[#00ED64] flex items-center justify-center mb-4">
                <Icon size={22} />
              </div>
              <h2 className="font-semibold text-[#001E2B] mb-2">{c.title}</h2>
              <p className="text-sm text-gray-500 flex-1">{c.description}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#001E2B] group-hover:text-[#00684A] transition-colors">
                {c.cta}
                <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

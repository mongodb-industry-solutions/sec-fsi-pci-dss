'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, Search, Store, ArrowRight, Home, LayoutDashboard } from 'lucide-react';
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
              className="group text-left bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-lg hover:border-[#001E2B] hover:bg-[#001E2B] hover:-translate-y-0.5 transition-all flex flex-col"
            >
              {/* On the dark hover state the icon chip inverts to green-on-dark for contrast. */}
              <div className="w-11 h-11 rounded-lg bg-[#001E2B] text-[#00ED64] flex items-center justify-center mb-4 transition-colors group-hover:bg-[#00ED64] group-hover:text-[#001E2B]">
                <Icon size={22} />
              </div>
              <h2 className="font-semibold text-[#001E2B] mb-2 transition-colors group-hover:text-white">{c.title}</h2>
              <p className="text-sm text-gray-500 flex-1 transition-colors group-hover:text-gray-300">{c.description}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#001E2B] transition-colors group-hover:text-[#00ED64]">
                {c.cta}
                <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>
          );
        })}
      </div>

      {/* Secondary navigation: leave the simulator or jump straight into Application mode. */}
      <div className="mt-8 pt-6 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-600 bg-white hover:border-gray-400 hover:bg-gray-50 transition-colors"
        >
          <Home size={15} className="text-gray-400 group-hover:text-gray-600 transition-colors" />
          Exit to main menu
        </Link>
        <Link
          href="/system"
          className="group inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#001E2B] text-sm font-medium text-[#001E2B] bg-white hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors"
        >
          <LayoutDashboard size={15} />
          Go to Application mode
          <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
}

'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CreditCard, Search, Store, ArrowRight, ExternalLink, Home, LayoutDashboard, QrCode, X, Landmark, BookOpen } from 'lucide-react';
import {
  MERCHANT_PUBLIC_URL, demoPublicUrl, BANKCORE_UI_PUBLIC_URL,
  PSP_API_DOC_PATH, BANKCORE_API_DOC_PATH,
} from '../../lib/constants';
import { QrRepresentation } from '../../components/QrRepresentation';

interface HubCard {
  key: string;
  title: string;
  description: string;
  icon: typeof CreditCard;
  cta: string;
  onSelect: () => void;
  // Set when the card cannot act in this environment, which is how a missing public URL is surfaced instead
  // of becoming a link that fails.
  unavailable?: string;
  // Set when the card opens a DIFFERENT site: another institution's app, or an API reference. Those have no
  // way back to the simulator, so sending the current tab there strands whoever clicked. They open in a new
  // tab instead and the card says so.
  external?: boolean;
}

/**
 * Opens a destination that is NOT part of this app.
 *
 * `noopener` is not decoration: without it the opened page can reach back through `window.opener` and navigate
 * this one, and an API console is exactly the kind of page that should not be able to.
 */
function openExternal(target: string) {
  window.open(target, '_blank', 'noopener,noreferrer');
}

export default function SimulatorHubPage() {
  const router = useRouter();
  const [shareTarget, setShareTarget] = useState<string | null>(null);

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
      external: true,
      onSelect: () => openExternal(MERCHANT_PUBLIC_URL),
    },
    {
      key: 'share',
      title: 'Share with QR code',
      description:
        'Show a QR code with this environment\'s demo URL so anyone can open the demo on a phone and follow along.',
      icon: QrCode,
      cta: 'Show QR code',
      onSelect: () => setShareTarget(demoPublicUrl('/simulator')),
    },
    {
      key: 'bankcore',
      title: 'BankCore - Admin App',
      description:
        'Open the bank\'s own administration app. It is a separate institution with its own service, its own '
        + 'database and its own Open Banking API: the cards it issued, the accounts it holds, its third-party '
        + 'registrations and its audit trail are administered there, not here.',
      icon: Landmark,
      cta: 'Open bank admin',
      external: true,
      onSelect: () => openExternal(BANKCORE_UI_PUBLIC_URL),
      // A private-only deployment publishes no address for it, and the card says so.
      unavailable: BANKCORE_UI_PUBLIC_URL
        ? undefined
        : 'This environment does not publish the bank app. Set PSP_URL_BANKCORE_FRONTEND_PUBLIC to reach it.',
    },
    {
      key: 'bank-api',
      title: 'BankCore - Open Banking API',
      description:
        'The bank\'s API reference: consents, accounts, balances, transactions, payment initiation, standing '
        + 'orders and card authorisation, as the standard defines them. Served through this origin, so it '
        + 'works without publishing the bank itself.',
      icon: BookOpen,
      cta: 'Open API reference',
      external: true,
      onSelect: () => openExternal(BANKCORE_API_DOC_PATH),
    },
    /*{
      key: 'psp-api',
      title: 'LeafyPay - Payment API',
      description:
        "The provider's own API reference: payments, checkout, cards on file, beneficiaries and the capability "
        + "router that dispatches to whoever serves each capability. It sits beside the bank's reference on "
        + 'purpose, because these are two institutions publishing two separate APIs.',
      icon: BookOpen,
      cta: 'Open API reference',
      external: true,
      onSelect: () => openExternal(PSP_API_DOC_PATH),
    },*/
  ];

  return (
    <div className="max-w-5xl mx-auto mt-8 pb-12">
      <div className="text-center mb-10">
        <div className="text-5xl mb-3">🎬</div>
        <h1 className="text-2xl font-bold text-[#001E2B] mb-2">Simulator Mode</h1>
        <p className="text-gray-600 text-sm max-w-xl mx-auto">
          Choose which part of the payment story you want to explore.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              onClick={c.onSelect}
              disabled={Boolean(c.unavailable)}
              title={c.unavailable}
              className="group text-left bg-white rounded-xl border border-gray-200 p-6 shadow-sm transition-all flex flex-col enabled:hover:shadow-lg enabled:hover:border-[#001E2B] enabled:hover:bg-[#001E2B] enabled:hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {/* On the dark hover state the icon chip inverts to green-on-dark for contrast. */}
              <div className="w-11 h-11 rounded-lg bg-[#001E2B] text-[#00ED64] flex items-center justify-center mb-4 transition-colors group-hover:bg-[#00ED64] group-hover:text-[#001E2B]">
                <Icon size={22} />
              </div>
              <h2 className="font-semibold text-[#001E2B] mb-2 transition-colors group-hover:text-white">{c.title}</h2>
              <p className="text-sm text-gray-500 flex-1 transition-colors group-hover:text-gray-300">{c.description}</p>
              {c.unavailable && (
                <span className="mt-4 text-xs text-amber-700">{c.unavailable}</span>
              )}
              <span className={`mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#001E2B] transition-colors group-hover:text-[#00ED64] ${c.unavailable ? 'hidden' : ''}`}>
                {c.cta}
                {/* The icon says which kind of click this is: onward within the demo, or out to another site. */}
                {c.external
                  ? <ExternalLink size={14} aria-label="opens in a new tab" />
                  : <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />}
              </span>
            </button>
          );
        })}
      </div>

      {/* QR for this environment's demo URL; format "link" keeps the payload verbatim. */}
      {shareTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShareTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-[#001E2B]">Share this demo</h2>
              <button type="button" onClick={() => setShareTarget(null)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <QrRepresentation encodedPayload={shareTarget} payloadFormat="link" label="Scan to open the demo" />
          </div>
        </div>
      )}

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

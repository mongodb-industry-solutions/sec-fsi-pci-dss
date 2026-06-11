'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const METHOD_LABELS: Record<string, string> = {
  'api-card': '💳 API Card',
  'redirection': '🔀 Redirection',
  'payment-link': '🔗 Payment Link',
  'insite': '🖥️ InSite',
};

export default function SimulatorLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPayment = pathname?.includes('/payment');
  const isInvestigation = pathname?.includes('/investigation');
  const [activeMethod, setActiveMethod] = useState<string | null>(null);

  useEffect(() => {
    const m = sessionStorage.getItem('sim_method');
    setActiveMethod(m);
    // Re-read whenever navigation happens (shallow update)
    const onStorage = () => setActiveMethod(sessionStorage.getItem('sim_method'));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          <span className="font-bold text-[#00ED64]">🏦 PCI DSS Demo · MongoDB</span>
          <nav className="flex gap-1">
            <Link
              href="/simulator/payment"
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                isPayment
                  ? 'bg-[#00ED64] text-[#001E2B]'
                  : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              💳 Payment
            </Link>
            <Link
              href="/simulator/investigation"
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                isInvestigation
                  ? 'bg-[#00ED64] text-[#001E2B]'
                  : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              🕵️ Investigation
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {activeMethod && METHOD_LABELS[activeMethod] && (
            <span className="text-xs text-[#00ED64] border border-[#00ED64]/40 rounded px-2 py-0.5">
              {METHOD_LABELS[activeMethod]}
            </span>
          )}
          <span className="text-xs text-gray-400 border border-gray-600 rounded px-2 py-0.5">
            Simulator Mode
          </span>
          <Link href="/simulator" className="text-xs text-gray-400 hover:text-white transition-colors">
            ← Change
          </Link>
          <Link href="/" className="text-xs text-gray-400 hover:text-white transition-colors">
            Exit
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6">{children}</main>
    </div>
  );
}

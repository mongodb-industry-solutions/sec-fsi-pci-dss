'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SimulatorLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPayment = pathname?.includes('/payment');
  const isInvestigation = pathname?.includes('/investigation');

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
          <span className="text-xs text-gray-400 border border-gray-600 rounded px-2 py-0.5">
            Simulator Mode
          </span>
          <Link href="/" className="text-xs text-gray-400 hover:text-white transition-colors">
            ← Exit
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6">{children}</main>
    </div>
  );
}

'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Building2, CreditCard, Search, ArrowLeftRight, Link2, Monitor, ChevronLeft, type LucideIcon } from 'lucide-react';

const METHOD_ICONS: Record<string, LucideIcon> = {
  'api-card': CreditCard,
  'redirection': ArrowLeftRight,
  'payment-link': Link2,
  'insite': Monitor,
};

const METHOD_LABELS: Record<string, string> = {
  'api-card': 'API Card',
  'redirection': 'Redirection',
  'payment-link': 'Payment Link',
  'insite': 'InSite',
};

export default function SimulatorLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPayment = pathname?.includes('/payment');
  const isInvestigation = pathname?.includes('/investigation');
  const [activeMethod, setActiveMethod] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'PSP - Simulator';
  }, []);

  useEffect(() => {
    const m = sessionStorage.getItem('sim_method');
    setActiveMethod(m);
    const onStorage = () => setActiveMethod(sessionStorage.getItem('sim_method'));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [pathname]);

  const MethodIcon = activeMethod ? METHOD_ICONS[activeMethod] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-3 sm:px-4 py-3 flex items-center justify-between shadow-lg gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <Building2 size={18} className="text-[#00ED64]" />
            <span className="font-bold text-[#00ED64] text-sm hidden md:block">PSP Simulator</span>
            <span className="font-bold text-[#00ED64] text-xs md:hidden">PCI DSS</span>
          </div>
          <nav className="flex gap-1">
            <Link
              href="/simulator/payment"
              className={`px-2 sm:px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${
                isPayment ? 'bg-[#00ED64] text-[#001E2B]' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              <CreditCard size={14} />
              <span className="hidden sm:block">Payment</span>
            </Link>
            <Link
              href="/simulator/investigation"
              className={`px-2 sm:px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${
                isInvestigation ? 'bg-[#00ED64] text-[#001E2B]' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              <Search size={14} />
              <span className="hidden sm:block">Investigation</span>
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {MethodIcon && activeMethod && METHOD_LABELS[activeMethod] && (
            <span className="hidden sm:flex text-xs text-[#00ED64] border border-[#00ED64]/40 rounded px-2 py-0.5 items-center gap-1">
              <MethodIcon size={11} />
              {METHOD_LABELS[activeMethod]}
            </span>
          )}
          <span className="hidden sm:inline text-xs text-gray-400 border border-gray-600 rounded px-2 py-0.5">
            Simulator
          </span>
          <Link href="/simulator" className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-white transition-colors">
            <ChevronLeft size={13} />
            <span className="hidden sm:block">Menu</span>
          </Link>
          <Link href="/" className="text-xs text-gray-400 hover:text-white transition-colors">
            Exit
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-6">{children}</main>
    </div>
  );
}

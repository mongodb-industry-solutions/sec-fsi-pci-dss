'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, ShoppingCart, Link2, Receipt, Key, Webhook, Settings, type LucideIcon,
} from 'lucide-react';
import { CarouselNav } from '../CarouselNav';

interface NavItem { href: string; label: string; icon: LucideIcon }

const ITEMS: NavItem[] = [
  { href: '/system/merchant/overview',  label: 'Overview',          icon: LayoutDashboard },
  { href: '/system/merchant/checkout',  label: 'Checkout Session',  icon: ShoppingCart },
  { href: '/system/merchant/links',     label: 'Payment Links',     icon: Link2 },
  { href: '/system/merchant/payments',  label: 'Transactions',      icon: Receipt },
  { href: '/system/merchant/api-keys',  label: 'API Keys',          icon: Key },
  { href: '/system/merchant/webhooks',  label: 'Webhook',           icon: Webhook },
  { href: '/system/merchant/settings',  label: 'Settings',          icon: Settings },
];

export function MerchantNav({ merchantName }: { merchantName?: string }) {
  const pathname = usePathname();
  return (
    <nav className="w-full md:w-56 shrink-0 md:border-r border-gray-200 md:min-h-full bg-white">
      <div className="px-4 py-4 hidden md:block">
        <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Merchant</p>
        {merchantName && <p className="text-sm font-semibold text-gray-800 truncate mt-0.5">{merchantName}</p>}
      </div>
      {/* Desktop: vertical list */}
      <ul className="hidden md:flex md:flex-col gap-1 px-2 pb-2">
        {ITEMS.map((it) => {
          const active = pathname === it.href;
          const Icon = it.icon;
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? 'bg-[#001E2B] text-[#00ED64]' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon size={16} />
                <span>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Mobile: horizontal carousel */}
      <div className="md:hidden border-b border-gray-200">
        <CarouselNav items={ITEMS} isActive={(href) => pathname === href} variant="light" />
      </div>
    </nav>
  );
}

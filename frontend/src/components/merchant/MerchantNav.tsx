'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, ShoppingCart, Link2, Receipt, Key, Webhook, Settings, Activity, ShieldCheck, Lock, ListChecks, Users, type LucideIcon,
} from 'lucide-react';
import { CarouselNav } from '../CarouselNav';
import type { MerchantPanelState } from '../../lib/merchantContext';

interface NavItem { href: string; label: string; icon: LucideIcon }

function buildItems(merchantId: string): NavItem[] {
  const base = `/system/merchant/${merchantId}`;
  return [
    { href: `${base}/overview`,  label: 'Overview',         icon: LayoutDashboard },
    { href: `${base}/checkout`,  label: 'Checkout Session', icon: ShoppingCart },
    { href: `${base}/links`,     label: 'Payment Links',    icon: Link2 },
    { href: `${base}/payments`,  label: 'Transactions',     icon: Receipt },
    { href: `${base}/api-keys`,  label: 'API Keys',         icon: Key },
    { href: `${base}/sso`,       label: 'SSO',              icon: ShieldCheck },
    { href: `${base}/webhooks`,  label: 'Webhooks',         icon: Webhook },
    { href: `${base}/events`,    label: 'Events',           icon: Activity },
    { href: `${base}/activity`,  label: 'Activity',         icon: ListChecks },
    { href: `${base}/authorizations`, label: 'Authorizations', icon: Users },
    { href: `${base}/owners`,    label: 'Owners',           icon: Users }, // v31: beneficial owners / shareholders
    { href: `${base}/settings`,  label: 'Settings',         icon: Settings },
  ];
}

export function MerchantNav({
  merchantId,
  merchantName,
  state,
}: {
  merchantId: string;
  merchantName?: string;
  state?: MerchantPanelState;
}) {
  const pathname = usePathname();
  const ITEMS = buildItems(merchantId);

  // Items are locked until the merchant reaches agreed or active status (KYB approved).
  const locked = state !== undefined && state !== 'active' && state !== 'agreed';

  return (
    <nav className="w-full md:w-56 shrink-0 md:border-r border-gray-200 md:min-h-full bg-white">
      <div className="px-4 py-4 hidden md:block">
        <Link href="/system/merchant" className="text-xs text-gray-400 hover:text-[#001E2B] transition-colors">
          ← All merchants
        </Link>
        <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mt-2">Merchant</p>
        {merchantName && <p className="text-sm font-semibold text-gray-800 truncate mt-0.5">{merchantName}</p>}
      </div>

      <ul className="hidden md:flex md:flex-col gap-1 px-2 pb-2">
        {ITEMS.map((it) => {
          const isOverview = it.href.endsWith('/overview');
          const itemLocked = locked && !isOverview;
          const active = pathname === it.href || pathname.startsWith(it.href + '/');
          const Icon = it.icon;

          if (itemLocked) {
            return (
              <li key={it.href}>
                <span
                  title="Available after KYB approval"
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 cursor-not-allowed select-none"
                >
                  <Icon size={16} />
                  <span className="flex-1">{it.label}</span>
                  <Lock size={11} className="text-gray-200" />
                </span>
              </li>
            );
          }

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

      {/* Mobile: only show unlocked items in the carousel */}
      <div className="md:hidden border-b border-gray-200">
        <CarouselNav
          items={locked ? ITEMS.filter((it) => it.href.endsWith('/overview')) : ITEMS}
          isActive={(href) => pathname === href || pathname.startsWith(href + '/')}
          variant="light"
        />
      </div>
    </nav>
  );
}

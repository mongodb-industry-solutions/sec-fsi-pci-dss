'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  BriefcaseMedical, CreditCard, Users, BarChart3, ClipboardList,
  User, PlusCircle, Store, ClipboardCheck,
  ChevronLeft, ChevronRight, Settings2, Plug,
  KeyRound, ShieldCheck, Activity, Network,
  HelpCircle, LayoutGrid, Lock, Bell,
  type LucideIcon,
} from 'lucide-react';
import { getToken, decodeToken } from '../lib/auth';
import { api } from '../lib/api';
import { useNotificationsChanged, useNotificationsStream } from '../lib/useNotificationsStream';
import { CarouselNav } from './CarouselNav';

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  exact?: boolean;
  tooltip?: string;
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  level1_analyst: [
    { label: 'Cases',        path: '/system/investigation', icon: BriefcaseMedical },
    { label: 'Transactions', path: '/system/transactions',  icon: CreditCard },
    { label: 'Users',        path: '/system/users',         icon: Users },
    { label: 'Merchants',    path: '/system/merchant',      icon: Store },
  ],
  level2_investigator: [
    { label: 'Cases',        path: '/system/investigation', icon: BriefcaseMedical },
    { label: 'Transactions', path: '/system/transactions',  icon: CreditCard },
    { label: 'Users',        path: '/system/users',         icon: Users },
    { label: 'Merchants',    path: '/system/merchant',      icon: Store },
  ],
  security_auditor: [
    { label: 'Cases',          path: '/system/investigation', icon: BriefcaseMedical },
    { label: 'Transactions',   path: '/system/transactions',  icon: CreditCard },
    { label: 'Users',          path: '/system/users',         icon: Users },
    { label: 'Audit Log',      path: '/system/audit',         icon: BarChart3 },
    { label: 'Audit Events',   path: '/system/audit-events',  icon: Activity },
    { label: 'Data Integrity', path: '/system/integrity',     icon: ShieldCheck },
    { label: 'Merchants',      path: '/system/merchant',      icon: Store },
  ],
  customer: [
    { label: 'Transactions',    path: '/system/payment/history', icon: ClipboardList },
    { label: 'New Payment',     path: '/system/payment',         icon: PlusCircle, exact: true },
    { label: 'Payment Methods', path: '/system/cards',           icon: CreditCard },
    { label: 'Notifications',   path: '/system/notifications',   icon: Bell },
    { label: 'Merchant',        path: '/system/merchant',        icon: Store },
  ],
  merchant_officer: [
    { label: 'Review Queue', path: '/system/merchant/review', icon: ClipboardCheck },
    { label: 'All Merchants',path: '/system/merchant',        icon: Store, exact: true },
  ],
  manager: [
    { label: 'Hub',           path: '/system',                       icon: Settings2,  exact: true },
    { label: 'Providers',     path: '/system/admin/providers',       icon: Plug },
    { label: 'Groups',        path: '/system/admin/providers/groups', icon: Network },
    { label: 'Modules',       path: '/system/admin/modules',         icon: LayoutGrid },
    { label: 'Domains',       path: '/system/admin/modules/domains', icon: KeyRound, tooltip: 'Authentication & authorization domains; local users and remote IdP (OIDC/SAML) role mappings' },
    { label: 'Roles & Access', path: '/system/admin/roles',          icon: Lock },
    { label: 'Audit Events',  path: '/system/audit-events',          icon: Activity },
  ],
};

// Account-level links pinned to the bottom of the sidebar, visually separated
// from the role-specific navigation above (profile + help, available to all roles).
const ACCOUNT_ITEMS: NavItem[] = [
  { label: 'My Profile',   path: '/system/profile', icon: User },
  { label: 'Help & Guide', path: '/system/help',    icon: HelpCircle },
];

function useRole() {
  const [role, setRole] = useState('');
  useEffect(() => {
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    setRole(u?.role ?? '');
  }, []);
  return role;
}

// Only ONE item is active: the most specific (longest path) that matches the current route.
// This keeps siblings independent; e.g. /system/admin/providers/groups lights "Groups" only
// (not "Providers"), and /system/admin/modules/domains lights "Domains" only (not "Modules").
function useActiveItem(items: NavItem[]) {
  const pathname = usePathname();
  let best: NavItem | null = null;
  for (const item of items) {
    const matches = item.exact
      ? pathname === item.path
      : pathname === item.path || pathname.startsWith(item.path + '/');
    if (matches && (!best || item.path.length > best.path.length)) best = item;
  }
  return (item: NavItem) => best !== null && best.path === item.path;
}

// ADR-031: live count of pending notifications (customer questions to answer) for the badge.
// Refreshes on the same signals as the top-bar bell: the same-tab "changed" event (instant when an
// item is read elsewhere) and the SSE stream (new notifications / cross-tab changes).
function useNotifCount(role: string): number {
  const [count, setCount] = useState(0);
  const [token, setToken] = useState('');
  useEffect(() => { setToken(getToken() ?? ''); }, []);

  const reload = useCallback(() => {
    if (role !== 'customer' || !token) { setCount(0); return; }
    api.notifications.list(token).then((r) => setCount(r.count)).catch(() => setCount(0));
  }, [role, token]);

  useEffect(() => { reload(); }, [reload]);
  useNotificationsChanged(reload);                                  // instant same-tab refresh on read
  useNotificationsStream(role === 'customer' ? token : '', reload); // live refresh (SSE)
  return count;
}

const SIDEBAR_KEY = 'lp-sidebar-collapsed';

/** Desktop/tablet sidebar (hidden below md breakpoint) */
export function DemoSidebar() {
  const role    = useRole();
  const items   = NAV_BY_ROLE[role] ?? [];
  const isActive = useActiveItem([...items, ...ACCOUNT_ITEMS]);
  const notifCount = useNotifCount(role);
  const [collapsed, setCollapsed] = useState(true);

  // Restore persisted preference after mount (SSR-safe).
  // Defaults to true (collapsed) when no value is saved yet.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved !== null) setCollapsed(saved === 'true');
    } catch {}
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  return (
    <aside className={`
      hidden md:flex print:hidden flex-col
      sticky top-[44px] h-[calc(100vh-44px)] flex-shrink-0
      bg-[#001E2B] border-r border-white/10
      transition-all duration-200
      ${collapsed ? 'w-12' : 'w-44'}
    `}>
      <nav className="flex-1 py-3">
        <div className="flex items-center justify-between px-3 pb-2">
          {!collapsed && (
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Menu</p>
          )}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
            className={`flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 rounded p-0.5 transition-colors ${collapsed ? 'mx-auto' : 'ml-auto'}`}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {items.map((item) => {
          const Icon   = item.icon;
          const active = isActive(item);
          return (
            <Link
              key={item.path}
              href={item.path}
              title={item.tooltip ?? item.label}
              className={`relative flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#00ED64]/10 text-[#00ED64] border-r-2 border-[#00ED64]'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {item.path === '/system/notifications' && notifCount > 0 && (
                <span className={`${collapsed ? 'absolute top-1.5 right-1.5 w-2 h-2 p-0' : 'ml-auto min-w-[18px] h-[18px] px-1'} rounded-full bg-[#00ED64] text-[#001E2B] text-[10px] font-bold flex items-center justify-center`}>
                  {collapsed ? '' : notifCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Account-level links (profile + help), separated from role navigation */}
      <div className="border-t border-white/10 py-1">
        {ACCOUNT_ITEMS.map((item) => {
          const Icon   = item.icon;
          const active = isActive(item);
          return (
            <Link
              key={item.path}
              href={item.path}
              title={item.tooltip ?? item.label}
              className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#00ED64]/10 text-[#00ED64] border-r-2 border-[#00ED64]'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </div>

      <button
        type="button"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
        className="border-t border-white/10 p-3 flex flex-col items-center gap-1.5 w-full hover:bg-white/5 transition-colors"
      >
        <div className={`overflow-hidden rounded-full shrink-0 ${collapsed ? 'w-8 h-8' : 'w-12 h-12'}`}>
          <Image
            src="/mongodb-badge.png"
            alt="MongoDB"
            width={collapsed ? 32 : 48}
            height={collapsed ? 32 : 48}
            className="opacity-80 hover:opacity-100 transition-opacity scale-110"
          />
        </div>
        {!collapsed && (
          <span className="text-[10px] text-gray-500 tracking-wide text-center leading-tight">
            Built on<br />MongoDB Atlas
          </span>
        )}
      </button>
    </aside>
  );
}

/** Mobile bottom tab bar (visible below md breakpoint only) */
export function MobileBottomNav() {
  const role     = useRole();
  // Append the account-level Profile link (pulled out of the per-role lists for
  // the desktop sidebar) so it stays reachable on mobile.
  const items    = role ? [...(NAV_BY_ROLE[role] ?? []), ACCOUNT_ITEMS[0]] : [];
  const isActive = useActiveItem(items);

  if (items.length === 0) return null;

  return (
    <nav className="md:hidden print:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#001E2B] border-t border-white/10">
      <CarouselNav
        items={items.map((item) => ({ href: item.path, label: item.label, icon: item.icon }))}
        isActive={(href) => {
          const item = items.find((i) => i.path === href);
          return item ? isActive(item) : false;
        }}
        variant="dark"
      />
    </nav>
  );
}

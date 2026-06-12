'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BriefcaseMedical, CreditCard, Users, BarChart3, ClipboardList,
  User, PlusCircle, Store, ClipboardCheck,
  ChevronLeft, ChevronRight, Settings2, Plug,
  ShieldAlert, ScanLine, UserCheck, Building2, AlertTriangle,
  Zap, KeyRound,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';
import { getToken, decodeToken } from '../lib/auth';

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  exact?: boolean;
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  level1_analyst: [
    { label: 'Cases',        path: '/system/investigation', icon: BriefcaseMedical },
    { label: 'Transactions', path: '/system/transactions',  icon: CreditCard },
    { label: 'Users',        path: '/system/users',         icon: Users },
    { label: 'Merchant',     path: '/system/merchant',      icon: Store },
    { label: 'My Profile',   path: '/system/profile',       icon: User },
  ],
  level2_investigator: [
    { label: 'Cases',        path: '/system/investigation', icon: BriefcaseMedical },
    { label: 'Transactions', path: '/system/transactions',  icon: CreditCard },
    { label: 'Users',        path: '/system/users',         icon: Users },
    { label: 'Merchant',     path: '/system/merchant',      icon: Store },
    { label: 'My Profile',   path: '/system/profile',       icon: User },
  ],
  security_auditor: [
    { label: 'Cases',        path: '/system/investigation', icon: BriefcaseMedical },
    { label: 'Transactions', path: '/system/transactions',  icon: CreditCard },
    { label: 'Users',        path: '/system/users',         icon: Users },
    { label: 'Audit Log',    path: '/system/audit',         icon: BarChart3 },
    { label: 'Merchant',     path: '/system/merchant',      icon: Store },
    { label: 'My Profile',   path: '/system/profile',       icon: User },
  ],
  customer: [
    { label: 'Transactions', path: '/system/payment/history', icon: ClipboardList },
    { label: 'New Payment',  path: '/system/payment',         icon: PlusCircle, exact: true },
    { label: 'Merchant',     path: '/system/merchant',        icon: Store },
    { label: 'Profile',      path: '/system/profile',         icon: User },
  ],
  merchant_officer: [
    { label: 'Review Queue', path: '/system/merchant/review', icon: ClipboardCheck },
    { label: 'All Merchants',path: '/system/merchant',        icon: Store, exact: true },
    { label: 'My Profile',   path: '/system/profile',         icon: User },
  ],
  manager: [
    { label: 'Hub',             path: '/system',                          icon: Settings2,    exact: true },
    { label: 'Registry',        path: '/system/admin/integrations',       icon: Plug,         exact: true },
    { label: 'Fraud Detection', path: '/system/admin/fraud-detection',    icon: ShieldAlert },
    { label: 'HRP / Sanctions', path: '/system/admin/hrp',                icon: ScanLine },
    { label: 'KYC / Identity',  path: '/system/admin/kyc',                icon: UserCheck },
    { label: 'KYB / Business',  path: '/system/admin/kyb',                icon: Building2 },
    { label: 'AML Monitoring',  path: '/system/admin/aml',                icon: AlertTriangle },
    { label: 'Credit Bureau',   path: '/system/admin/credit-bureau',      icon: CreditCard },
    { label: 'Card Auth',       path: '/system/admin/card-authorization', icon: Zap },
    { label: 'Card Issuer',     path: '/system/admin/card-issuer',        icon: KeyRound },
    { label: '+ Register',      path: '/system/admin/integrations/new',   icon: PlusCircle },
  ],
};

function useRole() {
  const [role, setRole] = useState('');
  useEffect(() => {
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    setRole(u?.role ?? '');
  }, []);
  return role;
}

function useActiveItem() {
  const pathname = usePathname();
  return (item: NavItem) =>
    item.exact ? pathname === item.path : pathname === item.path || pathname.startsWith(item.path + '/');
}

/** Desktop/tablet sidebar (hidden below md breakpoint) */
export function DemoSidebar() {
  const role    = useRole();
  const items   = NAV_BY_ROLE[role] ?? [];
  const isActive = useActiveItem();
  const [collapsed, setCollapsed] = useState(true);

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
            onClick={() => setCollapsed(c => !c)}
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
              title={item.label}
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
      </nav>

      {/* Universal Help link, visible to all roles */}
      <div className="px-2 pb-1">
        <Link
          href="/system/help"
          title="Help & PCI DSS Guide"
          className={`flex items-center gap-2.5 px-2 py-2 text-sm font-medium rounded-lg transition-colors text-gray-500 hover:text-white hover:bg-white/5`}
        >
          <HelpCircle size={15} className="shrink-0" />
          {!collapsed && <span className="truncate text-xs">Help & Guide</span>}
        </Link>
      </div>

      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
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
  const items    = NAV_BY_ROLE[role] ?? [];
  const isActive = useActiveItem();

  if (items.length === 0) return null;

  return (
    <nav className="md:hidden print:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#001E2B] border-t border-white/10 flex">
      {items.map((item) => {
        const Icon   = item.icon;
        const active = isActive(item);
        return (
          <Link
            key={item.path}
            href={item.path}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              active ? 'text-[#00ED64]' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icon size={20} className="shrink-0" />
            <span className="truncate max-w-[56px] text-center leading-tight">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

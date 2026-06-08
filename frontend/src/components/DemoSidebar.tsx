'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BriefcaseMedical,
  CreditCard,
  Users,
  BarChart3,
  ClipboardList,
  User,
  PlusCircle,
  ChevronLeft,
  ChevronRight,
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
    { label: 'Cases',        path: '/demo/investigation', icon: BriefcaseMedical },
    { label: 'Transactions', path: '/demo/transactions',  icon: CreditCard },
    { label: 'Users',        path: '/demo/users',         icon: Users },
    { label: 'My Profile',   path: '/demo/profile',       icon: User },
  ],
  level2_investigator: [
    { label: 'Cases',        path: '/demo/investigation', icon: BriefcaseMedical },
    { label: 'Transactions', path: '/demo/transactions',  icon: CreditCard },
    { label: 'Users',        path: '/demo/users',         icon: Users },
    { label: 'My Profile',   path: '/demo/profile',       icon: User },
  ],
  security_auditor: [
    { label: 'Cases',        path: '/demo/investigation', icon: BriefcaseMedical },
    { label: 'Transactions', path: '/demo/transactions',  icon: CreditCard },
    { label: 'Users',        path: '/demo/users',         icon: Users },
    { label: 'Audit Log',    path: '/demo/audit',         icon: BarChart3 },
    { label: 'My Profile',   path: '/demo/profile',       icon: User },
  ],
  customer: [
    { label: 'My Transactions', path: '/demo/payment/history', icon: ClipboardList },
    { label: 'New Payment',     path: '/demo/payment',         icon: PlusCircle, exact: true },
    { label: 'My Profile',      path: '/demo/profile',         icon: User },
  ],
};

export function DemoSidebar() {
  const pathname = usePathname();
  const [role, setRole] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    setRole(u?.role ?? '');
  }, []);

  const items = NAV_BY_ROLE[role] ?? [];

  function isActive(item: NavItem) {
    if (item.exact) return pathname === item.path;
    return pathname === item.path || pathname.startsWith(item.path + '/');
  }

  return (
    <aside className={`flex-shrink-0 bg-[#001E2B] flex flex-col border-r border-white/10 transition-all duration-200 ${collapsed ? 'w-12' : 'w-44'}`}>
      <nav className="flex-1 py-3">
        <div className="flex items-center justify-between px-3 pb-2">
          {!collapsed && (
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Menu
            </p>
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
          const Icon = item.icon;
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

      {/* MongoDB brand footer */}
      <div className="border-t border-white/10 p-3 flex flex-col items-center gap-1.5">
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
      </div>
    </aside>
  );
}

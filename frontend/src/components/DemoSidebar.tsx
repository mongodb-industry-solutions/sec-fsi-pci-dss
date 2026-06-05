'use client';
import Link from 'next/link';
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
    <aside className="flex-shrink-0 bg-[#001E2B] flex flex-col border-r border-white/10 w-12 md:w-44">
      <nav className="flex-1 py-3 md:py-4">
        {/* Section label only on wider screens */}
        <p className="hidden md:block px-4 pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Menu
        </p>
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item);
          return (
            <Link
              key={item.path}
              href={item.path}
              title={item.label}
              className={`flex items-center gap-2.5 px-3 md:px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#00ED64]/10 text-[#00ED64] border-r-2 border-[#00ED64]'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              {/* Label hidden on small screens, visible on md+ */}
              <span className="hidden md:block truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getToken, decodeToken } from '../lib/auth';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  exact?: boolean;
}

const NAV_BY_ROLE: Record<string, NavItem[]> = {
  level1_analyst: [
    { label: 'Cases',        path: '/demo/investigation', icon: '📋' },
    { label: 'Transactions', path: '/demo/transactions',  icon: '💳' },
    { label: 'Users',        path: '/demo/users',         icon: '👥' },
    { label: 'My Profile',   path: '/demo/profile',       icon: '👤' },
  ],
  level2_investigator: [
    { label: 'Cases',        path: '/demo/investigation', icon: '📋' },
    { label: 'Transactions', path: '/demo/transactions',  icon: '💳' },
    { label: 'Users',        path: '/demo/users',         icon: '👥' },
    { label: 'My Profile',   path: '/demo/profile',       icon: '👤' },
  ],
  security_auditor: [
    { label: 'Cases',        path: '/demo/investigation', icon: '📋' },
    { label: 'Transactions', path: '/demo/transactions',  icon: '💳' },
    { label: 'Users',        path: '/demo/users',         icon: '👥' },
    { label: 'Audit Log',    path: '/demo/audit',         icon: '📊' },
    { label: 'My Profile',   path: '/demo/profile',       icon: '👤' },
  ],
  customer: [
    { label: 'My Transactions', path: '/demo/payment/history', icon: '💳' },
    { label: 'New Payment',     path: '/demo/payment',         icon: '+', exact: true },
    { label: 'My Profile',      path: '/demo/profile',         icon: '👤' },
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
    <aside className="w-44 flex-shrink-0 bg-[#001E2B] flex flex-col border-r border-white/10">
      <nav className="flex-1 py-4">
        <p className="px-4 pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Menu</p>
        {items.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive(item)
                ? 'bg-[#00ED64]/10 text-[#00ED64] border-r-2 border-[#00ED64]'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="text-base leading-none w-5 text-center">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

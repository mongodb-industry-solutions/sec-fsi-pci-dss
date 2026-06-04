'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ADMIN_TOKEN_KEY } from '../../../lib/adminHelpers';

const TABS = [
  { path: '/admin/panel/setup',    label: 'Setup Commands', icon: '📦' },
  { path: '/admin/panel/terminal', label: 'Terminal',        icon: '>' },
  { path: '/admin/panel/logs',     label: 'Server Logs',    icon: '📋' },
  { path: '/admin/panel/info',     label: 'System Info',    icon: 'ℹ️' },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (!t) { router.push('/admin'); return; }
    setReady(true);
  }, [router]);

  if (!ready) return <div className="text-center py-12 text-gray-500">Redirecting...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage demo environment setup and monitoring</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Back to Home
          </Link>
          <button
            onClick={() => { sessionStorage.removeItem(ADMIN_TOKEN_KEY); router.push('/admin'); }}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((tab) => (
          <Link
            key={tab.path}
            href={tab.path}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-1.5 ${
              pathname === tab.path
                ? 'bg-gray-800 text-orange-400 border-b-2 border-orange-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <span>{tab.icon}</span> {tab.label}
          </Link>
        ))}
      </div>

      {children}
    </div>
  );
}

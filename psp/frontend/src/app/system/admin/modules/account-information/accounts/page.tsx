'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// v29.1: the standalone accounts table was unified into the account-information module page as the
// "Accounts" tab. This legacy subroute now redirects there so existing links keep working.
export default function AccountsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/system/admin/modules/account-information?tab=accounts');
  }, [router]);
  return <div className="w-full px-5 py-8 text-sm text-gray-400">Redirecting…</div>;
}

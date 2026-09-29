'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// v29.1: the standalone card table was unified into the card-issuer module page as the "Cards" tab.
// This legacy subroute now redirects there so existing links keep working.
export default function CardsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/system/admin/modules/card-issuer?tab=cards');
  }, [router]);
  return <div className="w-full px-5 py-8 text-sm text-gray-400">Redirecting…</div>;
}

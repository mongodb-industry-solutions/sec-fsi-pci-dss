'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Legacy route. The integrations registry moved to the canonical providers tree.
export default function LegacyIntegrationsListRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/system/admin/providers'); }, [router]);
  return null;
}

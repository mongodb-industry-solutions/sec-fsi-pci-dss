'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Legacy route. Registering a provider moved to the canonical providers tree. The query string
// (e.g. ?type=card_issuer) is preserved so deep links from the category pages keep working.
export default function LegacyRegisterProviderRedirect() {
  const router = useRouter();
  useEffect(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    router.replace(`/system/admin/providers/vendors/new${search}`);
  }, [router]);
  return null;
}

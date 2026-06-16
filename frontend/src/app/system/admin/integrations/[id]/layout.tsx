'use client';
import { useEffect } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';

// Legacy route. The integration detail pages moved to the canonical providers tree
// (/system/admin/providers/vendors/[id]/*). This layout returns null (so the old child pages
// never render) and redirects the whole subtree, preserving the active tab. Any deep link to
// /system/admin/integrations/<id>/<tab> lands on the matching providers/vendors page.
export default function LegacyIntegrationRedirectLayout() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const tab = pathname.split(`/integrations/${id}`)[1] || '/overview';
    router.replace(`/system/admin/providers/vendors/${id}${tab}`);
  }, [id, pathname, router]);

  return null;
}

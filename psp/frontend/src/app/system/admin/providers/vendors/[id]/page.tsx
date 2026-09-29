'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function IntegrationRootPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/system/admin/providers/vendors/${id}/overview`);
  }, [id, router]);
  return null;
}

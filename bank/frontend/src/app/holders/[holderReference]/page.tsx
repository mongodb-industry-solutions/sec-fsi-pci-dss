import { Suspense } from 'react';
import { HolderDetail } from '../../../components/holders/HolderDetail';

export const metadata = { title: 'Party' };

export default async function HolderPage({ params }: { params: Promise<{ holderReference: string }> }) {
  const { holderReference } = await params;
  return (
    <Suspense fallback={<p className="py-8 text-sm text-ink-soft">Reading the party…</p>}>
      <HolderDetail holderReference={decodeURIComponent(holderReference)} />
    </Suspense>
  );
}

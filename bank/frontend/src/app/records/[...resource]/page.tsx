import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageTitle } from '../../../components/Tiles';
import { RecordsBrowser } from '../../../components/records/RecordsBrowser';
// From the plain module rather than the browser component: this runs on the server, and shared values it reads
// should not be reached through a `'use client'` boundary.
import { RESOURCES } from '../../../components/records/resources';

// One of the bank's administrative record sets.
//
// A CATCH-ALL segment, and that is the point of this route's shape. The bank's resources have paths with slashes
// in them, `tpp/deliveries` among them, and a single dynamic segment could only carry that percent-encoded: the
// address bar read `/records/tpp%2Fdeliveries`, which is not an address anybody would type or recognise. With a
// catch-all the URL is `/records/tpp/deliveries`, which is the resource's own name.

export async function generateMetadata({ params }: { params: Promise<{ resource: string[] }> }) {
  const { resource } = await params;
  return { title: RESOURCES[resource.join('/')]?.title ?? 'Records' };
}

export default async function RecordsPage({ params }: { params: Promise<{ resource: string[] }> }) {
  const { resource } = await params;
  // Decoded per segment: a reference inside a path may legitimately be encoded even when the resource is not.
  const path = resource.map((segment) => decodeURIComponent(segment)).join('/');
  const meta = RESOURCES[path];
  // An unknown resource is a 404 rather than an empty list. The bank would refuse it anyway, since only its
  // administrative resources are reachable, and a screen saying "no records" would blame the data.
  if (!meta) notFound();

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft size={14} aria-hidden /> Administration
      </Link>

      <PageTitle title={meta.title} description={meta.description} />

      <Suspense fallback={<p className="text-sm text-ink-soft">Reading the records…</p>}>
        <RecordsBrowser resource={path} />
      </Suspense>
    </div>
  );
}

'use client';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

export interface Crumb {
  label: string;
  href?: string; // omit on the current (last) item
}

// Reusable navigation breadcrumb for investigation flows. It only renders labels and links
// to routes the caller can already open; it never carries or displays sensitive data, so it
// is safe across roles (PCI DSS: navigation context only). The first item shows a home icon.
export function Breadcrumb({ items }: { items: Crumb[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-gray-500 flex-wrap">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight size={13} className="text-gray-300 shrink-0" />}
            {item.href && !last ? (
              <Link href={item.href} className="inline-flex items-center gap-1 hover:text-[#001E2B] hover:underline transition-colors truncate">
                {i === 0 && <Home size={13} className="shrink-0" />}
                <span className="truncate">{item.label}</span>
              </Link>
            ) : (
              <span className={`inline-flex items-center gap-1 truncate ${last ? 'text-gray-800 font-medium' : ''}`} aria-current={last ? 'page' : undefined}>
                {i === 0 && <Home size={13} className="shrink-0" />}
                <span className="truncate">{item.label}</span>
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

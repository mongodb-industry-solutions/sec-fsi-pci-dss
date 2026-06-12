'use client';
import { useState } from 'react';

/**
 * Returns the URL query params captured ONCE on first client render.
 * Used by listing pages to prefill filters/search from a shareable URL and
 * auto-run the search. Reads window.location.search directly (client-only) to
 * avoid the Suspense requirement of next/navigation's useSearchParams during
 * static prerender. Returns empty params on the server.
 */
export function useInitialQueryParams(): URLSearchParams {
  const [params] = useState(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams(),
  );
  return params;
}

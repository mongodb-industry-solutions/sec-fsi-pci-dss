'use client';
import { useCallback, useEffect, useState } from 'react';

// Lightweight stale-while-revalidate client cache. Investigation pages fetch in useEffect and
// blank to a "Loading…" state on every mount, so breadcrumb back-navigation (to pages already
// visited) flashes. This module-level cache lets a revisit render instantly from cache and
// revalidate in the background — no extra dependency (no SWR/react-query). Cache is per-tab
// (in-memory) and keyed by a caller-supplied string (include role/token-scope in the key when
// the response is role-dependent, so two roles never share an entry).

interface Entry { data: unknown; ts: number }
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export function mutateResource(key: string, data: unknown): void {
  cache.set(key, { data, ts: Date.now() });
}

export function prefetchResource<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fetcher()
    .then((d) => { cache.set(key, { data: d, ts: Date.now() }); inflight.delete(key); return d; })
    .catch((e) => { inflight.delete(key); throw e; });
  inflight.set(key, p);
  return p;
}

export interface UseResourceResult<T> {
  data: T | undefined;
  loading: boolean;     // true only when there is nothing cached to show yet
  revalidating: boolean; // true while a background refresh is in flight
  error: unknown;
  revalidate: () => Promise<void>;
  mutate: (data: T) => void;
}

export function useResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts?: { ttlMs?: number },
): UseResourceResult<T> {
  const ttlMs = opts?.ttlMs ?? 30_000;
  const initial = key ? (cache.get(key) as Entry | undefined) : undefined;
  const [data, setData] = useState<T | undefined>(initial?.data as T | undefined);
  const [loading, setLoading] = useState<boolean>(!initial);
  const [revalidating, setRevalidating] = useState<boolean>(false);
  const [error, setError] = useState<unknown>(null);

  const revalidate = useCallback(async () => {
    if (!key) return;
    setRevalidating(true);
    try {
      const fresh = await prefetchResource(key, fetcher);
      setData(fresh as T);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setRevalidating(false);
      setLoading(false);
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!key) { setLoading(false); return; }
    const c = cache.get(key) as Entry | undefined;
    if (c) {
      setData(c.data as T);
      setLoading(false);
      if (Date.now() - c.ts > ttlMs) void revalidate(); // stale → refresh silently
    } else {
      setLoading(true);
      void revalidate();
    }
  }, [key, revalidate, ttlMs]);

  return {
    data,
    loading,
    revalidating,
    error,
    revalidate,
    mutate: (d: T) => { if (key) mutateResource(key, d); setData(d); },
  };
}

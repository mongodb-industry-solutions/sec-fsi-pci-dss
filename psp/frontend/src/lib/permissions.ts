'use client';
import { useEffect, useState } from 'react';
import { api, type EffectivePermissions } from './api';
import { getToken } from './auth';
import { hasPermission } from '../config/acl';

// ADR-030: fetch the caller's effective permissions once and reuse across components.
// Cached per token so a role/permission change (or a re-login as another user) refetches.
let cache: { token: string; data: EffectivePermissions } | null = null;

export function clearPermissionsCache() { cache = null; }

export function useEffectivePermissions(): {
  perms: EffectivePermissions | null;
  loading: boolean;
  can: (resource: string, action: string) => boolean;
} {
  const token = (typeof window !== 'undefined' ? getToken() : '') ?? '';
  const [perms, setPerms] = useState<EffectivePermissions | null>(
    cache && cache.token === token ? cache.data : null,
  );
  const [loading, setLoading] = useState(!(cache && cache.token === token));

  useEffect(() => {
    if (!token) { setPerms(null); setLoading(false); return; }
    if (cache && cache.token === token) { setPerms(cache.data); setLoading(false); return; }
    let active = true;
    setLoading(true);
    api.acl.effective(token)
      .then((d) => { cache = { token, data: d }; if (active) { setPerms(d); setLoading(false); } })
      .catch(() => { if (active) { setPerms(null); setLoading(false); } });
    return () => { active = false; };
  }, [token]);

  return { perms, loading, can: (resource, action) => hasPermission(perms?.permissions, resource, action) };
}

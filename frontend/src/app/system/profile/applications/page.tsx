'use client';
// v18 D-04/D-05/D-09 + v23: "Authorized Applications" — the user's connected apps (GitHub/Google style).
// Lists the merchant apps the user authorized via OIDC: logo, name, approval date/time, scope summary,
// last use and status. Self-scoped (the caller's own `sub`). Search + status filter + pagination.
// Revoke is a SOFT action: a revoked app stays listed so the user can still review its past data and
// operations, and RE-APPROVE it (reverting the revocation) from this same view.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Layers, Search, Trash2, RotateCcw, ChevronRight } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { Pagination } from '../../../../components/Pagination';
import { api, type ConsentGrant } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';

const LIMIT_OPTIONS = [10, 25, 50];
type StatusFilter = 'all' | 'active' | 'revoked';

// Merchant logo with graceful fallback to the initial (OIDC logo_uri is optional / may fail to load).
function AppLogo({ name, logoUri, size = 40, muted = false }: { name: string; logoUri?: string | null; size?: number; muted?: boolean }) {
  const [broken, setBroken] = useState(false);
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  if (logoUri && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- remote merchant logo, arbitrary origin
    return <img src={logoUri} alt="" width={size} height={size} onError={() => setBroken(true)}
      className={`rounded-lg object-contain bg-white border border-gray-100 shrink-0 ${muted ? 'opacity-50 grayscale' : ''}`} style={{ width: size, height: size }} />;
  }
  return (
    <span className={`rounded-lg bg-[#001E2B]/10 text-[#001E2B] flex items-center justify-center font-bold shrink-0 ${muted ? 'opacity-60 grayscale' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}>{initial}</span>
  );
}

export default function AuthorizedApplicationsPage() {
  const confirm = useConfirm();
  const notify = useNotify();
  const [token, setToken] = useState('');
  const [grants, setGrants] = useState<ConsentGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) { setLoading(false); return; }
    // Fetch ALL (active + revoked); revoked apps remain visible for audit / re-approval.
    api.consentGrants.list(t, 'all')
      .then((r) => setGrants(r.grants))
      .catch(() => setGrants([]))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => ({
    all: grants.length,
    active: grants.filter((g) => g.consentStatus === 'active').length,
    revoked: grants.filter((g) => g.consentStatus === 'revoked').length,
  }), [grants]);

  // Client-side status filter + search (the list is bounded per user).
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return grants.filter((g) => {
      if (statusFilter !== 'all' && g.consentStatus !== statusFilter) return false;
      if (!needle) return true;
      return g.merchantName.toLowerCase().includes(needle)
        || g.grantedScopes.some((s) => s.toLowerCase().includes(needle));
    });
  }, [grants, q, statusFilter]);

  useEffect(() => { setPage(1); }, [q, limit, statusFilter]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pageRows = filtered.slice((page - 1) * limit, page * limit);

  async function revoke(grant: ConsentGrant) {
    const ok = await confirm({
      title: `Revoke access for "${grant.merchantName}"?`,
      // Soft-revoke: the grant stays listed (Revoked) so past operations remain attributable and the
      // user can re-approve later. Tokens are invalidated immediately.
      message: 'This immediately invalidates its tokens. The app stays in your list as “Revoked”, so you can still review its past activity or re-approve it later.',
      confirmLabel: 'Revoke access',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(grant.consentId);
    try {
      await api.consentGrants.revoke(grant.consentId, token);
      // Keep it in the list; flip status + stamp revocation time (optimistic).
      setGrants((gs) => gs.map((x) => x.consentId === grant.consentId
        ? { ...x, consentStatus: 'revoked', consentRevokedAt: new Date().toISOString() } : x));
      notify(`Access revoked for ${grant.merchantName}.`, 'success');
    } catch {
      notify('Could not revoke access. Please try again.', 'error');
    }
    setBusy(null);
  }

  async function reapprove(grant: ConsentGrant) {
    const ok = await confirm({
      title: `Re-approve "${grant.merchantName}"?`,
      message: 'This restores your earlier authorization and its previously granted permissions. The app will be able to reconnect; you can revoke again at any time.',
      confirmLabel: 'Re-approve',
      tone: 'default',
    });
    if (!ok) return;
    setBusy(grant.consentId);
    try {
      await api.consentGrants.reactivate(grant.consentId, token);
      setGrants((gs) => gs.map((x) => x.consentId === grant.consentId
        ? { ...x, consentStatus: 'active', consentRevokedAt: null } : x));
      notify(`Access re-approved for ${grant.merchantName}.`, 'success');
    } catch {
      notify('Could not re-approve. Please try again.', 'error');
    }
    setBusy(null);
  }

  const FILTERS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'active', label: `Active (${counts.active})` },
    { key: 'revoked', label: `Revoked (${counts.revoked})` },
  ];

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Layers}
        title="Authorized Applications"
        description="Apps and merchants you have authorized to access your account via OIDC. Review activity, revoke, or re-approve access at any time."
        debugInfo="SD-16 · ConsentGrant · OAuth 2.0 / OIDC · PCI DSS Req 7 (least privilege) · soft-revoke (audit) · self-scoped (sub)"
      />

      {/* Filters + search */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <div className="relative max-w-md">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by app name or scope…"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </div>
        <div className="flex gap-1 shrink-0" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={statusFilter === f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                statusFilter === f.key
                  ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading authorized apps…</div>
        ) : pageRows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">
            <Layers size={30} className="mx-auto mb-3 opacity-30" />
            {grants.length === 0 ? 'No authorized applications.' : 'No apps match your filters.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pageRows.map((grant) => {
              const revoked = grant.consentStatus === 'revoked';
              return (
                <li key={grant.consentId} className="px-5 py-3 flex items-center gap-3">
                  <Link href={`/system/applications/${encodeURIComponent(grant.consentId)}`}
                    className="flex items-center gap-3 flex-1 min-w-0 group">
                    <AppLogo name={grant.merchantName} logoUri={grant.oauthLogoUri} muted={revoked} />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-gray-800 group-hover:text-[#001E2B] truncate flex items-center gap-2">
                        {grant.merchantName}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          revoked ? 'bg-gray-100 text-gray-500 border border-gray-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                          {revoked ? 'Revoked' : 'Active'}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {grant.grantedScopes.slice(0, 4).map((scope) => (
                          <span key={scope} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{scope}</span>
                        ))}
                        {grant.grantedScopes.length > 4 && (
                          <span className="text-[10px] text-gray-400">+{grant.grantedScopes.length - 4} more</span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Approved {new Date(grant.consentGrantedAt).toLocaleString()}
                        {grant.lastUsedAt && ` · Last used ${new Date(grant.lastUsedAt).toLocaleDateString()}`}
                        {revoked && grant.consentRevokedAt && ` · Revoked ${new Date(grant.consentRevokedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                  </Link>
                  {revoked ? (
                    <button
                      onClick={() => reapprove(grant)}
                      disabled={busy === grant.consentId}
                      className="flex items-center gap-1 text-xs text-green-700 hover:text-green-800 border border-green-200 hover:border-green-400 rounded-lg px-2 py-1 disabled:opacity-50 shrink-0">
                      <RotateCcw size={12} />{busy === grant.consentId ? 'Re-approving…' : 'Re-approve'}
                    </button>
                  ) : (
                    <button
                      onClick={() => revoke(grant)}
                      disabled={busy === grant.consentId}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded-lg px-2 py-1 disabled:opacity-50 shrink-0">
                      <Trash2 size={12} />{busy === grant.consentId ? 'Revoking…' : 'Revoke'}
                    </button>
                  )}
                  <ChevronRight size={16} className="text-gray-300 shrink-0" />
                </li>
              );
            })}
          </ul>
        )}

        {!loading && total > 0 && (
          <div className="px-3 py-2 border-t border-gray-100">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={(l) => { setLimit(l); setPage(1); }}
              limitOptions={LIMIT_OPTIONS}
              noun="apps"
            />
          </div>
        )}
      </div>
    </div>
  );
}

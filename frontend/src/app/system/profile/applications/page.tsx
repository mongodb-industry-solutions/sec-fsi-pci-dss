'use client';
// v18 D-04/D-05/D-09: "Authorized Applications" — the user's connected apps (GitHub/Google style).
// Lists the merchant apps the user authorized via OIDC: logo, name, approval date/time, scope
// summary, last use and status. Self-scoped (the caller's own `sub`). Search + standard pagination.
// Revoke per app (DELETE) with confirmation + optimistic refresh.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Layers, Search, Trash2, ChevronRight } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { Pagination } from '../../../../components/Pagination';
import { api, type ConsentGrant } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';

const LIMIT_OPTIONS = [10, 25, 50];

// Merchant logo with graceful fallback to the initial (OIDC logo_uri is optional / may fail to load).
function AppLogo({ name, logoUri, size = 40 }: { name: string; logoUri?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  if (logoUri && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- remote merchant logo, arbitrary origin
    return <img src={logoUri} alt="" width={size} height={size} onError={() => setBroken(true)}
      className="rounded-lg object-contain bg-white border border-gray-100 shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span className="rounded-lg bg-[#001E2B]/10 text-[#001E2B] flex items-center justify-center font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}>{initial}</span>
  );
}

export default function AuthorizedApplicationsPage() {
  const confirm = useConfirm();
  const notify = useNotify();
  const [token, setToken] = useState('');
  const [grants, setGrants] = useState<ConsentGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) { setLoading(false); return; }
    api.consentGrants.list(t)
      .then((r) => setGrants(r.grants))
      .catch(() => setGrants([]))
      .finally(() => setLoading(false));
  }, []);

  // Client-side filter (the list is bounded per user) + pagination via the shared component.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return grants;
    return grants.filter((g) =>
      g.merchantName.toLowerCase().includes(needle) ||
      g.grantedScopes.some((s) => s.toLowerCase().includes(needle)));
  }, [grants, q]);

  useEffect(() => { setPage(1); }, [q, limit]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pageRows = filtered.slice((page - 1) * limit, page * limit);

  async function revoke(grant: ConsentGrant) {
    const ok = await confirm({
      title: `Revoke access for "${grant.merchantName}"?`,
      // The grant is soft-revoked (kept in the DB), so past operations stay attributable to this app.
      message: 'This immediately invalidates its tokens. Transactions already made through this app remain recorded and linked to it for audit.',
      confirmLabel: 'Revoke access',
      tone: 'danger',
    });
    if (!ok) return;
    setRevoking(grant.consentId);
    try {
      await api.consentGrants.revoke(grant.consentId, token);
      setGrants((g) => g.filter((x) => x.consentId !== grant.consentId)); // optimistic refresh
      notify(`Access revoked for ${grant.merchantName}.`, 'success');
    } catch {
      notify('Could not revoke access. Please try again.', 'error');
    }
    setRevoking(null);
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Layers}
        title="Authorized Applications"
        description="Apps and merchants you have authorized to access your account via OIDC. Review and revoke access at any time."
        debugInfo="SD-16 · ConsentGrant · OAuth 2.0 / OIDC · PCI DSS Req 7 (least privilege) · self-scoped (sub)"
      />

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <label className="block text-xs text-gray-500 mb-1">Search</label>
        <div className="relative max-w-md">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by app name or scope…"
            className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading authorized apps…</div>
        ) : pageRows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">
            <Layers size={30} className="mx-auto mb-3 opacity-30" />
            {grants.length === 0 ? 'No active authorized applications.' : 'No apps match your search.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pageRows.map((grant) => (
              <li key={grant.consentId} className="px-5 py-3 flex items-center gap-3">
                <Link href={`/system/applications/${encodeURIComponent(grant.consentId)}`}
                  className="flex items-center gap-3 flex-1 min-w-0 group">
                  <AppLogo name={grant.merchantName} logoUri={grant.oauthLogoUri} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-800 group-hover:text-[#001E2B] truncate">{grant.merchantName}</p>
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
                      {grant.consentStatus !== 'active' && ` · ${grant.consentStatus}`}
                    </p>
                  </div>
                </Link>
                <button
                  onClick={() => revoke(grant)}
                  disabled={revoking === grant.consentId}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded-lg px-2 py-1 disabled:opacity-50 shrink-0">
                  <Trash2 size={12} />{revoking === grant.consentId ? 'Revoking…' : 'Revoke'}
                </button>
                <ChevronRight size={16} className="text-gray-300 shrink-0" />
              </li>
            ))}
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

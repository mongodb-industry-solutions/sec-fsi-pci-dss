'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Search, RefreshCw, ArrowRight } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Pagination } from '../../../../../components/Pagination';
import { useRequireActiveMerchant } from '../../../../../lib/merchantContext';
import { api } from '../../../../../lib/api';

// v18 B-10/B-11: users who authorized this merchant (OAuth consent grants, SD-16). Display-safe.
// Standard filter/search/pagination; each row links to that user's activity (filtered).
type AuthorizationRow = {
  consentId: string;
  partyAuthenticationInstanceReference: string;
  userName?: string;
  userEmail?: string;
  grantedScopes: string[];
  consentStatus: 'active' | 'revoked';
  consentGrantedAt: string;
  lastUsedAt?: string | null;
};

const LIMIT_OPTIONS = [10, 25, 50];

export default function MerchantAuthorizationsPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [rows, setRows] = useState<AuthorizationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const reload = useCallback(async () => {
    if (!merchantId || !token) return;
    setLoading(true);
    try {
      const r = await api.merchants.authorizations(merchantId, { q: q || undefined, page, limit }, token);
      setRows(r.authorizations);
      setTotal(r.total);
    } catch { setRows([]); setTotal(0); }
    setLoading(false);
  }, [merchantId, token, q, page, limit]);

  useEffect(() => { setPage(1); }, [q, limit]);
  useEffect(() => { reload(); }, [reload]);

  if (!merchant) return null;

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={Users}
        title="Authorizations"
        description="Users who authorized this merchant's app via SSO (OAuth consent grants)."
        debugInfo="partyAuthConsent (SD-16 ConsentGrant) · PCI DSS Req 10 · display-safe"
      />

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs text-gray-500 mb-1">Search user</label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Name, email or party reference…"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </div>
        <button onClick={reload}
          className="text-xs px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors inline-flex items-center gap-1">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">
            <Users size={30} className="mx-auto mb-3 opacity-30" />
            No users have authorized this merchant yet.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((row) => (
              <li key={row.consentId} className="px-5 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800 truncate">{row.userName || row.userEmail || 'Unknown user'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${row.consentStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{row.consentStatus}</span>
                  </div>
                  {row.userEmail
                    ? <p className="text-xs text-gray-400">{row.userEmail}</p>
                    : <p className="text-xs text-gray-400 font-mono">{row.partyAuthenticationInstanceReference}</p>}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {row.grantedScopes.map((s) => (
                      <span key={s} className="text-[10px] font-mono text-gray-500 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-gray-400 shrink-0 text-right">
                  <p>Approved {new Date(row.consentGrantedAt).toLocaleString()}</p>
                  {row.lastUsedAt && <p className="mt-0.5">Last used {new Date(row.lastUsedAt).toLocaleString()}</p>}
                </div>
                <Link
                  href={row.partyAuthenticationInstanceReference
                    ? `/system/merchant/${merchantId}/activity?user=${encodeURIComponent(row.partyAuthenticationInstanceReference)}`
                    : `/system/merchant/${merchantId}/activity`}
                  title="View this user's activity"
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline mt-0.5">
                  Activity <ArrowRight size={12} />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {!loading && rows.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-100">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={(l) => { setLimit(l); setPage(1); }}
              limitOptions={LIMIT_OPTIONS}
              noun="users"
            />
          </div>
        )}
      </div>
    </div>
  );
}

'use client';
// v18 D-06/D-07: authorized-app detail (classic 3rd-party authorization viewer) + the operations the
// user executed through this app. Self-scoped (the caller's own `sub`); a foreign consentId 404s.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, Layers, ListChecks, RefreshCw, RotateCcw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Pagination } from '../../../../../components/Pagination';
import { api, type ConsentGrantDetail } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useConfirm, useNotify } from '../../../../../components/ui/ConfirmProvider';

const LIMIT_OPTIONS = [10, 25, 50];

const OUTCOME_STYLES: Record<string, string> = {
  approved: 'bg-green-100 text-green-700', received: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700', failed: 'bg-red-100 text-red-700', error: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
};

type OperationRow = {
  id: string;
  eventDateTime: string;
  processType: string;
  processAction: string;
  processOutcome: string;
  entityType: string;
  entityId: string;
  actingChannel?: string;
};

// Merchant logo with graceful fallback to the initial (OIDC logo_uri is optional).
function AppLogo({ name, logoUri, size = 56 }: { name: string; logoUri?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  if (logoUri && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- remote merchant logo, arbitrary origin
    return <img src={logoUri} alt="" width={size} height={size} onError={() => setBroken(true)}
      className="rounded-xl object-contain bg-white border border-gray-100 shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span className="rounded-xl bg-[#001E2B]/10 text-[#001E2B] flex items-center justify-center font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}>{initial}</span>
  );
}

function operationHref(row: OperationRow): string | null {
  if (row.entityType === 'transaction' && row.entityId) return `/system/payment/history/${row.entityId}`;
  return null;
}

export default function AuthorizedApplicationDetailPage() {
  const params = useParams();
  const confirm = useConfirm();
  const notify = useNotify();
  const consentId = decodeURIComponent(String(params?.consentId ?? ''));
  const [token, setToken] = useState('');

  const [detail, setDetail] = useState<ConsentGrantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [acting, setActing] = useState(false);
  // Local overlay on top of the fetched status so an action reflects immediately without a refetch.
  const [statusOverride, setStatusOverride] = useState<'active' | 'revoked' | null>(null);

  // Operations sub-list state.
  const [ops, setOps] = useState<OperationRow[]>([]);
  const [opsTotal, setOpsTotal] = useState(0);
  const [opsLoading, setOpsLoading] = useState(false);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t || !consentId) { setLoading(false); return; }
    api.consentGrants.getDetail(consentId, t)
      .then((d) => setDetail(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [consentId]);

  const loadOps = useCallback(async () => {
    if (!token || !consentId || !detail) return;
    setOpsLoading(true);
    try {
      const r = await api.consentGrants.getOperations(consentId, {
        q: q || undefined,
        dateFrom: from ? new Date(from).toISOString() : undefined,
        dateTo: to ? new Date(to).toISOString() : undefined,
        page, limit,
      }, token);
      setOps(r.events as OperationRow[]);
      setOpsTotal(r.total);
    } catch { setOps([]); setOpsTotal(0); }
    setOpsLoading(false);
  }, [token, consentId, detail, q, from, to, page, limit]);

  useEffect(() => { setPage(1); }, [q, from, to, limit]);
  useEffect(() => { loadOps(); }, [loadOps]);

  // Effective status = local action overlay, else the fetched value.
  const status = statusOverride ?? detail?.consentStatus ?? 'active';

  async function revoke() {
    if (!detail) return;
    const ok = await confirm({
      title: `Revoke access for "${detail.merchantName}"?`,
      // Soft-revoke (kept in the DB): the app stays here so its operations remain attributable and it
      // can be re-approved later.
      message: 'This immediately invalidates its tokens. The app stays here as “Revoked”, so you can still review its past activity or re-approve it later.',
      confirmLabel: 'Revoke access',
      tone: 'danger',
    });
    if (!ok) return;
    setActing(true);
    try {
      await api.consentGrants.revoke(consentId, token);
      setStatusOverride('revoked');
      notify('Access revoked. This app can no longer access your account.', 'success');
    } catch {
      notify('Could not revoke access. Please try again.', 'error');
    }
    setActing(false);
  }

  async function reapprove() {
    if (!detail) return;
    const ok = await confirm({
      title: `Re-approve "${detail.merchantName}"?`,
      message: 'This restores your earlier authorization and its previously granted permissions. The app will be able to reconnect; you can revoke again at any time.',
      confirmLabel: 'Re-approve',
      tone: 'default',
    });
    if (!ok) return;
    setActing(true);
    try {
      await api.consentGrants.reactivate(consentId, token);
      setStatusOverride('active');
      notify('Access re-approved. This app can connect again.', 'success');
    } catch {
      notify('Could not re-approve. Please try again.', 'error');
    }
    setActing(false);
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(opsTotal / limit)), [opsTotal, limit]);
  const hasFilters = q || from || to;

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading application…</div>;
  if (notFound || !detail) {
    return (
      <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-4">
        <Link href="/system/applications" className="inline-flex items-center gap-1 text-sm text-[#001E2B] hover:underline">
          <ArrowLeft size={14} /> Authorized Applications
        </Link>
        <div className="bg-white rounded-xl border p-8 text-center text-sm text-gray-500">This application was not found among your authorizations.</div>
      </div>
    );
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Link href="/system/applications" className="inline-flex items-center gap-1 text-sm text-[#001E2B] hover:underline">
        <ArrowLeft size={14} /> Authorized Applications
      </Link>

      <SectionHeader
        icon={Layers}
        title="Application access"
        description="What this app can access on your behalf, and when you approved it."
        debugInfo="SD-16 · ConsentGrant · OAuth 2.0 / OIDC · self-scoped (sub)"
      />

      {statusOverride === 'revoked' && (
        <div className="rounded-xl p-3 text-sm bg-gray-50 text-gray-600 border border-gray-200">
          Access revoked. This app can no longer access your account, but its past activity stays here for your records.
        </div>
      )}
      {statusOverride === 'active' && (
        <div className="rounded-xl p-3 text-sm bg-green-50 text-green-700 border border-green-200">
          Access re-approved. This app can connect to your account again.
        </div>
      )}

      {/* Authorization card */}
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <div className="flex items-start gap-4">
          <AppLogo name={detail.merchantName} logoUri={detail.oauthLogoUri} />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg text-gray-900">{detail.merchantName}</p>
            {detail.oauthClientUri && (
              <a href={detail.oauthClientUri} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#001E2B] hover:underline mt-0.5">
                {detail.oauthClientUri.replace(/^https?:\/\//, '')} <ExternalLink size={11} />
              </a>
            )}
            <div className="flex items-center gap-2 flex-wrap mt-2 text-xs">
              <span className={`px-2 py-0.5 rounded font-medium ${status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {status === 'active' ? 'Active' : 'Revoked'}
              </span>
              {detail.cibaEnabled && (
                <span title="This app can initiate passwordless (CIBA) sign-in on your behalf. Revoking access here removes that authorization."
                  className="px-2 py-0.5 rounded font-medium bg-teal-50 text-teal-700 border border-teal-200">
                  Passwordless (CIBA)
                </span>
              )}
              <span className="text-gray-500">Approved {new Date(detail.consentGrantedAt).toLocaleString()}</span>
              {detail.lastUsedAt && <span className="text-gray-400">· Last used {new Date(detail.lastUsedAt).toLocaleString()}</span>}
            </div>
          </div>
          {status === 'active' ? (
            <button onClick={revoke} disabled={acting}
              className="flex items-center gap-1.5 text-sm text-red-600 hover:text-white hover:bg-red-600 border border-red-300 rounded-lg px-3 py-1.5 disabled:opacity-50 shrink-0 transition-colors">
              <Trash2 size={14} />{acting ? 'Revoking…' : 'Revoke access'}
            </button>
          ) : (
            <button onClick={reapprove} disabled={acting}
              className="flex items-center gap-1.5 text-sm text-green-700 hover:text-white hover:bg-green-700 border border-green-300 rounded-lg px-3 py-1.5 disabled:opacity-50 shrink-0 transition-colors">
              <RotateCcw size={14} />{acting ? 'Re-approving…' : 'Re-approve'}
            </button>
          )}
        </div>

        {/* Granted scopes with human-readable descriptions */}
        <div className="border-t pt-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">This app can:</p>
          <ul className="space-y-1.5">
            {detail.grantedScopes.map((s) => (
              <li key={s.scope} className="flex items-start gap-2 text-sm">
                <ShieldCheck size={14} className="text-[#00684A] mt-0.5 shrink-0" />
                <span className="text-gray-700">{s.description}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-100 mt-0.5">{s.scope}</span>
                {s.required && <span className="text-[10px] text-gray-400 mt-0.5">required</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* D-07: operations executed in this application */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <ListChecks size={16} className="text-gray-500 shrink-0" />
          <h2 className="font-semibold text-gray-800 text-sm">Operations executed in this application</h2>
        </div>

        {/* Filters */}
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-b border-gray-100">
          <div className="lg:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Search</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Action, type or entity id…"
                className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div className="flex items-end gap-2 lg:col-span-4">
            {hasFilters && (
              <button onClick={() => { setQ(''); setFrom(''); setTo(''); }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Clear</button>
            )}
            <button onClick={loadOps}
              className="text-xs px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors inline-flex items-center gap-1">
              <RefreshCw size={12} className={opsLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {opsLoading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading…</div>
        ) : ops.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">No operations match the current filters.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {ops.map((row) => {
              const href = operationHref(row);
              return (
                <li key={row.id} className="px-5 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-[#001E2B] font-semibold break-all">{row.processAction}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OUTCOME_STYLES[row.processOutcome] ?? 'bg-gray-100 text-gray-600'}`}>{row.processOutcome}</span>
                      <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{row.processType}</span>
                      {row.actingChannel && <span className="text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{row.actingChannel}</span>}
                    </div>
                    {row.entityId && (
                      <div className="text-xs text-gray-500 mt-0.5">{row.entityType} <span className="font-mono">{row.entityId.slice(0, 16)}…</span></div>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 shrink-0 tabular-nums">{new Date(row.eventDateTime).toLocaleString()}</div>
                  {href && (
                    <Link href={href} title="Open related operation"
                      className="shrink-0 inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                      Open <ExternalLink size={12} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!opsLoading && opsTotal > 0 && (
          <div className="px-3 py-2 border-t border-gray-100">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={opsTotal}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={(l) => { setLimit(l); setPage(1); }}
              limitOptions={LIMIT_OPTIONS}
              noun="operations"
            />
          </div>
        )}
      </div>
    </div>
  );
}

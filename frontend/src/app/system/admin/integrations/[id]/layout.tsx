'use client';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeft, Info, Download, Upload, List, Network,
  KeyRound, Pause, Trash2, AlertCircle, CheckCircle2, WifiOff, Clock,
} from 'lucide-react';
import { useState } from 'react';
import { IntegrationProvider, useIntegration, TYPE_LABEL, TYPE_CATEGORY_PATH } from './_context';
import { api } from '../../../../../lib/api';

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV = [
  { label: 'Overview', path: 'overview', icon: Info },
  { label: 'Inbound',  path: 'inbound',  icon: Download },
  { label: 'Outbound', path: 'outbound', icon: Upload },
  { label: 'Events',   path: 'events',   icon: List },
  { label: 'Routing',  path: 'routing',  icon: Network },
];

// ── Health indicator ──────────────────────────────────────────────────────────

function HealthBadge({ status }: { status?: string }) {
  if (!status || status === 'unknown') return <span className="flex items-center gap-1 text-xs text-gray-400"><Clock size={11} />Unknown</span>;
  if (status === 'ok')          return <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle2 size={11} />Healthy</span>;
  if (status === 'degraded')    return <span className="flex items-center gap-1 text-xs text-amber-600 font-medium"><AlertCircle size={11} />Degraded</span>;
  if (status === 'unreachable') return <span className="flex items-center gap-1 text-xs text-red-500 font-medium"><WifiOff size={11} />Unreachable</span>;
  return null;
}

// ── Inner layout (needs context) ──────────────────────────────────────────────

function LayoutInner({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router   = useRouter();
  const { integration, loading, loadError, reload, token } = useIntegration();
  const [rotating, setRotating]   = useState(false);
  const [newKey, setNewKey]       = useState<string | null>(null);
  const [deleting, setDeleting]   = useState(false);

  async function handleRotate() {
    if (!confirm('Rotate the API key? The current key will stop working immediately.')) return;
    setRotating(true);
    try {
      const r = await api.integrations.rotateKey(id, token);
      setNewKey((r as { apiKey: string }).apiKey);
      reload();
    } catch (err) { alert((err as Error).message); }
    finally { setRotating(false); }
  }

  async function handleSuspend() {
    if (!confirm('Suspend this integration? Requests will fall back to the built-in default.')) return;
    try { await api.integrations.suspend(id, token); reload(); }
    catch (err) { alert((err as Error).message); }
  }

  async function handleDelete() {
    if (!integration) return;
    if (!confirm(`Delete "${integration.externalProviderArrangementName}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.integrations.delete(id, token);
      router.push(TYPE_CATEGORY_PATH[integration.externalProviderArrangementType] ?? '/system/admin/integrations');
    } catch (err) {
      alert((err as Error).message);
      setDeleting(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!integration) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-3">
        <AlertCircle size={28} className="text-red-400" />
        <p className="text-gray-700 font-medium">{loadError ?? 'Integration not found.'}</p>
        <Link href="/system/admin/integrations" className="text-xs text-gray-400 hover:text-gray-700 underline flex items-center gap-1">
          <ArrowLeft size={12} />Back to Registry
        </Link>
      </div>
    );
  }

  const isInternal   = integration.externalProviderIsInternal;
  const categoryPath = TYPE_CATEGORY_PATH[integration.externalProviderArrangementType] ?? '/system/admin/integrations';
  const categoryLabel = TYPE_LABEL[integration.externalProviderArrangementType] ?? 'Integrations';

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b px-6 py-3 sticky top-0 z-10">
        <Link href={categoryPath}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors w-fit mb-1.5">
          <ArrowLeft size={11} />{categoryLabel}
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base font-bold text-gray-900">{integration.externalProviderArrangementName}</h1>
            {isInternal && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-medium">
                Built-in
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
              integration.externalProviderArrangementStatus === 'active'    ? 'bg-green-100 text-green-700' :
              integration.externalProviderArrangementStatus === 'test'      ? 'bg-blue-100 text-blue-700' :
              integration.externalProviderArrangementStatus === 'suspended' ? 'bg-orange-100 text-orange-700' :
                                                                              'bg-gray-100 text-gray-600'
            }`}>{integration.externalProviderArrangementStatus}</span>
            <HealthBadge status={integration.externalProviderHealthStatus} />
          </div>

          {!isInternal && (
            <div className="flex items-center gap-2">
              <button onClick={handleRotate} disabled={rotating}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition-colors">
                <KeyRound size={11} />{rotating ? 'Rotating…' : 'Rotate Key'}
              </button>
              {integration.externalProviderArrangementStatus !== 'suspended' && (
                <button onClick={handleSuspend}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-orange-300 text-orange-700 hover:bg-orange-50 transition-colors">
                  <Pause size={11} />Suspend
                </button>
              )}
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors">
                <Trash2 size={11} />{deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        </div>

        {newKey && (
          <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
            <strong className="text-amber-900">New API Key, save it now, it will not be shown again:</strong>
            <code className="block mt-1 font-mono text-amber-800 break-all select-all bg-white border border-amber-200 rounded px-2 py-1 mt-1">{newKey}</code>
            <button onClick={() => setNewKey(null)} className="mt-1 text-amber-600 underline">Dismiss</button>
          </div>
        )}
      </div>

      <div className="flex">
        {/* ── Sidebar nav ───────────────────────────────────────────────────── */}
        <nav className="w-44 shrink-0 border-r bg-white min-h-[calc(100vh-88px)] px-2 py-4 space-y-0.5 sticky top-[88px] self-start">
          {NAV.map(item => {
            const Icon = item.icon;
            const href = `/system/admin/integrations/${id}/${item.path}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link key={item.path} href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#001E2B] text-[#00ED64]'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}>
                <Icon size={14} />{item.label}
              </Link>
            );
          })}
        </nav>

        {/* ── Page content ──────────────────────────────────────────────────── */}
        <div className="flex-1 p-6 max-w-4xl">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function IntegrationDetailLayout({ children }: { children: React.ReactNode }) {
  return (
    <IntegrationProvider>
      <LayoutInner>{children}</LayoutInner>
    </IntegrationProvider>
  );
}

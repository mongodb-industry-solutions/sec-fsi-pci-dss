'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, CheckCircle2, AlertTriangle, RefreshCw, Search, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useDebugMode } from '../../lib/debugMode';

function IntegrityRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 text-sm py-1.5">
      {ok ? <CheckCircle2 size={15} className="text-green-600 shrink-0" /> : <AlertTriangle size={15} className="text-amber-600 shrink-0" />}
      <span className="text-gray-700">{label}</span>
      <span className={`ml-auto text-xs ${ok ? 'text-gray-400' : 'text-amber-700 font-medium'}`}>{detail}</span>
    </div>
  );
}

// Security Auditor data-integrity oversight (PCI DSS). Read-only. Re-runnable.
// Renders even on error so the section is always visible and explains why.
export function IntegrityPanel({ token }: { token: string }) {
  const { debugMode } = useDebugMode();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.fraud.integrity>> | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setD(await api.fraud.integrity(token)); setError(false); }
    catch { setD(null); setError(true); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const ReRunButton = (
    <button
      onClick={load}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors disabled:opacity-50"
    >
      <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Re-run check
    </button>
  );

  if (loading && !d) {
    return <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Running integrity checks…</div>;
  }

  if (!d) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5"><ShieldCheck size={14} className="text-[#001E2B]" /> Data integrity</h2>
          {ReRunButton}
        </div>
        <p className="text-sm text-gray-400">
          {error
            ? 'Integrity check unavailable. Ensure the backend is rebuilt and restarted (this endpoint is new).'
            : 'No integrity data.'}
        </p>
        {debugMode && <p className="mt-2 text-[10px] font-mono text-gray-400">control-record integrity · PCI DSS · read-only</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary checks card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5"><ShieldCheck size={14} className="text-[#001E2B]" /> Control-record checks</h2>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.healthy ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {d.healthy ? 'All checks passed' : 'Attention needed'}
            </span>
            {ReRunButton}
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          <IntegrityRow ok={d.duplicateCount === 0} label="Unique case references" detail={d.duplicateCount === 0 ? 'No duplicates' : `${d.duplicateCount} duplicate reference(s)`} />
          <IntegrityRow ok={d.orphanTransactionRefs === 0} label="Transaction references resolve" detail={d.orphanTransactionRefs === 0 ? 'OK' : `${d.orphanTransactionRefs} orphaned`} />
          <IntegrityRow ok={d.orphanCustomerRefs === 0} label="Customer references resolve" detail={d.orphanCustomerRefs === 0 ? 'OK' : `${d.orphanCustomerRefs} orphaned`} />
          <IntegrityRow ok label="Total cases" detail={String(d.totalCases)} />
        </div>
        {debugMode && <p className="mt-3 text-[10px] font-mono text-gray-400">control-record integrity · PCI DSS · read-only</p>}
      </div>

      {/* Payment-card integrity : cards duplicated by error */}
      {d.cards && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5"><ShieldCheck size={14} className="text-[#001E2B]" /> Payment-card checks</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${d.cards.healthy ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {d.cards.healthy ? 'All checks passed' : 'Attention needed'}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            <IntegrityRow ok={d.cards.duplicateArrangementCount === 0} label="No duplicate card-on-file per customer" detail={d.cards.duplicateArrangementCount === 0 ? 'OK' : `${d.cards.duplicateArrangementCount} duplicate(s)`} />
            <IntegrityRow ok={d.cards.tokenizationDuplicateCount === 0} label="Consistent tokenization (one token per card)" detail={d.cards.tokenizationDuplicateCount === 0 ? 'OK' : `${d.cards.tokenizationDuplicateCount} inconsistent`} />
            <IntegrityRow ok={d.cards.registryDriftCount === 0} label="Card registry reconciles with holders" detail={d.cards.registryDriftCount === 0 ? 'OK' : `${d.cards.registryDriftCount} drifted`} />
          </div>
          {debugMode && <p className="mt-3 text-[10px] font-mono text-gray-400">payment-card integrity · masked PAN only · no CHD</p>}
        </div>
      )}

      {/* Cards duplicated by error; same masked card under multiple tokens for one customer */}
      {d.cards && d.cards.tokenizationDuplicates.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-center gap-3">
            <span className="inline-flex w-9 h-9 rounded-lg bg-amber-100 items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-amber-600" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-amber-900 text-sm">Cards duplicated by error</h2>
              <p className="text-xs text-amber-700">Same card (masked PAN + network) stored under multiple tokens for one customer; inconsistent tokenization.</p>
            </div>
            <span className="ml-auto text-xs font-semibold bg-amber-600 text-white rounded-full px-2.5 py-1 shrink-0">{d.cards.tokenizationDuplicateCount}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {d.cards.tokenizationDuplicates.map((r, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3">
                <span className="font-mono text-sm text-gray-800">{r.maskedPan}</span>
                {r.network && <span className="text-xs text-gray-400">{r.network}</span>}
                <span className="ml-auto text-[11px] font-medium bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 shrink-0">{r.distinctTokens} tokens</span>
              </li>
            ))}
          </ul>
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
            Remediation: consolidate to a single deterministic token per card; merge the duplicate arrangements{debugMode ? ' (ADR-027)' : ''}.
          </div>
        </div>
      )}
      {d.duplicateReferences.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-center gap-3">
            <span className="inline-flex w-9 h-9 rounded-lg bg-amber-100 items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-amber-600" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-amber-900 text-sm">Duplicate case references</h2>
              <p className="text-xs text-amber-700">Each reference points to more than one case. Open it in Cases to review and remediate.</p>
            </div>
            <span className="ml-auto text-xs font-semibold bg-amber-600 text-white rounded-full px-2.5 py-1 shrink-0">{d.duplicateCount}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {d.duplicateReferences.map((r) => (
              <li key={r.reference} className="group flex items-center gap-3 px-5 py-3 hover:bg-amber-50/50 transition-colors">
                <span className="font-mono text-sm text-gray-800 truncate">{r.reference}</span>
                <span className="text-[11px] font-medium bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 shrink-0">×{r.count} cases</span>
                <Link
                  href={`/system/investigation?field=caseRef&q=${encodeURIComponent(r.reference)}`}
                  className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors shrink-0"
                >
                  <Search size={13} /> Review in Cases <ArrowRight size={12} className="opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
            Remediation: clean or re-seed the fraud collection so the unique index can enforce uniqueness{debugMode ? ' (ADR-024)' : ''}.
          </div>
        </div>
      )}

      {/* Orphaned customer references; dedicated, interactive review card */}
      {d.orphanCustomerReferences && d.orphanCustomerReferences.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-center gap-3">
            <span className="inline-flex w-9 h-9 rounded-lg bg-amber-100 items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-amber-600" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-amber-900 text-sm">Unresolved customer references</h2>
              <p className="text-xs text-amber-700">Cases pointing to a customer record that no longer resolves. Open the cases to review and remediate.</p>
            </div>
            <span className="ml-auto text-xs font-semibold bg-amber-600 text-white rounded-full px-2.5 py-1 shrink-0">{d.orphanCustomerReferences.length}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {d.orphanCustomerReferences.map((r) => (
              <li key={r.reference} className="group flex items-center gap-3 px-5 py-3 hover:bg-amber-50/50 transition-colors">
                <span className="font-mono text-sm text-gray-800 truncate">{r.reference}</span>
                <span className="text-[11px] font-medium bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 shrink-0">×{r.count} case{r.count !== 1 ? 's' : ''}</span>
                <Link
                  href={`/system/investigation?field=customerId&q=${encodeURIComponent(r.reference)}`}
                  className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors shrink-0"
                >
                  <Search size={13} /> Review in Cases <ArrowRight size={12} className="opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
            Remediation: restore the missing customer agreement, or re-link the case to the correct customer{debugMode ? ' ( ↔ referential integrity)' : ''}.
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, ActionEvent } from '../../../../../lib/api';
import { getToken, decodeToken } from '../../../../../lib/auth';
import { ROLE_LABELS } from '../../../../../lib/constants';

interface StoredTransaction {
  txnId: string;
  amount: number;
  currency: string;
  merchant: string;
  mcc: string;
  channel: string;
  maskedPan: string;
  status: string;
  fraudCaseCreated: boolean;
  caseId?: string;
  createdAt: string;
  paymentReference?: string | null;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string; icon: string }> = {
  authorized:       { label: 'Authorized',                      color: 'bg-green-100 text-green-800',  icon: '✓' },
  settled:          { label: 'Settled',                         color: 'bg-green-100 text-green-800',  icon: '✓' },
  under_review:     { label: 'Under review',                    color: 'bg-amber-100 text-amber-800',  icon: '●' },
  open:             { label: 'Under review',                    color: 'bg-amber-100 text-amber-800',  icon: '●' },
  escalated:        { label: 'In investigation',                color: 'bg-orange-100 text-orange-800',icon: '●' },
  resolved_cleared: { label: 'Cleared',                         color: 'bg-green-100 text-green-800',  icon: '✓' },
  resolved_fraud:   { label: 'Fraud confirmed – refund issued', color: 'bg-red-100 text-red-800',      icon: '!' },
  closed:           { label: 'Closed',                          color: 'bg-gray-100 text-gray-700',    icon: '–' },
  declined:         { label: 'Declined',                        color: 'bg-red-100 text-red-800',      icon: '✗' },
};

const CHANNEL_LABELS: Record<string, string> = {
  online:      'Online (e-commerce)',
  pos:         'Point of Sale (POS)',
  contactless: 'Contactless (NFC / tap)',
  atm:         'ATM withdrawal',
};

const EVENT_META: Record<string, { label: string; icon: string; dotColor: string }> = {
  case_opened:    { label: 'Transaction flagged for security review',  icon: '⚑', dotColor: 'border-amber-400 bg-amber-50' },
  escalated:      { label: 'Review escalated to specialist team',      icon: '↑', dotColor: 'border-orange-400 bg-orange-50' },
  note_added:     { label: 'Update added to your case',                icon: '✉', dotColor: 'border-blue-400 bg-blue-50' },
  resolved:       { label: 'Review completed',                         icon: '✓', dotColor: 'border-green-400 bg-green-50' },
  closed:         { label: 'Case closed',                              icon: '–', dotColor: 'border-gray-300 bg-gray-50' },
  field_accessed: { label: 'Account details verified',                 icon: '●', dotColor: 'border-purple-400 bg-purple-50' },
};

export default function TransactionDetailPage() {
  const { txnId } = useParams<{ txnId: string }>();

  const [user, setUser] = useState<ReturnType<typeof decodeToken>>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [txn, setTxn] = useState<StoredTransaction | null>(null);
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const load = async () => {
      const t = getToken() ?? '';
      const u = t ? decodeToken(t) : null;
      setUser(u);

      const storageKey = u?.sub ? `demo_transactions_${u.sub}` : 'demo_transactions_guest';
      const stored: StoredTransaction[] = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      const found = stored.find((s) => s.txnId === txnId);

      if (!found) { setNotFound(true); setLoading(false); return; }
      setTxn(found);

      if (found.caseId) {
        try {
          const [c, eventsData] = await Promise.all([
            api.fraud.getById(found.caseId, t),
            api.fraud.getEvents(found.caseId, t).catch(() => ({ caseId: found.caseId!, events: [] })),
          ]);
          setFraudCase(c);
          setEvents(eventsData.events);
        } catch {
          // Case not accessible; show transaction data only
        }
      }
      setLoading(false);
    };
    load();
  }, [txnId]);

  const currentStatus = fraudCase?.caseStatus ?? txn?.status ?? '';
  const statusMeta = STATUS_DISPLAY[currentStatus] ?? {
    label: currentStatus.replace(/_/g, ' '), color: 'bg-gray-100 text-gray-700', icon: '●',
  };

  const shell = { user, debugMode, onToggleDebug: () => setDebugMode((v) => !v) };

  if (loading) return (
    <PageShell {...shell}>
      <div className="text-center py-12 text-gray-400">Loading transaction...</div>
    </PageShell>
  );

  if (notFound || !txn) return (
    <PageShell {...shell}>
      <div className="text-center py-12 text-gray-500">
        <p className="mb-3">Transaction not found.</p>
        <Link href="/demo/payment/history" className="inline-flex items-center gap-1.5 text-blue-600 hover:underline text-sm">
          ← Back to transactions
        </Link>
      </div>
    </PageShell>
  );

  const visibleEvents = events.filter((e) => Object.keys(EVENT_META).includes(e.actionType));

  return (
    <PageShell {...shell}>
      <Link href="/demo/payment/history" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline mb-4">
        ← Back to transactions
      </Link>

      {/* Main transaction card */}
      <div className="bg-white rounded-xl border p-5 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{txn.merchant}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{new Date(txn.createdAt).toLocaleString()}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-gray-900">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.currency }).format(txn.amount)}
            </p>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium ${statusMeta.color}`}>
              <span>{statusMeta.icon}</span>
              {statusMeta.label}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm border-t pt-4">
          <span className="text-gray-500">Card</span>
          <span className="font-mono">{txn.maskedPan}</span>
          <span className="text-gray-500">Channel</span>
          <span>{CHANNEL_LABELS[txn.channel] ?? txn.channel}</span>
          <span className="text-gray-500">Merchant category</span>
          <span className="font-mono">MCC {txn.mcc}</span>
          {txn.paymentReference && (
            <>
              <span className="text-gray-500">Reference</span>
              <span>{txn.paymentReference}</span>
            </>
          )}
          {fraudCase?.fraudDiagnosisCaseReference && (
            <>
              <span className="text-gray-500">Case reference</span>
              <span className="font-mono text-xs">{fraudCase.fraudDiagnosisCaseReference}</span>
            </>
          )}
        </div>

        {debugMode && (
          <div className="mt-4 border-t pt-3 bg-[#001E2B]/3 rounded-b-lg text-xs font-mono text-gray-500 space-y-0.5">
            <p className="font-semibold text-[#001E2B] mb-1">Debug</p>
            <p>txnId: {txn.txnId}</p>
            {txn.caseId && <p>caseId: {txn.caseId}</p>}
          </div>
        )}
      </div>

      {/* Message from security team */}
      {fraudCase?.fraudDiagnosisCustomerSubjectNotes && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1.5">
            ✉ Message from security team
          </p>
          <p className="text-sm text-blue-900">{fraudCase.fraudDiagnosisCustomerSubjectNotes}</p>
        </div>
      )}

      {/* Resolution outcome */}
      {fraudCase?.fraudDiagnosisResolutionRecord && (
        <div className={`rounded-xl border p-4 mb-4 text-sm ${
          fraudCase.fraudDiagnosisResolutionRecord.resolutionOutcome === 'confirmed_fraud'
            ? 'bg-red-50 border-red-200 text-red-900'
            : 'bg-green-50 border-green-200 text-green-900'
        }`}>
          <p className="font-semibold mb-1">
            {fraudCase.fraudDiagnosisResolutionRecord.resolutionOutcome === 'confirmed_fraud'
              ? '! Unauthorized transaction confirmed'
              : '✓ Transaction cleared'}
          </p>
          <p>
            {fraudCase.fraudDiagnosisResolutionRecord.resolutionOutcome === 'confirmed_fraud'
              ? 'Your card has been secured. A full refund has been initiated and a replacement card will be issued.'
              : 'Our security review is complete. This transaction has been confirmed as legitimate.'}
          </p>
          <p className="text-xs opacity-70 mt-1">
            {new Date(fraudCase.fraudDiagnosisResolutionRecord.resolutionDateTime).toLocaleString()}
          </p>
        </div>
      )}

      {/* Case timeline */}
      {visibleEvents.length > 0 && (
        <div className="bg-white rounded-xl border p-5 mb-4">
          <h2 className="font-semibold mb-5">Case timeline</h2>
          <div className="relative pl-8">
            <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-200" />
            <div className="space-y-5">
              {visibleEvents.map((e, i) => {
                const meta = EVENT_META[e.actionType] ?? { label: e.actionType, icon: '●', dotColor: 'border-gray-300 bg-gray-50' };
                return (
                  <div key={i} className="relative">
                    <div className={`absolute -left-8 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${meta.dotColor}`}>
                      {meta.icon}
                    </div>
                    <p className="text-sm font-medium text-gray-800">{meta.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(e.actionDateTime).toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* No fraud case */}
      {!txn.fraudCaseCreated && (
        <div className="bg-white rounded-xl border p-5 text-center text-sm text-gray-500">
          ✓ This transaction was processed normally and did not require additional review.
        </div>
      )}
    </PageShell>
  );
}

function PageShell({
  user,
  debugMode,
  onToggleDebug,
  children,
}: {
  user: ReturnType<typeof decodeToken>;
  debugMode: boolean;
  onToggleDebug: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex justify-between items-center">
        <span className="font-bold text-[#00ED64]">🏦 Payment Gateway</span>
        <div className="flex items-center gap-3 text-sm">
          {user && (
            <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">
              {user.name} · {ROLE_LABELS[user.role] ?? user.role}
            </span>
          )}
          <button
            onClick={onToggleDebug}
            title="Toggle debug mode"
            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${
              debugMode
                ? 'bg-[#00ED64] text-[#001E2B] border-[#00ED64]'
                : 'text-gray-400 border-white/20 hover:border-white/40'
            }`}
          >
            <span className="hidden sm:inline">{debugMode ? 'Debug ON' : 'Debug'}</span>
          </button>
          <Link href="/demo" className="text-gray-400 hover:text-white text-sm">
            Sign out
          </Link>
        </div>
      </header>
      <main className="max-w-xl mx-auto p-6">{children}</main>
    </div>
  );
}

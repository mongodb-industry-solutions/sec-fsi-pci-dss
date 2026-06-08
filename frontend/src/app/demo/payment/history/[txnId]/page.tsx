'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, ActionEvent } from '../../../../../lib/api';
import { getToken, decodeToken } from '../../../../../lib/auth';
import { useDebugMode } from '../../../../../lib/debugMode';
import { Eye, EyeOff } from 'lucide-react';
import { RawMongoPanel } from '../../../../../components/RawMongoPanel';

interface StoredTransaction {
  txnId: string;
  cardToken?: string | null;
  amount: number;
  currency: string;
  merchant: string;
  mcc: string;
  channel: string;
  initiationType?: string | null;
  maskedPan: string;
  network?: string | null;
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
  case_opened:    { label: 'Transaction flagged for security review',  icon: '!', dotColor: 'border-amber-400 bg-amber-50' },
  escalated:      { label: 'Review escalated to specialist team',      icon: '↑', dotColor: 'border-orange-400 bg-orange-50' },
  note_added:     { label: 'Update added to your case',                icon: '✉', dotColor: 'border-blue-400 bg-blue-50' },
  resolved:       { label: 'Review completed',                         icon: '✓', dotColor: 'border-green-400 bg-green-50' },
  closed:         { label: 'Case closed',                              icon: '–', dotColor: 'border-gray-300 bg-gray-50' },
  field_accessed: { label: 'Account details verified',                 icon: '●', dotColor: 'border-purple-400 bg-purple-50' },
};

function CardTokenField({ token }: { token: string }) {
  const [shown, setShown] = useState(false);
  const masked = token.slice(0, 4) + '_●●●●●●●●';
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-gray-700">{shown ? token : masked}</span>
      <button
        onClick={() => setShown(v => !v)}
        title={shown ? 'Hide token' : 'Show token'}
        className="text-gray-400 hover:text-[#001E2B] transition-colors"
      >
        {shown ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );
}

export default function TransactionDetailPage() {
  const { txnId } = useParams<{ txnId: string }>();

  const [user, setUser] = useState<ReturnType<typeof decodeToken>>(null);
  const [token, setToken] = useState('');
  const { debugMode } = useDebugMode();
  const [txn, setTxn] = useState<StoredTransaction | null>(null);
  const [apiTxn, setApiTxn] = useState<{ paymentCardReference?: string; cardTransactionMerchantCategoryCode?: string; cardTransactionChannel?: string; cardTransactionInitiationType?: string } | null>(null);
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [caseNotes, setCaseNotes] = useState<{
    caseFound: boolean;
    fraudDiagnosisCaseReference: string | null;
    fraudDiagnosisCaseStatus: string | null;
    fraudDiagnosisCaseSeverity: string | null;
    fraudDiagnosisCustomerSubjectNotes: string | null;
    fraudDiagnosisResolutionOutcome: string | null;
  } | null>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const load = async () => {
      const t = getToken() ?? '';
      const u = t ? decodeToken(t) : null;
      setUser(u);
      setToken(t);

      const storageKey = u?.sub ? `demo_transactions_${u.sub}` : 'demo_transactions_guest';
      const stored: StoredTransaction[] = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      const found = stored.find((s) => s.txnId === txnId);

      if (!found) { setNotFound(true); setLoading(false); return; }
      setTxn(found);

      // Fetch customer-visible case notes (works even for customer role  -  dedicated endpoint)
      api.transactions.getNotes(txnId, t)
        .then(setCaseNotes)
        .catch(() => null);

      // Fetch full transaction details from the API to get card token and all fields
      // even for transactions created before the localStorage cardToken field was added
      api.transactions.getById(txnId, t)
        .then((data) => setApiTxn({
          paymentCardReference:             data.paymentCardReference,
          cardTransactionMerchantCategoryCode: data.cardTransactionMerchantCategoryCode,
          cardTransactionChannel:           data.cardTransactionChannel,
          cardTransactionInitiationType:    data.cardTransactionInitiationType,
        }))
        .catch(() => null);

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

  const shell = { user, debugMode };

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
          {/* Card info */}
          <span className="text-gray-500">Card (masked)</span>
          <span className="font-mono">{txn.maskedPan}</span>

          {txn.network && (
            <>
              <span className="text-gray-500">Network</span>
              <span className="font-medium">{txn.network}</span>
            </>
          )}

          {/* Card token  -  from API (always up-to-date) or localStorage fallback */}
          {(apiTxn?.paymentCardReference || txn.cardToken) && (
            <>
              <span className="text-gray-500">Card token</span>
              <CardTokenField token={(apiTxn?.paymentCardReference ?? txn.cardToken)!} />
            </>
          )}

          {/* Transaction details  -  prefer API data, fallback to localStorage */}
          <span className="text-gray-500">Channel</span>
          <span>{CHANNEL_LABELS[apiTxn?.cardTransactionChannel ?? txn.channel] ?? txn.channel}</span>

          {(apiTxn?.cardTransactionInitiationType || txn.initiationType) && (
            <>
              <span className="text-gray-500">Initiation</span>
              <span>
                {(apiTxn?.cardTransactionInitiationType ?? txn.initiationType) === 'customerInitiated'
                  ? 'Customer Initiated (CIT)'
                  : 'Merchant Initiated (MIT)'}
              </span>
            </>
          )}

          <span className="text-gray-500">Merchant category</span>
          <span className="font-mono text-xs">MCC {apiTxn?.cardTransactionMerchantCategoryCode ?? txn.mcc}</span>

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

          <span className="text-gray-500">Transaction ID</span>
          <span className="font-mono text-xs text-gray-500 truncate">{txn.txnId}</span>
        </div>

        {debugMode && (
          <div className="mt-4 border-t pt-3 bg-[#001E2B]/3 rounded-b-lg text-xs font-mono text-gray-500 space-y-0.5">
            <p className="font-semibold text-[#001E2B] mb-1">Debug</p>
            <p>txnId: {txn.txnId}</p>
            {txn.caseId && <p>caseId: {txn.caseId}</p>}
          </div>
        )}
      </div>

      {/* Notes and messages from the security team */}
      {caseNotes?.caseFound && (
        <div className="bg-white rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Security Review</h2>
            {caseNotes.fraudDiagnosisCaseReference && (
              <span className="text-xs font-mono text-gray-400">{caseNotes.fraudDiagnosisCaseReference}</span>
            )}
          </div>

          {/* Case status */}
          {caseNotes.fraudDiagnosisCaseStatus && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Status:</span>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                caseNotes.fraudDiagnosisCaseStatus === 'escalated'        ? 'bg-orange-100 text-orange-800' :
                caseNotes.fraudDiagnosisCaseStatus === 'resolved_fraud'   ? 'bg-red-100 text-red-800'    :
                caseNotes.fraudDiagnosisCaseStatus === 'resolved_cleared' ? 'bg-green-100 text-green-800' :
                caseNotes.fraudDiagnosisCaseStatus === 'closed'           ? 'bg-gray-100 text-gray-700'  :
                'bg-amber-100 text-amber-800'
              }`}>
                {caseNotes.fraudDiagnosisCaseStatus.replace(/_/g, ' ')}
              </span>
              {caseNotes.fraudDiagnosisCaseSeverity && (
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  caseNotes.fraudDiagnosisCaseSeverity === 'critical' ? 'bg-red-600 text-white' :
                  caseNotes.fraudDiagnosisCaseSeverity === 'high'     ? 'bg-red-500 text-white' :
                  caseNotes.fraudDiagnosisCaseSeverity === 'medium'   ? 'bg-yellow-500 text-black' :
                  'bg-green-600 text-white'
                }`}>
                  {caseNotes.fraudDiagnosisCaseSeverity.toUpperCase()}
                </span>
              )}
            </div>
          )}

          {/* Customer-visible note from agents */}
          {caseNotes.fraudDiagnosisCustomerSubjectNotes ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-700 uppercase mb-1">✉ Message from security team</p>
              <p className="text-sm text-blue-900">{caseNotes.fraudDiagnosisCustomerSubjectNotes}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No message from the security team yet.</p>
          )}

          {/* Resolution outcome */}
          {caseNotes.fraudDiagnosisResolutionOutcome && (
            <div className={`rounded-lg p-3 text-sm ${
              caseNotes.fraudDiagnosisResolutionOutcome === 'confirmed_fraud'
                ? 'bg-red-50 border border-red-200 text-red-800'
                : 'bg-green-50 border border-green-200 text-green-800'
            }`}>
              {caseNotes.fraudDiagnosisResolutionOutcome === 'confirmed_fraud'
                ? 'Unauthorized transaction confirmed. A refund has been initiated and your card has been secured.'
                : 'Review complete. This transaction has been confirmed as legitimate.'}
            </div>
          )}
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

      {/* Debug: unified raw data panel — separated with proportional margin */}
      {debugMode && (
        <div className="p-5 mb-4">
          <RawMongoPanel
          token={token}
          title="Debug - Raw data"
          sections={[
            {
              kind: 'static',
              label: 'localStorage — stored transaction',
              description: 'Data saved locally when this payment was made',
              data: txn,
            },
            {
              kind: 'static',
              label: 'API — GET /api/v1/transactions/:id',
              labelColor: 'text-yellow-400',
              description: 'Backend response including decrypted QE:equality fields',
              data: apiTxn,
            },
            {
              kind: 'static',
              label: 'API — GET /api/v1/transactions/:id/notes',
              labelColor: 'text-yellow-400',
              description: 'Customer-visible case notes from the investigation module',
              data: caseNotes,
            },
            {
              kind: 'mongo',
              collection: 'cardTransactionLog',
              id: txnId,
              label: 'cardTransactionLog',
              labelColor: 'text-blue-400',
              description: 'QE:equality (accountRef) + QE:none (rawGatewayPayload, processorMetadata) inline — v2 unified document',
            },
          ]}
          />
        </div>
      )}
    </PageShell>
  );
}

function PageShell({
  children,
}: {
  user: ReturnType<typeof decodeToken>;
  debugMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-gray-50">
      <main className="max-w-xl mx-auto p-6">
        {children}
      </main>
    </div>
  );
}

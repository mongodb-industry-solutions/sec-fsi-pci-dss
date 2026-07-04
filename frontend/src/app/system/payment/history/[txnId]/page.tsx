'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, ActionEvent, TransactionNotesResponse } from '../../../../../lib/api';
import { getToken, decodeToken } from '../../../../../lib/auth';
import { useDebugMode } from '../../../../../lib/debugMode';
import { Eye, EyeOff, Info } from 'lucide-react';
import { RawMongoPanel } from '../../../../../components/RawMongoPanel';
import { CustomerQuestionsPanel } from '../../../../../components/CustomerQuestionsPanel';
import { useNotificationsStream } from '../../../../../lib/useNotificationsStream';

// Inline tooltip: renders a ⓘ button that opens a floating description popup.
function FieldInfo({ label, description }: { label: string; description: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="ml-1 text-gray-300 hover:text-gray-500 transition-colors align-middle"
        title={`About: ${label}`}
      >
        <Info size={12} />
      </button>
      {open && (
        <div className="absolute z-50 bottom-full left-0 mb-1.5 w-64 bg-[#001E2B] text-white text-xs rounded-lg shadow-xl p-3 leading-relaxed">
          <span className="block font-semibold mb-1 text-[#00ED64]">{label}</span>
          <span className="block">{description}</span>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children, info }: { children: React.ReactNode; info: string }) {
  return (
    <span className="text-gray-500 flex items-center gap-0.5">
      {children}
      <FieldInfo label={String(children)} description={info} />
    </span>
  );
}

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
  authorized:       { label: 'Authorized',                      color: 'bg-green-100 text-green-800',         icon: '✓' },
  settled:          { label: 'Settled (funds disbursed)',        color: 'bg-emerald-100 text-emerald-800 font-semibold', icon: '✓' },
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
  const [p2pTransfer, setP2pTransfer] = useState<{
    paymentExecutionInstanceReference: string;
    initiatorPartyReference: string | null;
    beneficiaryPartyReference: string | null;
    sourcePayoutAccountReference: string | null;
    resolvedPayoutAccountReference: string | null;
    grossAmount: number;
    netAmount: number;
    feeAmount: number;
    currency: string;
    paymentExecutionRail: string | null;
    routingNote: string | null;
    paymentExecutionStatus: string;
    fraudCaseCreated: boolean | null;
    fraudDiagnosisInstanceReference: string | null;
    initiatedAt: string | null;
    completedAt: string | null;
    fraudCase: {
      fraudDiagnosisInstanceReference: string;
      fraudDiagnosisCaseReference: string;
      fraudDiagnosisCaseStatus: string;
      fraudDiagnosisCaseSeverity: string;
      fraudDiagnosisScore: number | null;
      riskIndicators: string[];
      subsystemSignals: Record<string, unknown> | null;
    } | null;
  } | null>(null);
  const [apiTxn, setApiTxn] = useState<{
    paymentCardReference?: string;
    cardTransactionMerchantCategoryCode?: string;
    cardTransactionChannel?: string;
    cardTransactionInitiationType?: string;
    cardTransactionType?: string;
    cardTransactionDescription?: string;
    cardTransactionNarrative?: string;
  } | null>(null);
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [caseNotes, setCaseNotes] = useState<TransactionNotesResponse | null>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // The owner's saved-card id matching this transaction's token; lets us link to the card detail.
  const [matchedCardId, setMatchedCardId] = useState<string | null>(null);

  // `showLoading` is only true for the initial mount; live refreshes (a new note / answered question
  // arriving over the notifications stream) refetch in the background without flashing the skeleton.
  const loadData = useCallback(async (showLoading: boolean) => {
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    setUser(u);
    setToken(t);
    if (showLoading) setLoading(true);

    // Real source of truth: fetch the transaction from the API.
    const data = await api.transactions.getById(txnId, t).catch(() => null);
    if (!data) {
      // Fallback: try P2P transfer lookup (BIAN SD-65)
      const p2p = await api.accounts.getTransfer(txnId, t).catch(() => null);
      if (p2p) {
        setP2pTransfer(p2p);
        if (showLoading) setLoading(false);
        return;
      }
      if (showLoading) { setNotFound(true); setLoading(false); }
      return;
    }

    setTxn({
      txnId:          data.cardTransactionInstanceReference,
      cardToken:      data.paymentCardReference ?? null,
      amount:         data.cardTransactionAmount?.amount ?? 0,
      currency:       data.cardTransactionAmount?.currency ?? 'USD',
      merchant:       data.cardTransactionMerchantName,
      mcc:            data.cardTransactionMerchantCategoryCode ?? '',
      channel:        data.cardTransactionChannel ?? '',
      initiationType: data.cardTransactionInitiationType ?? null,
      maskedPan:      data.cardTransactionMaskedPanDisplay,
      status:         data.cardTransactionStatus,
      fraudCaseCreated: false,
      createdAt:      data.cardTransactionDateTime,
    });
    setApiTxn({
      paymentCardReference:                data.paymentCardReference,
      cardTransactionMerchantCategoryCode: data.cardTransactionMerchantCategoryCode,
      cardTransactionChannel:              data.cardTransactionChannel,
      cardTransactionInitiationType:       data.cardTransactionInitiationType,
      cardTransactionType:                 data.cardTransactionType,
      cardTransactionDescription:          data.cardTransactionDescription,
      cardTransactionNarrative:            data.cardTransactionNarrative,
    });

    // Customer-visible case notes via the dedicated customer-safe endpoint
    // (the /fraud endpoints themselves are not accessible to the customer role).
    api.transactions.getNotes(txnId, t).then(setCaseNotes).catch(() => null);

    if (showLoading) setLoading(false);
  }, [txnId]);

  useEffect(() => { loadData(true); }, [loadData]);
  // Live: a new customer-visible note (or a status change) appears without a manual refresh.
  const refresh = useCallback(() => { void loadData(false); }, [loadData]);
  useNotificationsStream(token, refresh);

  // Resolve the owner's saved card matching this transaction's token, so the card data can link
  // to its detail page. Customer-only; a removed (revoked) card simply won't match (no link).
  useEffect(() => {
    const cardToken = apiTxn?.paymentCardReference ?? txn?.cardToken;
    if (!token || !cardToken || decodeToken(token)?.role !== 'customer') return;
    let cancelled = false;
    (async () => {
      try {
        const me = await api.auth.me(token);
        const agId = (me.agreement as { customerAgreementInstanceReference?: string } | null)?.customerAgreementInstanceReference;
        if (!agId) return;
        const { results } = await api.customer.getCards(agId, token);
        const match = (results ?? []).find((c) => c.paymentCardReference === cardToken);
        if (!cancelled && match) setMatchedCardId(match.paymentCardInstanceReference as string);
      } catch { /* no link if lookup fails */ }
    })();
    return () => { cancelled = true; };
  }, [token, apiTxn?.paymentCardReference, txn?.cardToken]);

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

  if (notFound || (!txn && !p2pTransfer)) return (
    <PageShell {...shell}>
      <div className="text-center py-12 text-gray-500">
        <p className="mb-3">Transaction not found.</p>
        <Link href="/system/payment/history" className="inline-flex items-center gap-1.5 text-blue-600 hover:underline text-sm">
          ← Back to transactions
        </Link>
      </div>
    </PageShell>
  );

  // P2P transfer detail view (BIAN SD-65)
  if (p2pTransfer) {
    const isSent = p2pTransfer.initiatorPartyReference === user?.partyRef;
    const direction = isSent ? 'sent' : 'received';
    const fc = p2pTransfer.fraudCase;
    const isAnalyst = user?.role === 'level1_analyst' || user?.role === 'level2_investigator' || user?.role === 'security_auditor';
    return (
      <PageShell {...shell}>
        <Link href="/system/payment/history" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline mb-4">
          ← Back to transactions
        </Link>
        <div className="bg-white rounded-xl border p-5 mb-4">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">P2P Transfer</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${direction === 'sent' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                  {direction === 'sent' ? '↑ Sent' : '↓ Received'}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${p2pTransfer.paymentExecutionStatus === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                  {p2pTransfer.paymentExecutionStatus}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{p2pTransfer.initiatedAt ? new Date(p2pTransfer.initiatedAt).toLocaleString() : '—'}</p>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-2xl font-bold ${direction === 'sent' ? 'text-red-600' : 'text-green-700'}`}>
                {direction === 'sent' ? '−' : '+'}
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: p2pTransfer.currency }).format(p2pTransfer.grossAmount)}
              </p>
            </div>
          </div>

          {/* Sender ↔ Recipient blocks */}
          <div className="grid grid-cols-2 gap-3 text-sm border-t pt-4 mb-4">
            {/* Sender */}
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                Sender
                <FieldInfo label="Sender" description="The party who initiated and funded this P2P transfer. In BIAN SD-65 this is the Payment Execution initiator. Their payout account (SD-66) is debited." />
              </p>
              <p className="text-xs text-gray-500 flex items-center gap-0.5 mb-0.5">
                Party ID
                <FieldInfo label="Party ID" description="Unique identifier of the registered PSP customer who sent the funds (BIAN SD-13 Party Reference Directory)." />
              </p>
              <p className="font-mono text-xs text-gray-700 truncate mb-2">{p2pTransfer.initiatorPartyReference ?? '—'}</p>
              <p className="text-xs text-gray-500 flex items-center gap-0.5 mb-0.5">
                Payout account
                <FieldInfo label="Sender payout account" description="The SD-66 Payout Account Arrangement debited for this transfer. Funds are moved from availableAmount to the recipient's account atomically." />
              </p>
              {p2pTransfer.sourcePayoutAccountReference ? (
                <Link
                  href={`/system/accounts/${p2pTransfer.sourcePayoutAccountReference}`}
                  className="font-mono text-xs text-blue-600 hover:underline truncate block"
                >
                  {p2pTransfer.sourcePayoutAccountReference} ↗
                </Link>
              ) : <span className="font-mono text-xs text-gray-400">—</span>}
            </div>

            {/* Recipient */}
            <div className="bg-green-50 rounded-lg p-3 border border-green-100">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                Recipient
                <FieldInfo label="Recipient" description="The party who receives the funds. Identified via a registered beneficiary arrangement (BIAN SD-54 Counterparty Administration). Their payout account is credited." />
              </p>
              <p className="text-xs text-gray-500 flex items-center gap-0.5 mb-0.5">
                Party ID
                <FieldInfo label="Party ID" description="Unique identifier of the registered PSP customer who receives the funds (BIAN SD-13 Party Reference Directory). Only PSP-registered users can be internal P2P recipients." />
              </p>
              <p className="font-mono text-xs text-gray-700 truncate mb-2">{p2pTransfer.beneficiaryPartyReference ?? '—'}</p>
              <p className="text-xs text-gray-500 flex items-center gap-0.5 mb-0.5">
                Payout account
                <FieldInfo label="Recipient payout account" description="The SD-66 Payout Account Arrangement credited for this transfer. The resolved account is determined from the beneficiary arrangement at execution time." />
              </p>
              {p2pTransfer.resolvedPayoutAccountReference ? (
                <Link
                  href={`/system/accounts/${p2pTransfer.resolvedPayoutAccountReference}`}
                  className="font-mono text-xs text-green-600 hover:underline truncate block"
                >
                  {p2pTransfer.resolvedPayoutAccountReference} ↗
                </Link>
              ) : <span className="font-mono text-xs text-gray-400">—</span>}
            </div>
          </div>

          {/* Transfer metadata */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
            <FieldLabel info="The gross amount transferred before any fees are deducted. In BIAN SD-65 this is paymentExecutionGrossAmount.">Gross amount</FieldLabel>
            <span className="font-semibold">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: p2pTransfer.currency }).format(p2pTransfer.grossAmount)}
              <span className="ml-1 text-xs font-normal text-gray-400">{p2pTransfer.currency}</span>
            </span>

            {p2pTransfer.feeAmount > 0 && (<>
              <FieldLabel info="Fee charged by the PSP for processing this transfer. Deducted from the gross amount to arrive at the net amount credited to the recipient.">Fee</FieldLabel>
              <span className="text-red-600">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: p2pTransfer.currency }).format(p2pTransfer.feeAmount)}
              </span>
            </>)}

            <FieldLabel info="The net amount credited to the recipient's account after fee deduction. For zero-fee transfers gross = net.">Net amount</FieldLabel>
            <span>
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: p2pTransfer.currency }).format(p2pTransfer.netAmount)}
            </span>

            {p2pTransfer.paymentExecutionRail && (<>
              <FieldLabel info="The settlement rail used to route this transfer. internal_ledger means both accounts are held at this PSP and the movement is a book-entry with no external network involvement.">Settlement rail</FieldLabel>
              <span className="capitalize">{p2pTransfer.paymentExecutionRail.replace(/_/g, ' ')}</span>
            </>)}

            {p2pTransfer.routingNote && (<>
              <FieldLabel info="Free-text note attached by the sender or the system during routing. May describe the transfer purpose or carry internal routing metadata.">Note</FieldLabel>
              <span className="text-xs text-gray-700">{p2pTransfer.routingNote}</span>
            </>)}

            <FieldLabel info="UTC timestamp when the transfer was submitted by the sender. In BIAN SD-65 this is the PaymentExecutionProcedure initiation datetime.">Initiated at</FieldLabel>
            <span className="text-xs">{p2pTransfer.initiatedAt ? new Date(p2pTransfer.initiatedAt).toLocaleString() : '—'}</span>

            {p2pTransfer.completedAt && (<>
              <FieldLabel info="UTC timestamp when funds were confirmed as credited to the recipient's account and the execution record was marked completed.">Completed at</FieldLabel>
              <span className="text-xs">{new Date(p2pTransfer.completedAt).toLocaleString()}</span>
            </>)}

            <FieldLabel info="Unique immutable identifier for this payment execution (BIAN SD-65 paymentExecutionInstanceReference). Use this reference to look up audit events, compliance logs, or dispute records.">Transfer ID</FieldLabel>
            <span className="font-mono text-xs text-gray-500 break-all">{p2pTransfer.paymentExecutionInstanceReference}</span>

            <FieldLabel info="Lifecycle status of this payment execution as tracked in BIAN SD-65. 'completed' means funds have settled. 'pending' or 'failed' indicate an in-flight or error state.">Status</FieldLabel>
            <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded font-medium w-fit ${p2pTransfer.paymentExecutionStatus === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
              {p2pTransfer.paymentExecutionStatus}
            </span>
          </div>
        </div>

        {fc ? (
          <div className="bg-white rounded-xl border p-5 mb-4">
            <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-1">
              Security Review
              <FieldInfo label="Security Review" description="A FraudDiagnosisCase (BIAN SD-83) opened automatically when FDS, HRP (sanctions), or AML providers signal risk during the compliance pipeline. Opened in parallel with transfer settlement — does not block funds." />
            </h2>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-xs text-gray-500">{fc.fraudDiagnosisCaseReference}</span>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                fc.fraudDiagnosisCaseStatus === 'escalated'        ? 'bg-orange-100 text-orange-800' :
                fc.fraudDiagnosisCaseStatus === 'resolved_fraud'   ? 'bg-red-100 text-red-800' :
                fc.fraudDiagnosisCaseStatus === 'resolved_cleared' ? 'bg-green-100 text-green-800' :
                fc.fraudDiagnosisCaseStatus === 'closed'           ? 'bg-gray-100 text-gray-700' :
                'bg-amber-100 text-amber-800'
              }`}>{fc.fraudDiagnosisCaseStatus.replace(/_/g, ' ')}</span>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                fc.fraudDiagnosisCaseSeverity === 'critical' ? 'bg-red-600 text-white' :
                fc.fraudDiagnosisCaseSeverity === 'high'     ? 'bg-red-500 text-white' :
                fc.fraudDiagnosisCaseSeverity === 'medium'   ? 'bg-yellow-500 text-black' :
                'bg-green-600 text-white'
              }`}>{fc.fraudDiagnosisCaseSeverity.toUpperCase()}</span>
            </div>

            {fc.riskIndicators.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1 uppercase flex items-center gap-1">
                  Risk indicators
                  <FieldInfo label="Risk indicators" description="Signals returned by FDS (Fraud Detection Score), HRP (High-Risk Party / sanctions screening), or AML (Anti-Money Laundering) providers. Each indicator corresponds to a specific compliance gate that flagged the transfer." />
                </p>
                <div className="flex flex-wrap gap-1">
                  {fc.riskIndicators.map((ind) => (
                    <span key={ind} className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">{ind}</span>
                  ))}
                </div>
              </div>
            )}

            {fc.subsystemSignals && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-600 mb-1 uppercase flex items-center gap-1">
                  Subsystem signals
                  <FieldInfo label="Subsystem signals" description="Raw aggregated responses from each compliance provider (FDS score, HRP match result, AML alert level). Extracted from the correlated event trail and attached to the fraud case for investigator context." />
                </p>
                <pre className="text-xs bg-gray-50 rounded p-2 overflow-x-auto text-gray-700">{JSON.stringify(fc.subsystemSignals, null, 2)}</pre>
              </div>
            )}

            {isAnalyst && (
              <Link href={`/system/investigation/${fc.fraudDiagnosisInstanceReference}`} className="inline-flex items-center gap-1.5 text-sm text-[#001E2B] hover:underline font-medium">
                Open fraud investigation ↗
              </Link>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border p-5 text-center text-sm text-gray-500">
            ✓ No security review triggered for this transfer.
          </div>
        )}
      </PageShell>
    );
  }

  // After the P2P branch, txn is guaranteed non-null (both guards above ensure it).
  if (!txn) return null;

  const visibleEvents = events.filter((e) => Object.keys(EVENT_META).includes(e.actionType));

  return (
    <PageShell {...shell}>
      <Link href="/system/payment/history" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline mb-4">
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
          {/* Card info; links to the saved card detail when it's one of the customer's cards */}
          <span className="text-gray-500">Card (masked)</span>
          {matchedCardId ? (
            <Link href={`/system/cards/${matchedCardId}?from=history&txnId=${txnId}`} className="font-mono text-[#001E2B] hover:underline inline-flex items-center gap-1 w-fit">
              {txn.maskedPan} <span className="text-xs text-gray-400">↗</span>
            </Link>
          ) : (
            <span className="font-mono">{txn.maskedPan}</span>
          )}

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
              <div className="flex items-center gap-2">
                <CardTokenField token={(apiTxn?.paymentCardReference ?? txn.cardToken)!} />
                {matchedCardId && (
                  <Link href={`/system/cards/${matchedCardId}?from=history&txnId=${txnId}`} className="text-xs text-[#001E2B] hover:underline shrink-0">
                    Manage card ↗
                  </Link>
                )}
              </div>
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

          {apiTxn?.cardTransactionType && (
            <>
              <span className="text-gray-500">Transaction type</span>
              <span className="capitalize">{apiTxn.cardTransactionType.replace('_', ' ')}</span>
            </>
          )}

          {apiTxn?.cardTransactionDescription && (
            <>
              <span className="text-gray-500">Statement descriptor</span>
              <span className="font-mono text-xs">{apiTxn.cardTransactionDescription}</span>
            </>
          )}

          {apiTxn?.cardTransactionNarrative && (
            <>
              <span className="text-gray-500">Description</span>
              <span className="text-xs text-gray-700">{apiTxn.cardTransactionNarrative}</span>
            </>
          )}

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
      </div>

      {/* Notes and messages from the security team */}
      {caseNotes?.caseFound && (
        <div className="bg-white rounded-xl border p-5 space-y-3 mb-4">
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

          {/* Customer-visible notes list */}
          {caseNotes.notes && caseNotes.notes.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-blue-700 uppercase">✉ Messages from security team</p>
              {caseNotes.notes.map((note) => (
                <div key={note.noteId} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-900">{note.noteText}</p>
                  <p className="text-xs text-blue-500 mt-1">
                    {new Date(note.actionDateTime).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">No messages from the security team yet.</p>
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

      {/* Customer questions from L1/L2 (ADR-031); answer Yes/No/Other, immutable once submitted. */}
      {token && <CustomerQuestionsPanel txnId={txnId} token={token} onAnswered={refresh} />}

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

      {/* Debug: unified raw data panel - separated with proportional margin */}
      {debugMode && (
        <div className="p-5 mb-4">
          <RawMongoPanel
          token={token}
          title="Debug - Raw data"
          sections={[
            {
              kind: 'static',
              label: 'PCI DSS / BIAN - what is stored',
              labelColor: 'text-[#00ED64]',
              description: 'This transaction stores no cardholder data; sensitive fields are encrypted at rest',
              data: {
                storedEncryptedAtRest: {
                  cardTransactionAccountReference: 'QE:equality (searchable, ciphertext only in Atlas)',
                  rawGatewayPayload: 'QE:none (encrypted, requires escalation to read)',
                  processorMetadata: 'QE:none (encrypted)',
                },
                storedInClear_nonSensitive: {
                  maskedPanDisplay: '****-****-****-XXXX (PCI-permitted)',
                  cardToken: 'surrogate token (not the PAN, not CHD)',
                  amount: true, merchantName: true, status: true,
                },
                neverStored: ['full PAN', 'CVV / CVV2', 'PIN', 'magnetic track data'],
                alignment: { bian: 'SD-254 Card Transaction', pciDss: ['Req 3 (no PAN/CVV at rest)', 'Req 10 (auditable)'] },
              },
            },
            {
              kind: 'static',
              label: 'localStorage - stored transaction',
              description: 'Data saved locally when this payment was made',
              data: txn,
            },
            {
              kind: 'static',
              label: 'API - GET /api/v1/transactions/:id',
              labelColor: 'text-yellow-400',
              description: 'Backend response including decrypted QE:equality fields',
              data: apiTxn,
            },
            {
              kind: 'static',
              label: 'API - GET /api/v1/transactions/:id/notes',
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
              description: 'QE:equality (accountRef) + QE:none (rawGatewayPayload, processorMetadata) inline - v2 unified document',
            },
            ...(txn.caseId ? [{
              kind: 'mongo' as const,
              collection: 'fraudDiagnosisCase',
              id: txn.caseId,
              label: 'fraudDiagnosisCase',
              labelColor: 'text-blue-400',
              description: 'Raw fraud case document as stored in Atlas (SD-83)',
            }] : []),
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
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6">
        {children}
      </main>
    </div>
  );
}

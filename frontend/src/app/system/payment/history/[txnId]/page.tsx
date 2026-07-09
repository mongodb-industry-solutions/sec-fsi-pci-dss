'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase, ActionEvent, TransactionNotesResponse } from '../../../../../lib/api';
import { getToken, decodeToken } from '../../../../../lib/auth';
import { useDebugMode } from '../../../../../lib/debugMode';
import { Check, Copy, Eye, EyeOff, Info } from 'lucide-react';
import { RawMongoPanel } from '../../../../../components/RawMongoPanel';
import { CustomerQuestionsPanel } from '../../../../../components/CustomerQuestionsPanel';
import { useNotificationsStream } from '../../../../../lib/useNotificationsStream';

// Inline tooltip with floating popup.
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
      <button type="button" onClick={() => setOpen(v => !v)}
        className="ml-1 text-gray-300 hover:text-gray-500 transition-colors align-middle" title={`About: ${label}`}>
        <Info size={12} />
      </button>
      {open && (
        <div className="absolute z-50 bottom-full left-0 mb-1.5 w-72 max-w-xs bg-[#001E2B] text-white text-xs rounded-lg shadow-xl p-3 leading-relaxed whitespace-normal">
          <span className="block font-semibold mb-1 text-[#00ED64]">{label}</span>
          <span className="block">{description}</span>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children, info }: { children: React.ReactNode; info: string }) {
  return (
    <span className="text-gray-500 flex items-center gap-0.5 min-w-0">
      {children}
      <FieldInfo label={String(children)} description={info} />
    </span>
  );
}

// One-click copy with a transient ✓ confirmation.
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button type="button" onClick={copy}
      className="ml-1.5 text-gray-300 hover:text-gray-500 transition-colors shrink-0" title="Copy to clipboard">
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  );
}

// Label + value row for the shared metadata grid — two fixed columns.
function MetaRow({ label, info, children }: { label: string; info: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-gray-500 text-sm flex items-center gap-0.5 min-w-0 whitespace-nowrap">
        {label}
        <FieldInfo label={label} description={info} />
      </span>
      <span className="text-sm min-w-0">{children}</span>
    </>
  );
}

// Label + value pair inside a Sender/Recipient block.
// Renders as two grid cells (dt + dd) so the parent <dl> grid aligns all labels/values.
// On small screens the parent switches to 1-col, stacking dt above dd.
function BlockRow({ label, info, children }: { label: string; info: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-gray-500 whitespace-nowrap flex items-center gap-0.5 self-baseline leading-5">
        {label}
        <FieldInfo label={label} description={info} />
      </dt>
      <dd className="text-xs min-w-0 break-all m-0 leading-5">{children}</dd>
    </>
  );
}

// Common status → display mapping shared by card + P2P sections.
function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-800',
    authorized: 'bg-green-100 text-green-800',
    settled: 'bg-emerald-100 text-emerald-800 font-semibold',
    under_review: 'bg-amber-100 text-amber-800',
    open: 'bg-amber-100 text-amber-800',
    escalated: 'bg-orange-100 text-orange-800',
    resolved_cleared: 'bg-green-100 text-green-800',
    resolved_fraud: 'bg-red-100 text-red-800',
    closed: 'bg-gray-100 text-gray-700',
    declined: 'bg-red-100 text-red-800',
    failed: 'bg-red-100 text-red-800',
    pending: 'bg-blue-100 text-blue-800',
  };
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded font-medium w-fit ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
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
    initiatorName: string | null;
    beneficiaryPartyReference: string | null;
    sourcePayoutAccountReference: string | null;
    sourceAccountMasked: string | null;
    resolvedPayoutAccountReference: string | null;
    beneficiaryArrangementReference: string | null;
    beneficiaryAlias: string | null;
    beneficiaryName: string | null;
    destinationIban: string | null;
    destinationAccountMasked: string | null;
    destinationCountry: string | null;
    grossAmount: number;
    netAmount: number;
    feeAmount: number;
    currency: string;
    recipientCurrency: string | null;
    recipientAmount: number | null;
    fxRate: number | null;
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

          {/* Sender ↔ Recipient — customer only sees their own account (GDPR / privacy) */}
          {(() => {
            const isCustomer = user?.role === 'customer';
            const isReceived = p2pTransfer.beneficiaryPartyReference === user?.partyRef;
            // Privacy: a recipient does not see the sender's source account. But the SENDER always
            // sees the recipient they chose (their registered beneficiary / destination account),
            // and the recipient sees their own destination — so the Recipient block is visible to
            // both involved parties; only the Sender block is hidden from the recipient.
            const canSeeSource = !isCustomer || isSent;
            const canSeeDest   = !isCustomer || isSent || isReceived;
            // The beneficiary arrangement (SD-54) belongs to the SENDER (it is their saved contact),
            // so only the sender or staff may open it. For the RECIPIENT the arrangement is a foreign
            // record (access denied), and it is also redundant — they are the beneficiary. Show them
            // their own credited payout account (SD-66) instead, so they can verify the funds landed.
            const showBeneficiaryLink = !!p2pTransfer.beneficiaryArrangementReference && (isSent || !isCustomer);
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm border-t pt-4 mb-4">
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                  <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                    Sender
                    <FieldInfo label="Sender" description="The party who initiated and funded this P2P transfer (BIAN SD-65 initiator). Their payout account (SD-66) is debited atomically." />
                  </div>
                  {(p2pTransfer.initiatorName || canSeeSource || p2pTransfer.sourceAccountMasked) ? (
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                      {/* Payer name: shown to both parties, as on a SEPA/PSD2 statement (debtor name to payee). */}
                      {p2pTransfer.initiatorName && (
                        <BlockRow label="From" info="Name of the party who initiated and funded this transfer (BIAN SD-65 initiator, SD-13 party). Disclosed to the recipient the same way a SEPA/PSD2 credit transfer shows the payer name on the payee's statement.">
                          <span className="text-gray-800">{p2pTransfer.initiatorName}</span>
                        </BlockRow>
                      )}
                      {canSeeSource ? (
                        // Account owner (sender) or authorised staff: full reference + link to the account.
                        <BlockRow label="Payout account" info="SD-66 Payout Account Arrangement debited for this transfer. Only the account holder and authorised staff see the full reference and can open the account.">
                          {p2pTransfer.sourcePayoutAccountReference ? (
                            <Link href={`/system/accounts/${p2pTransfer.sourcePayoutAccountReference}`}
                              className="font-mono text-blue-600 hover:underline">
                              {p2pTransfer.sourcePayoutAccountReference} ↗
                            </Link>
                          ) : <span className="text-gray-400">—</span>}
                        </BlockRow>
                      ) : p2pTransfer.sourceAccountMasked ? (
                        // Recipient: origin account masked to last-4 (GDPR minimisation). No full IBAN,
                        // no openable link to the sender's account (a foreign SD-66 record). Not PCI-scoped
                        // (a bank account/IBAN is not card data), so no PAN is involved.
                        <BlockRow label="Source account" info="Origin account masked to the last 4 digits (GDPR data minimisation). Enough to reconcile the incoming payment without exposing the sender's full IBAN or their account record.">
                          <span className="font-mono text-gray-700">{p2pTransfer.sourceAccountMasked}</span>
                        </BlockRow>
                      ) : null}
                    </dl>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Sender details not available</p>
                  )}
                </div>

                <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                  <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                    Recipient
                    <FieldInfo label="Recipient" description="The PSP-registered party receiving the funds (BIAN SD-54 Counterparty Administration). Their payout account is credited at execution time." />
                  </div>
                  {canSeeDest ? (
                    // One link per known resource, no duplication (priority order):
                    //  1. saved beneficiary (SD-54)  → link the contact only, and ONLY for the sender
                    //     or staff (the recipient does not own this arrangement — see showBeneficiaryLink)
                    //  2. registered payout account (SD-66) → link the destination account (the
                    //     recipient's own credited account when they are viewing a received transfer)
                    //  3. unregistered external → full IBAN the user typed (GDPR Art. 32 / PSD2:
                    //     QE-encrypted at rest, shown to the owner; not PCI-scoped card data)
                    showBeneficiaryLink ? (
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                        {/* Friendly alias first (owner-defined SD-54 label), then the opaque reference link. */}
                        {(p2pTransfer.beneficiaryAlias || p2pTransfer.beneficiaryName) && (
                          <BlockRow label="To" info="The saved payee this transfer was sent to: your own label for the beneficiary (SD-54 counterpartyLabel), or the account holder name.">
                            <span className="text-gray-800">{p2pTransfer.beneficiaryAlias ?? p2pTransfer.beneficiaryName}</span>
                          </BlockRow>
                        )}
                        <BlockRow label="Beneficiary" info="SD-54 Counterparty Administration — the saved contact this transfer was sent to. Open it to see the beneficiary's details.">
                          <Link href={`/system/beneficiaries/${encodeURIComponent(p2pTransfer.beneficiaryArrangementReference!)}`}
                            className="font-mono text-green-600 hover:underline">
                            {p2pTransfer.beneficiaryArrangementReference} ↗
                          </Link>
                        </BlockRow>
                      </dl>
                    ) : p2pTransfer.resolvedPayoutAccountReference ? (
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                        <BlockRow label="Payout account" info="SD-66 Payout Account Arrangement credited for this transfer — a registered destination account. Open it to see the account details.">
                          <Link href={`/system/accounts/${p2pTransfer.resolvedPayoutAccountReference}`}
                            className="font-mono text-green-600 hover:underline">
                            {p2pTransfer.resolvedPayoutAccountReference} ↗
                          </Link>
                        </BlockRow>
                      </dl>
                    ) : (p2pTransfer.beneficiaryName || p2pTransfer.destinationIban || p2pTransfer.destinationAccountMasked || p2pTransfer.destinationCountry) ? (
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                        <BlockRow label="Beneficiary" info="Account holder name as entered at initiation. This external account is not registered in the PSP, so there is no in-system party to link.">
                          {p2pTransfer.beneficiaryName
                            ? <span>{p2pTransfer.beneficiaryName}</span>
                            : <span className="text-gray-400">not provided</span>}
                        </BlockRow>
                        <BlockRow label="Destination IBAN" info="Full destination IBAN (ISO 13616) for this transfer. Stored encrypted at rest (GDPR Art. 32 / PSD2) and shown to the account owner and authorised staff — this is bank data, not PCI-scoped card data.">
                          {p2pTransfer.destinationIban
                            ? <span className="font-mono break-all">{p2pTransfer.destinationIban}</span>
                            : p2pTransfer.destinationAccountMasked
                              ? <span className="font-mono">{p2pTransfer.destinationAccountMasked}</span>
                              : <span className="text-gray-400">—</span>}
                        </BlockRow>
                        <BlockRow label="Country" info="ISO 3166-1 destination banking country used to derive the settlement rail (SEPA / ACH / SWIFT).">
                          {p2pTransfer.destinationCountry
                            ? <span className="font-mono">{p2pTransfer.destinationCountry}</span>
                            : <span className="text-gray-400">—</span>}
                        </BlockRow>
                      </dl>
                    ) : (
                      <p className="text-xs text-gray-400 italic">Recipient not resolved</p>
                    )
                  ) : (
                    <p className="text-xs text-gray-400 italic">Account details not disclosed (privacy)</p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Shared metadata grid */}
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
            <MetaRow label="Gross amount" info="Amount transferred before any fees (BIAN SD-65 paymentExecutionGrossAmount).">
              <span className="font-semibold">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: p2pTransfer.currency }).format(p2pTransfer.grossAmount)}
                <span className="ml-1 text-xs font-normal text-gray-400">{p2pTransfer.currency}</span>
              </span>
            </MetaRow>

            {p2pTransfer.feeAmount > 0 && (
              <MetaRow label="Fee" info="PSP processing fee deducted from the gross amount.">
                <span className="text-red-600">{new Intl.NumberFormat('en-US', { style: 'currency', currency: p2pTransfer.currency }).format(p2pTransfer.feeAmount)}</span>
              </MetaRow>
            )}

            <MetaRow label="Net amount" info="Amount credited to the recipient after fee deduction. Equal to gross when fee is zero.">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: p2pTransfer.currency }).format(p2pTransfer.netAmount)}
            </MetaRow>

            {p2pTransfer.fxRate != null && p2pTransfer.recipientCurrency && (
              <MetaRow label="FX rate" info={`Exchange rate applied at execution time (BIAN SD-65). Sender was debited in ${p2pTransfer.currency}; recipient was credited in ${p2pTransfer.recipientCurrency} at this rate.`}>
                <span className="font-mono">
                  1 {p2pTransfer.currency} = {p2pTransfer.fxRate.toFixed(6)} {p2pTransfer.recipientCurrency}
                  {p2pTransfer.recipientAmount != null && (
                    <span className="ml-2 text-gray-400">
                      → {new Intl.NumberFormat('en-US', { style: 'currency', currency: p2pTransfer.recipientCurrency }).format(p2pTransfer.recipientAmount)}
                    </span>
                  )}
                </span>
              </MetaRow>
            )}

            <MetaRow label="Status" info="Lifecycle status of this payment execution (BIAN SD-65). 'completed' means funds have settled.">
              <StatusChip status={p2pTransfer.paymentExecutionStatus} />
            </MetaRow>

            {p2pTransfer.routingNote && (
              <MetaRow label="Description" info="Note or justification attached by the sender at time of transfer. Serves as the transaction narrative and appears on both parties' account statements.">
                <span className="text-xs text-gray-700">{p2pTransfer.routingNote}</span>
              </MetaRow>
            )}

            {p2pTransfer.paymentExecutionRail && (
              <MetaRow label="Settlement rail" info="The rail used to settle this transfer. internal_ledger = both accounts at this PSP, book-entry with no external network involvement.">
                <span className="capitalize">{p2pTransfer.paymentExecutionRail.replace(/_/g, ' ')}</span>
              </MetaRow>
            )}

            <MetaRow label="Initiated at" info="UTC timestamp when the sender submitted the transfer (BIAN SD-65 PaymentExecutionProcedure initiation datetime).">
              <span className="text-xs">{p2pTransfer.initiatedAt ? new Date(p2pTransfer.initiatedAt).toLocaleString() : '—'}</span>
            </MetaRow>

            <MetaRow label="Completed at" info="UTC timestamp when funds were confirmed as credited to the recipient's account.">
              <span className="text-xs">{p2pTransfer.completedAt ? new Date(p2pTransfer.completedAt).toLocaleString() : (p2pTransfer.initiatedAt ? new Date(p2pTransfer.initiatedAt).toLocaleString() : '—')}</span>
            </MetaRow>

            <MetaRow label="Transaction ID" info="Unique immutable reference for this payment execution (BIAN SD-65 paymentExecutionInstanceReference). Use to look up audit events, compliance logs, or open a dispute.">
              <span className="flex items-center gap-1 min-w-0">
                <span className="font-mono text-xs text-gray-500 break-all">{p2pTransfer.paymentExecutionInstanceReference}</span>
                <CopyButton value={p2pTransfer.paymentExecutionInstanceReference} />
              </span>
            </MetaRow>
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
                <div className="text-xs font-semibold text-gray-600 mb-1 uppercase flex items-center gap-1">
                  Risk indicators
                  <FieldInfo label="Risk indicators" description="Signals returned by FDS (Fraud Detection Score), HRP (High-Risk Party / sanctions screening), or AML (Anti-Money Laundering) providers. Each indicator corresponds to a specific compliance gate that flagged the transfer." />
                </div>
                <div className="flex flex-wrap gap-1">
                  {fc.riskIndicators.map((ind) => (
                    <span key={ind} className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">{ind}</span>
                  ))}
                </div>
              </div>
            )}

            {fc.subsystemSignals && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-gray-600 mb-1 uppercase flex items-center gap-1">
                  Subsystem signals
                  <FieldInfo label="Subsystem signals" description="Raw aggregated responses from each compliance provider (FDS score, HRP match result, AML alert level). Extracted from the correlated event trail and attached to the fraud case for investigator context." />
                </div>
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
      {(() => {
        const isRefund = apiTxn?.cardTransactionType === 'refund';
        const cardDirection = isRefund ? 'credit' : 'debit';
        return (
      <div className="bg-white rounded-xl border p-5 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{txn.merchant}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded font-medium border ${cardDirection === 'debit' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                {cardDirection === 'debit' ? '↑ Sent' : '↓ Received'}
              </span>
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium ${statusMeta.color}`}>
                <span>{statusMeta.icon}</span>
                {statusMeta.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{new Date(txn.createdAt).toLocaleString()}</p>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-2xl font-bold ${cardDirection === 'debit' ? 'text-red-600' : 'text-green-700'}`}>
              {cardDirection === 'debit' ? '−' : '+'}
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.currency }).format(txn.amount)}
            </p>
            <span className="text-xs text-gray-400 font-normal">{txn.currency}</span>
          </div>
        </div>

        {/* Sender ↔ Recipient — consistent layout across all transaction types */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm border-t pt-4 mb-4">
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
            <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2 flex items-center gap-1">
              Sender
              <FieldInfo label="Sender" description="The cardholder who authorised this transaction (BIAN SD-88). The funding payout account (SD-66) is debited at authorisation; the hold is cleared at settlement." />
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <BlockRow label="Card" info="PAN masked to last 4 digits per PCI DSS Req 3.3. The full PAN is never stored after authorisation. Click to manage the card.">
                {matchedCardId ? (
                  <Link href={`/system/cards/${matchedCardId}?from=history&txnId=${txnId}`}
                    className="font-mono text-blue-600 hover:underline">{txn.maskedPan} ↗</Link>
                ) : (
                  <span className="font-mono text-gray-700">{txn.maskedPan}</span>
                )}
              </BlockRow>
              {txn.network && (
                <BlockRow label="Network" info="Card network (Visa, Mastercard, etc.) that processed the authorisation. Determines interchange rules and dispute resolution process.">
                  <span className="text-gray-700">{txn.network}</span>
                </BlockRow>
              )}
              {(apiTxn?.paymentCardReference || txn.cardToken) && (
                <BlockRow label="Card token" info="Opaque reference replacing the PAN for downstream processing (tokenisation per PCI DSS Req 3.5). Use this token to link the card to related transactions.">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <CardTokenField token={(apiTxn?.paymentCardReference ?? txn.cardToken)!} />
                    {matchedCardId && (
                      <Link href={`/system/cards/${matchedCardId}?from=history&txnId=${txnId}`}
                        className="text-[#001E2B] hover:underline shrink-0">Manage ↗</Link>
                    )}
                  </span>
                </BlockRow>
              )}
            </dl>
          </div>

          <div className="bg-orange-50 rounded-lg p-3 border border-orange-100">
            <div className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2 flex items-center gap-1">
              Recipient
              <FieldInfo label="Recipient (Merchant)" description="The merchant who received the funds (BIAN SD-89 Merchant Agreement). MCC is disclosed to cardholders per Visa/Mastercard Core Rules — it appears on official statements." />
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <BlockRow label="Merchant" info="Name of the merchant as reported by the acquiring bank in the authorisation request.">
                <span className="font-medium text-gray-800">{txn.merchant}</span>
              </BlockRow>
              <BlockRow label="MCC" info="4-digit ISO 18245 Merchant Category Code. Disclosed to cardholders on statements per Visa/Mastercard Core Rules (VCCR 5.8.4). Used for spend controls and tax reporting.">
                <span className="font-mono text-gray-700">{apiTxn?.cardTransactionMerchantCategoryCode ?? txn.mcc}</span>
              </BlockRow>
            </dl>
          </div>
        </div>

        {/* Shared metadata grid — no duplication of Sender/Recipient data above */}
        <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5">
          <MetaRow label="Gross amount" info="Transaction amount as submitted by the merchant at authorisation (BIAN SD-254 cardTransactionAmount). Pending amounts may differ from final settled amount.">
            <span className="font-semibold">
              {new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.currency }).format(txn.amount)}
              <span className="ml-1 text-xs font-normal text-gray-400">{txn.currency}</span>
            </span>
          </MetaRow>

          <MetaRow label="Net amount" info="Final settled amount after any adjustments, reversals, or partial captures. Equal to gross for standard single-capture authorisations.">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.currency }).format(txn.amount)}
          </MetaRow>

          <MetaRow label="Status" info="Lifecycle status of this card transaction. 'authorized' = hold placed; 'settled' = funds disbursed to merchant; 'under_review' = fraud investigation open.">
            <StatusChip status={txn.status} />
          </MetaRow>

          {(apiTxn?.cardTransactionDescription || apiTxn?.cardTransactionNarrative) && (
            <MetaRow label="Description" info="Transaction narrative: the statement descriptor from the acquirer plus any enrichment added by the PSP. This is the text that appears on the cardholder's statement as the transaction justification.">
              <span className="text-xs text-gray-700">
                {apiTxn?.cardTransactionNarrative ?? apiTxn?.cardTransactionDescription}
              </span>
            </MetaRow>
          )}

          <MetaRow label="Channel" info="How the cardholder presented the card. POS = physical terminal, online = e-commerce CNP, contactless = NFC tap, ATM = cash withdrawal.">
            {CHANNEL_LABELS[apiTxn?.cardTransactionChannel ?? txn.channel] ?? txn.channel}
          </MetaRow>

          {(apiTxn?.cardTransactionInitiationType || txn.initiationType) && (
            <MetaRow label="Initiation" info="CIT = Customer Initiated Transaction (cardholder present). MIT = Merchant Initiated (no real-time cardholder interaction — subscriptions, instalments). Governed by EMVCo 3DS and Visa/Mastercard stored-credential rules.">
              {(apiTxn?.cardTransactionInitiationType ?? txn.initiationType) === 'customerInitiated'
                ? 'Customer Initiated (CIT)' : 'Merchant Initiated (MIT)'}
            </MetaRow>
          )}

          {apiTxn?.cardTransactionType && (
            <MetaRow label="Transaction type" info="Subtype: purchase (debit), refund (credit to cardholder), fee, or reversal. Determines the direction of the balance movement on the SD-66 payout account.">
              <span className="capitalize">{apiTxn.cardTransactionType.replace('_', ' ')}</span>
            </MetaRow>
          )}

          {txn.paymentReference && (
            <MetaRow label="Reference" info="External reference assigned by the acquirer or card scheme. Used for reconciliation and dispute filing (chargeback reason codes per Visa Dispute Resolution Rules).">
              {txn.paymentReference}
            </MetaRow>
          )}

          {fraudCase?.fraudDiagnosisCaseReference && (
            <MetaRow label="Case reference" info="FraudDiagnosisCase reference (BIAN SD-83). Present when FDS, HRP (sanctions), or AML flagged a risk during post-authorisation compliance checks.">
              <span className="font-mono text-xs">{fraudCase.fraudDiagnosisCaseReference}</span>
            </MetaRow>
          )}

          <MetaRow label="Initiated at" info="UTC timestamp of the original authorisation request (BIAN SD-254 cardTransactionDateTime). This is when the card was first presented and the hold was placed.">
            <span className="text-xs">{new Date(txn.createdAt).toLocaleString()}</span>
          </MetaRow>

          <MetaRow label="Completed at" info="UTC timestamp when the transaction settled and the final amount was posted to the cardholder's account. For pending/authorized transactions this matches Initiated at.">
            <span className="text-xs">{new Date(txn.createdAt).toLocaleString()}</span>
          </MetaRow>

          <MetaRow label="Transaction ID" info="Unique immutable identifier (BIAN SD-254 cardTransactionInstanceReference). Use this ID to search audit events, the correlated event trail, or to reference this transaction in a dispute or investigation.">
            <span className="flex items-center gap-1 min-w-0">
              <span className="font-mono text-xs text-gray-500 break-all">{txn.txnId}</span>
              <CopyButton value={txn.txnId} />
            </span>
          </MetaRow>
        </div>
      </div>
        );
      })()}

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

'use client';
import { Fragment, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { useDebugMode } from '../../../../lib/debugMode';
import { DisplayMask } from '../../../../components/record/DisplayMask';
import { SensitiveReveal } from '../../../../components/SensitiveReveal';
import { RawMongoPanel } from '../../../../components/RawMongoPanel';
import { Breadcrumb, type Crumb } from '../../../../components/Breadcrumb';
import { useResource } from '../../../../lib/useResource';
import { useEffectivePermissions } from '../../../../lib/permissions';
import { AuditTrailLink } from '../../../../components/AuditTrailLink';
import { AccessDenied } from '../../../../components/AccessDenied';
import { useCaseEscalation } from '../../../../lib/useCaseEscalation';
import { Tooltip } from '../../../../components/Tooltip';
import { Eye, EyeOff, UserCheck, Store, ChevronRight, CreditCard, Landmark, Lock, AlertTriangle, ArrowLeft } from 'lucide-react';

type TxnDetail = Awaited<ReturnType<typeof api.transactions.getById>>;

const STATUS_COLORS: Record<string, string> = {
  authorized: 'bg-green-100 text-green-800',
  settled:    'bg-green-100 text-green-800',
  disputed:   'bg-red-100 text-red-800',
  declined:   'bg-red-100 text-red-800',
  pending:    'bg-amber-100 text-amber-800',
};

const CHANNEL_LABELS: Record<string, string> = {
  online:      'Online (e-commerce)',
  pos:         'Point of Sale (POS)',
  contactless: 'Contactless (NFC/tap)',
  atm:         'ATM withdrawal',
};

const INIT_LABELS: Record<string, string> = {
  customerInitiated: 'Customer Initiated (CIT)',
  merchantInitiated: 'Merchant Initiated (MIT)',
};

// v32 C1: the value masked here is the LOOKUP-tier account reference (QE:equality) of the party
// under investigation, which the caller is authorised to hold, so this is a screen-sharing mask and
// not an access control. It delegates to the shared DisplayMask, whose tooltip says so, instead of
// implying a disclosure decision that never happens. Sensitive-tier (QE:none) values on this page go
// through SensitiveReveal, which fetches from an audited endpoint (ADR-052).
function RevealField({ label, value, type }: { label: string; value: string; type: 'qe-equality' | 'qe-none' }) {
  return (
    <DisplayMask
      label={label}
      value={value}
      chrome={<EncryptionBadge label="" type={type} />}
    />
  );
}

// Grid label cell with an optional info tooltip, so an auditor understands each field's meaning.
function InfoLabel({ label, tip }: { label: string; tip?: string }) {
  return (
    <span className="text-gray-500 flex items-center">
      {label}
      {tip && <Tooltip text={tip} />}
    </span>
  );
}

export default function TransactionDetailPage() {
  const { txnId } = useParams<{ txnId: string }>();
  const router = useRouter();

  const [token, setToken] = useState('');
  const [role, setRole] = useState('level1_analyst');
  const [authReady, setAuthReady] = useState(false);
  const [linkedCase, setLinkedCase] = useState<{ id: string; ref: string; status: string } | null>(null);
  const [approving, setApproving] = useState(false);
  const [openingCase, setOpeningCase] = useState(false);
  const [openCaseError, setOpenCaseError] = useState<string | null>(null);
  // FDS/AML: how many customers hold the card used in this transaction (shared-card signal).
  const [cardHolders, setCardHolders] = useState<number | null>(null);

  // Parties involved (role-gated by the backend): customer (KYC) + merchant (KYB).
  const [partyCustomer, setPartyCustomer] = useState<Record<string, unknown> | null>(null);
  const [partyMerchant, setPartyMerchant] = useState<Record<string, unknown> | null>(null);
  // True once customer resolution has run, so the KYC panel can distinguish "loading" from
  // "no PSP customer" (external card-not-present) instead of spinning forever.
  const [custResolveDone, setCustResolveDone] = useState(false);
  // Investigation pivot: card/owner/funding-account UUIDs resolved from the transaction's token.
  const [cardResolved, setCardResolved] = useState<{ cardInstanceRef?: string; agreementUuid?: string; fundingAccountRef?: string } | null>(null);
  // Funding (payer source) bank account: masked by default, IBAN revealed on demand (GDPR/PSD2).
  const [fundingAccount, setFundingAccount] = useState<Record<string, unknown> | null>(null);
  const [ibanShown, setIbanShown] = useState(false);
  const [ibanValue, setIbanValue] = useState<string | null>(null);
  const [ibanLoading, setIbanLoading] = useState(false);
  // Breadcrumb context: a transaction opened from a case reflects that path.
  const [fromCase, setFromCase] = useState<{ caseId: string; caseRef?: string } | null>(null);
  const { loading: permLoading, can: canPerm } = useEffectivePermissions();
  const canViewTxn = canPerm('transactions', 'view');

  useEffect(() => {
    const t = getToken() ?? '';
    const user = t ? decodeToken(t) : null;
    if (user?.role === 'customer') { router.replace('/system/payment/history'); return; }
    setToken(t);
    setRole(user?.role ?? 'level1_analyst');
    setAuthReady(true);

    // Linked case is lightweight and independent of the cached transaction resource.
    api.fraud.list({ transactionId: txnId, limit: 1 }, t).then((cd) => {
      const c = cd?.results?.[0];
      if (c) setLinkedCase({ id: c.fraudDiagnosisInstanceReference, ref: c.fraudDiagnosisCaseReference, status: c.caseStatus });
    }).catch(() => {});

    // Breadcrumb context from the navigation that led here (no PII; ids/refs only).
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const cid = sp.get('caseId');
      if (sp.get('from') === 'investigation' && cid) {
        setFromCase({ caseId: cid, caseRef: sp.get('caseRef') ?? undefined });
      }
    }
  }, [txnId, router]);

  // Sensitive access comes from the case this transaction belongs to: the one we navigated from,
  // or the linked case. Reused from this tab, or re-derived when its escalation was accepted.
  const escalationCaseId = fromCase?.caseId ?? linkedCase?.id;
  const { escalationToken, adopt: adoptEscalation } = useCaseEscalation({
    caseId: escalationCaseId, role, token,
  });

  // Cached transaction resource (stale-while-revalidate). Key is scoped by role and by whether
  // an escalation token is active, so obtaining a token transparently refetches the sensitive
  // view, and revisiting via the breadcrumb renders instantly from cache.
  const txnKey = authReady ? `txn:${txnId}:${role}:${escalationToken ? 'e' : 'n'}` : null;
  const { data: txn, loading: resLoading, error } = useResource<TxnDetail>(
    txnKey, () => api.transactions.getById(txnId, token, escalationToken ?? undefined),
  );
  const loading = !authReady || resLoading;
  const notFound = !!error;

  // Resolve the parties (customer + merchant) once the transaction is loaded. The customer
  // endpoint redacts by role/escalation; re-fetch when an escalation token is obtained so an
  // L2 sees the sensitive KYC fields in place. Merchant data carries no PII.
  useEffect(() => {
    if (!txn || !token) return;
    let cancelled = false;
    setCustResolveDone(false);
    (async () => {
      const accountRef = txn.cardTransactionAccountReference;
      // Primary path: the account reference is a canonical ACC-xxx that resolves the customer.
      let cust = accountRef
        ? await api.customer.getByAccountRef(accountRef, token, escalationToken ?? undefined).catch(() => null)
        : null;
      let resolved: { cardInstanceRef?: string; agreementUuid?: string; fundingAccountRef?: string } | null = null;
      // The transaction always carries the surrogate token; resolve it to the card / owner /
      // funding-account UUIDs so the investigator can pivot, and use it as the customer fallback
      // when the account reference is not resolvable (card-not-present merchant checkout).
      if (txn.paymentCardReference) {
        const card = await api.customer.getCardByToken(txn.paymentCardReference, token).catch(() => null);
        if (card?.paymentCardInstanceReference) {
          resolved = {
            cardInstanceRef: card.paymentCardInstanceReference,
            agreementUuid: card.customerAgreementInstanceReference,
            fundingAccountRef: card.fundingPayoutAccountInstanceReference ?? undefined,
          };
          if (!cust?.customerAgreementInstanceReference && card.customerAgreementInstanceReference) {
            cust = await api.customer.getById(card.customerAgreementInstanceReference, token, escalationToken ?? undefined).catch(() => null);
          }
        }
      }
      if (cancelled) return;
      setPartyCustomer(cust);
      setCardResolved(resolved);
      setCustResolveDone(true);
    })();
    const mid = txn.merchantAgreementInstanceReference;
    if (mid) {
      api.merchants.getById(mid, token).then((m) => { if (!cancelled) setPartyMerchant(m); }).catch(() => { if (!cancelled) setPartyMerchant(null); });
    }
    return () => { cancelled = true; };
  }, [txn, token, escalationToken]);

  // Payer's funding (source) bank account, once the card resolves it and we know the party.
  useEffect(() => {
    const partyRef = partyCustomer?.partyInstanceReference as string | undefined;
    const acctRef = cardResolved?.fundingAccountRef;
    setIbanShown(false); setIbanValue(null);
    if (!token || !partyRef || !acctRef) { setFundingAccount(null); return; }
    api.accounts.get(partyRef, acctRef, token).then(setFundingAccount).catch(() => setFundingAccount(null));
  }, [token, partyCustomer, cardResolved]);

  async function toggleIban() {
    if (ibanShown) { setIbanShown(false); return; }
    if (ibanValue !== null) { setIbanShown(true); return; }
    const partyRef = partyCustomer?.partyInstanceReference as string | undefined;
    const acctRef = cardResolved?.fundingAccountRef;
    if (!partyRef || !acctRef) return;
    setIbanLoading(true);
    try {
      const r = await api.accounts.revealIban(partyRef, acctRef, token);
      setIbanValue(r.payoutAccountIban);
      setIbanShown(true);
    } catch { /* reveal not permitted / unavailable */ } finally {
      setIbanLoading(false);
    }
  }

  async function approveAndReveal() {
    // Approve the escalation on the linked case to obtain a sensitive-access token. Setting the
    // token flips the resource key, so the cached transaction transparently refetches with the
    // sensitive (QE:none) fields decrypted; no manual re-fetch needed.
    if (!linkedCase) return;
    setApproving(true);
    try {
      const res = await api.fraud.escalateApprove(linkedCase.id, {}, token);
      adoptEscalation(linkedCase.id, res.escalationToken); // persist for reload/navigation
    } catch {
      // No linked case or escalation not possible
    } finally {
      setApproving(false);
    }
  }

  const { debugMode } = useDebugMode();
  const isL2 = role === 'level2_investigator';
  const isAuditor = role === 'security_auditor';
  const canSeeSensitive = txn?.sensitive != null;

  // Shared-card lookup (FDS/AML): resolve how many customers hold this card on file (registry).
  useEffect(() => {
    const cardToken = txn?.paymentCardReference;
    if (!token || !cardToken) return;
    api.fraud.cardRegistry(cardToken, token)
      .then((r) => setCardHolders(r.cardHolderCount))
      .catch(() => setCardHolders(null));
  }, [token, txn?.paymentCardReference]);

  // ADR-030: gate the whole detail view on transactions:view (manager/merchant_officer → AccessDenied).
  if (permLoading) return <div className="w-full px-5 sm:px-8 lg:px-12 py-6 text-gray-400">Checking access…</div>;
  if (!canViewTxn) return <AccessDenied resource="transactions" action="view" />;

  if (loading) return <div className="w-full px-5 sm:px-8 lg:px-12 py-6 text-gray-400">Loading transaction...</div>;
  if (notFound || !txn) return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 text-gray-500 space-y-3">
      <p>Transaction not found.</p>
      <Link href="/system/transactions" className="inline-flex items-center gap-1.5 text-blue-600 hover:underline text-sm">
        <ArrowLeft size={14} /> Back to transactions
      </Link>
    </div>
  );

  // v36 (ADR-063): the reference may resolve to a NON-card movement (transfer / RTP). It carries the
  // movement-row shape, so it gets its own compact detail: the card-centric panels below (PAN, issuer,
  // card-on-file, KYB) have no meaning for it.
  const movement = txn as unknown as {
    kind?: 'card' | 'transfer' | 'rtp';
    paymentExecutionInstanceReference?: string;
    direction?: string; grossAmount?: number; netAmount?: number; feeAmount?: number; currency?: string;
    paymentExecutionRail?: string | null; paymentExecutionStatus?: string; concept?: string | null;
    beneficiaryName?: string | null; destinationAccountMasked?: string | null;
    linkedPaymentExecutionReference?: string | null;
    initiatedAt?: string | null; completedAt?: string | null; heldForReview?: boolean;
    fraudCase?: { created: boolean; status?: string | null; reference?: string | null };
  };
  if (movement.kind && movement.kind !== 'card') {
    const KIND_LABEL: Record<string, string> = { transfer: 'Transfer', rtp: 'Request to Pay' };
    const amount = movement.grossAmount != null && movement.currency
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: movement.currency }).format(movement.grossAmount)
      : '-';
    const at = movement.completedAt ?? movement.initiatedAt;
    return (
      <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
        <Breadcrumb items={fromCase
          ? [
              { label: 'Home', href: '/system' },
              { label: 'Cases', href: '/system/investigation' },
              { label: fromCase.caseRef ?? 'Case', href: `/system/investigation/${fromCase.caseId}` },
              { label: 'Movement' },
            ]
          : [
              { label: 'Home', href: '/system' },
              { label: 'Transactions', href: '/system/transactions' },
              { label: 'Movement' },
            ]}
        />

        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{amount}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{at ? new Date(at).toLocaleString() : '-'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#001E2B] text-[#00ED64] font-medium">
                {KIND_LABEL[movement.kind] ?? movement.kind}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 capitalize">
                {movement.paymentExecutionStatus ?? '-'}
              </span>
              {movement.heldForReview && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
                  Funds held, not delivered
                </span>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-500">Reference</dt>
            <dd className="font-mono text-xs break-all">{movement.paymentExecutionInstanceReference ?? txnId}</dd>
            <dt className="text-gray-500">Direction</dt>
            <dd className="capitalize">{movement.direction ?? '-'}</dd>
            <dt className="text-gray-500">Rail</dt>
            <dd className="uppercase text-xs">{movement.paymentExecutionRail ?? 'n/a'}</dd>
            <dt className="text-gray-500">Destination</dt>
            <dd className="truncate">{movement.beneficiaryName ?? movement.destinationAccountMasked ?? 'n/a'}</dd>
            <dt className="text-gray-500">Reference note</dt>
            <dd className="truncate">{movement.concept ?? 'n/a'}</dd>
            {movement.netAmount != null && (
              <>
                <dt className="text-gray-500">Net / fee</dt>
                <dd className="font-mono text-xs">{movement.netAmount} / {movement.feeAmount ?? 0} {movement.currency}</dd>
              </>
            )}
            {movement.linkedPaymentExecutionReference && (
              <>
                <dt className="text-gray-500">Settled by</dt>
                <dd>
                  <Link href={`/system/transactions/${movement.linkedPaymentExecutionReference}`}
                    className="font-mono text-xs text-blue-600 hover:underline break-all">
                    {movement.linkedPaymentExecutionReference}
                  </Link>
                </dd>
              </>
            )}
          </dl>
        </div>

        {movement.fraudCase?.created && (
          <div className="bg-white rounded-xl border p-5 text-sm">
            <p className="font-semibold text-gray-800 mb-1">Under investigation</p>
            <p className="text-gray-600">
              Case {movement.fraudCase.reference ?? ''} · <span className="capitalize">{(movement.fraudCase.status ?? '').replace(/_/g, ' ')}</span>
            </p>
          </div>
        )}

        <Link href={fromCase ? `/system/investigation/${fromCase.caseId}` : '/system/transactions'}
          className="inline-block text-blue-600 hover:underline text-sm">
          <ArrowLeft size={14} /> Back
        </Link>
      </div>
    );
  }

  const formattedAmount = txn.cardTransactionAmount
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.cardTransactionAmount.currency }).format(txn.cardTransactionAmount.amount)
    : '-';

  const crumbs: Crumb[] = fromCase
    ? [
        { label: 'Home', href: '/system' },
        { label: 'Cases', href: '/system/investigation' },
        { label: fromCase.caseRef ?? 'Case', href: `/system/investigation/${fromCase.caseId}` },
        { label: 'Transaction' },
      ]
    : [
        { label: 'Home', href: '/system' },
        { label: 'Transactions', href: '/system/transactions' },
        { label: txn.cardTransactionMerchantName ?? 'Transaction' },
      ];

  const acctRef = txn.cardTransactionAccountReference;
  const custSensitive = partyCustomer?.sensitive as { customerAgreementResidentialAddress?: { streetAddress?: string; city?: string; postalCode?: string; countryCode?: string }; customerAgreementRiskNotes?: string } | undefined;
  // v32 B4: the identity document is lookup tier on the base record (searchable), not a QE:none leaf.
  const custGovIdRaw = partyCustomer?.customerAgreementGovernmentID as { number?: unknown } | undefined;
  const custGovIdNumber = custGovIdRaw?.number != null ? String(custGovIdRaw.number) : '';

  // The account reference mirrors the card token on card-not-present merchant checkouts that
  // had no customer account reference; flag it so the auditor is not misled.
  const acctRefIsToken = !!acctRef && acctRef === txn.paymentCardReference;
  const partyRef = partyCustomer?.partyInstanceReference as string | undefined;
  const agreementUuid = (partyCustomer?.customerAgreementInstanceReference as string | undefined) ?? cardResolved?.agreementUuid;
  // Staff-mode deep links (read-only) into the card and funding-account detail pages.
  const cardHref = cardResolved?.cardInstanceRef && agreementUuid && partyRef
    ? `/system/cards/${cardResolved.cardInstanceRef}?ctx=staff&customerId=${encodeURIComponent(agreementUuid)}&partyRef=${encodeURIComponent(partyRef)}`
    : null;
  const accountHref = cardResolved?.fundingAccountRef && partyRef
    ? `/system/accounts/${cardResolved.fundingAccountRef}?ctx=staff&partyRef=${encodeURIComponent(partyRef)}`
    : null;
  const currency = txn.cardTransactionAmount?.currency;
  const feeAmount = (txn as { feeAmount?: number }).feeAmount;
  const acceptanceMethod = (txn as { cardTransactionAcceptanceMethod?: string }).cardTransactionAcceptanceMethod;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={crumbs} />

      {/* Header */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{txn.cardTransactionMerchantName}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {txn.cardTransactionDateTime ? new Date(txn.cardTransactionDateTime).toLocaleString() : '-'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-gray-900">
              {formattedAmount}
              {currency && <span className="text-sm font-medium text-gray-400 ml-1.5">{currency}</span>}
            </p>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[txn.cardTransactionStatus ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
              {txn.cardTransactionStatus}
            </span>
            {/* Oversight roles jump straight to every event that references this transaction. */}
            <div className="mt-2 flex justify-end">
              <AuditTrailLink reference={txn.cardTransactionInstanceReference ?? txnId} label="View audit trail" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm border-t pt-4">
          <InfoLabel label="Transaction ID" tip="CardTransactionLog instance reference. The immutable primary key for this transaction record." />
          <span className="font-mono text-xs break-all">{txn.cardTransactionInstanceReference ?? txnId}</span>
          <InfoLabel label="Amount" tip="Authorized amount and settlement currency (ISO 4217). This card transaction is single-currency; no FX conversion applies." />
          <span className="font-medium">{formattedAmount}{currency ? <span className="text-gray-400 font-normal ml-1">({currency})</span> : null}</span>
          {txn.cardTransactionType && (
            <>
              <InfoLabel label="Type" tip="transaction type: purchase, cash advance, balance transfer, refund, fee or adjustment." />
              <span className="capitalize">{txn.cardTransactionType.replace(/_/g, ' ')}</span>
            </>
          )}
          {feeAmount != null && (
            <>
              <InfoLabel label="Merchant commission" tip="acquiring commission captured on this payment (fee attributed to the merchant), in the settlement currency." />
              <span className="font-mono text-xs">{currency ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(feeAmount) : feeAmount}</span>
            </>
          )}
          {txn.cardTransactionChannel && (
            <>
              <InfoLabel label="Channel" tip="How the card was presented: online (e-commerce), point of sale, contactless (NFC), or ATM. Drives risk scoring." />
              <span>{CHANNEL_LABELS[txn.cardTransactionChannel] ?? txn.cardTransactionChannel}</span>
            </>
          )}
          {txn.cardTransactionInitiationType && (
            <>
              <InfoLabel label="Initiation" tip="Who initiated the payment: customer-initiated (CIT) or merchant-initiated (MIT, e.g. recurring). Relevant to SCA/PSD2." />
              <span>{INIT_LABELS[txn.cardTransactionInitiationType] ?? txn.cardTransactionInitiationType}</span>
            </>
          )}
          {acceptanceMethod && (
            <>
              <InfoLabel label="Acceptance method" tip="How the payment was accepted: API, payment link, redirect checkout, POS or e-commerce." />
              <span className="capitalize">{acceptanceMethod.replace(/_/g, ' ')}</span>
            </>
          )}
          {txn.cardTransactionMerchantCategoryCode && (
            <>
              <InfoLabel label="Merchant category" tip="ISO 18245 Merchant Category Code (MCC): a 4-digit code identifying the merchant's business type." />
              <span className="font-mono text-xs">MCC {txn.cardTransactionMerchantCategoryCode}</span>
            </>
          )}
        </div>
      </div>

      {/* Cardholder Data - all fields that identify the cardholder */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm text-gray-700">Cardholder Data</h2>
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
            {role === 'level1_analyst' ? 'L1 Access' : role === 'level2_investigator' ? 'L2 Access' : 'Auditor Access'}
          </span>
        </div>

        <div className="space-y-3">
          {/* Visible cardholder identifiers */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
            {txn.cardTransactionMaskedPanDisplay && (
              <>
                <InfoLabel label="Card number" tip="PCI DSS-permitted last-4 display (masked PAN). The full PAN is never stored or shown." />
                <span className="font-mono">{txn.cardTransactionMaskedPanDisplay}</span>
              </>
            )}
            {txn.paymentCardReference && (
              <>
                <InfoLabel label="Card token" tip="Surrogate token for the card (not CHD under PCI DSS v4.0). Deterministic per PAN, so it correlates every transaction made with the same card. Open the card to review its details." />
                {cardHref ? (
                  <Link href={cardHref} className="font-mono text-xs text-[#001E2B] truncate hover:underline inline-flex items-center gap-1 min-w-0">
                    <CreditCard size={12} className="shrink-0" />
                    <span className="truncate">{txn.paymentCardReference}</span>
                  </Link>
                ) : (
                  <span className="font-mono text-xs text-gray-600 truncate">{txn.paymentCardReference}</span>
                )}
              </>
            )}
            {cardHolders !== null && cardHolders > 0 && (
              <>
                <InfoLabel label="Card held by" tip="How many distinct customers hold this card on file (shared-card registry). A high count is a shared-card / money-mule (AML) indicator." />
                <span className={`inline-flex items-center gap-1 ${cardHolders > 3 ? 'text-amber-700 font-semibold' : 'text-gray-700'}`}>
                  {cardHolders} customer{cardHolders !== 1 ? 's' : ''}
                  {cardHolders > 3 && <><AlertTriangle size={13} className="shrink-0" /> shared-card / mule risk</>}
                </span>
              </>
            )}
          </div>

          {/* Account Reference - QE:equality encrypted. Omitted when it merely mirrors the card
              token (card-not-present merchant checkout with no customer account reference), since
              showing the same value twice adds no information; a short note explains why instead. */}
          {acctRefIsToken ? (
            <p className="text-xs text-gray-500 flex items-start gap-1">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber-600" />
              No customer account reference: this was a card-not-present merchant checkout, so the
              card token above is used as the transaction correlation key.
            </p>
          ) : (
            <div className="bg-blue-50 rounded-lg p-3">
              {debugMode && (
                <p className="text-xs font-semibold text-blue-700 uppercase mb-2">QE:equality  -  searchable while encrypted</p>
              )}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm items-center">
                {txn.cardTransactionAccountReference ? (
                  <RevealField
                    label="Account Reference"
                    value={txn.cardTransactionAccountReference}
                    type="qe-equality"
                  />
                ) : (
                  <>
                    <EncryptionBadge label="Account Reference" type="qe-equality" />
                    <span className="text-gray-400 text-xs italic">Not available at this access level</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* QE:none - debug only: explains system architecture (DEK-sensitive, L2 escalation) */}
          {debugMode && (
            <div className={`rounded-lg p-3 ${canSeeSensitive ? 'bg-purple-50' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-xs font-semibold uppercase ${canSeeSensitive ? 'text-purple-700' : 'text-gray-500'}`}>
                  QE:none  -  sensitive (DEK-sensitive)
                </p>
                {!canSeeSensitive && isL2 && !escalationToken && (
                  <button
                    onClick={approveAndReveal}
                    disabled={approving}
                    className="text-xs px-2 py-1 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {approving ? 'Approving...' : 'Approve escalation'}
                  </button>
                )}
              </div>

              {/* v32 C4: these are QE:none payloads for another party. They were JSON.stringify'd in
                  the clear once escalation was approved; now each one is hidden behind the shared
                  reveal affordance, so a screen share does not expose them by default and the
                  disclosure is an explicit act (ADR-052). */}
              {canSeeSensitive && txn.sensitive ? (
                <div className="divide-y divide-gray-100">
                  {txn.sensitive.rawGatewayPayload ? (
                    <SensitiveReveal
                      label="Raw Gateway Payload"
                      masked="•••• (masked)"
                      info="Full acquirer/gateway payload for this authorization. QE:none: encrypted at rest and not searchable."
                      fetchValue={async () => JSON.stringify(txn.sensitive?.rawGatewayPayload, null, 2)}
                    />
                  ) : null}
                  {txn.sensitive.processorTransactionMetadata ? (
                    <SensitiveReveal
                      label="Processor Metadata"
                      masked="•••• (masked)"
                      info="Processor-side metadata for this transaction. QE:none: encrypted at rest and not searchable."
                      fetchValue={async () => JSON.stringify(txn.sensitive?.processorTransactionMetadata, null, 2)}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm items-center">
                  {['Raw Gateway Payload', 'Processor Metadata'].map(f => (
                    <Fragment key={f}>
                      <EncryptionBadge label={f} type="qe-none" />
                      <span className="text-gray-400 text-xs italic">
                        {isL2 && !escalationToken ? 'Click "Approve escalation" above' : 'Requires Level 2 escalation approval'}
                      </span>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Parties; payer (source) = customer + funding account + card, payee (destination) = merchant.
          Role-gated by the backend, to continue the investigation. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Payer (source): Customer (KYC) + funding bank account */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3">
            <UserCheck size={15} className="text-[#001E2B]" />
            <h2 className="font-semibold text-sm">Customer (KYC)</h2>
            <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Payer (source)</span>
            <Tooltip text="The paying party (source of funds): the cardholder, their KYC record and the bank account funding the card." />
            {agreementUuid && partyCustomer && (
              <Link href={`/system/users/${encodeURIComponent(agreementUuid)}?from=transaction&txnId=${txnId}`}
                className="ml-auto inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                Open customer <ChevronRight size={12} />
              </Link>
            )}
          </div>
          {!custResolveDone ? (
            <p className="text-xs text-gray-400">Loading customer…</p>
          ) : !partyCustomer ? (
            <p className="text-xs text-gray-500">External card: no PSP customer on file (card-not-present at a merchant).</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <InfoLabel label="Name" tip="Registered account holder. PII, minimized to the name here." /><span className="font-medium truncate">{String(partyCustomer.customerName ?? '-')}</span>
                <InfoLabel label="Segment" tip="Customer segment (e.g. retail, SME, corporate), used for risk and servicing." /><span className="capitalize">{String(partyCustomer.customerSegment ?? '-')}</span>
                <InfoLabel label="Status" tip="Lifecycle status of the customer agreement (active, suspended, closed)." /><span className="capitalize">{String(partyCustomer.customerAgreementStatus ?? '-')}</span>
                <InfoLabel label="KYC check" tip="Know Your Customer verification outcome. Cleared / pending / failed drives onboarding and monitoring." /><span className="capitalize">{String((partyCustomer.customerAgreementKycCheck as { customerAgreementKycCheckStatus?: string } | null)?.customerAgreementKycCheckStatus ?? 'n/a')}</span>
              </div>
              {custSensitive ? (
                <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    {custSensitive.customerAgreementResidentialAddress && (
                      <>
                        <InfoLabel label="Address" tip="Residential address (GDPR-protected PII). Visible to auditor / after L2 escalation." />
                        <span className="font-mono text-xs break-words">{[custSensitive.customerAgreementResidentialAddress.streetAddress, custSensitive.customerAgreementResidentialAddress.city, custSensitive.customerAgreementResidentialAddress.postalCode, custSensitive.customerAgreementResidentialAddress.countryCode].filter(Boolean).join(', ')}</span>
                      </>
                    )}
                    {custGovIdNumber && (
                      <>
                        <InfoLabel label="Gov ID" tip="Government identification reference (GDPR-protected). Used for identity verification." />
                        <span className="font-mono text-xs">{custGovIdNumber}</span>
                      </>
                    )}
                    {custSensitive.customerAgreementRiskNotes && (
                      <>
                        <InfoLabel label="Risk notes" tip="Analyst risk annotations on this customer (investigation context)." />
                        <span>{custSensitive.customerAgreementRiskNotes}</span>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-gray-400 italic">Sensitive KYC PII requires {isAuditor ? 'auditor access' : 'L2 escalation'}.</p>
              )}

              {/* Funding (source) bank account: GDPR/PSD2, masked IBAN revealed on demand. */}
              {cardResolved?.fundingAccountRef && (
                <div className="mt-3 border-t pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Landmark size={13} className="text-[#001E2B]" />
                    <span className="text-xs font-semibold text-gray-700">Funding account</span>
                    <Tooltip text="The bank account that funds this card. IBAN is GDPR/PSD2-protected (not PCI DSS scope) and revealed on demand." />
                    {accountHref && (
                      <Link href={accountHref} className="ml-auto inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                        Open account <ChevronRight size={12} />
                      </Link>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm items-center">
                    {fundingAccount?.payoutAccountAlias != null && (
                      <>
                        <InfoLabel label="Account" tip="Customer-defined nickname for the funding account." />
                        <span className="truncate">{String(fundingAccount.payoutAccountAlias)}</span>
                      </>
                    )}
                    {(fundingAccount?.payoutAccountHasIban as boolean | undefined) && (
                      <>
                        <span className="text-gray-500 flex items-center gap-1"><Lock size={11} className="text-gray-400" /> IBAN</span>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-xs tracking-wider ${ibanShown && ibanValue ? 'text-gray-900' : 'text-gray-400 select-none'}`}>
                            {ibanShown && ibanValue ? ibanValue.replace(/(.{4})/g, '$1 ').trim() : '•••• •••• •••• ••••'}
                          </span>
                          <button onClick={toggleIban} disabled={ibanLoading} title={ibanShown ? 'Hide IBAN' : 'Reveal IBAN (GDPR/PSD2, need-to-know)'}
                            className="text-gray-400 hover:text-[#001E2B] transition-colors shrink-0 disabled:opacity-50">
                            {ibanLoading ? <span className="text-xs">…</span> : ibanShown ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Payee (destination): Merchant (KYB) or external card-network descriptor */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3">
            <Store size={15} className="text-[#001E2B]" />
            <h2 className="font-semibold text-sm">Merchant (KYB)</h2>
            <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Payee (destination)</span>
            <Tooltip text="The receiving party (destination of funds): the merchant the payment was made to, with its Know Your Business record when acquired by this PSP." />
            {txn.merchantAgreementInstanceReference && (
              <Link href={`/system/merchant/${txn.merchantAgreementInstanceReference}?from=transaction&txnId=${txnId}`}
                className="ml-auto inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                Open merchant <ChevronRight size={12} />
              </Link>
            )}
          </div>
          {!txn.merchantAgreementInstanceReference ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <span className="text-gray-500">Descriptor</span><span className="font-medium truncate">{txn.cardTransactionMerchantName}</span>
                <span className="text-gray-500">MCC</span><span className="font-mono text-xs">{txn.cardTransactionMerchantCategoryCode ?? '-'}</span>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                External merchant: not acquired by this PSP, so there is no KYB record. Only the card-network descriptor (name + MCC) is available. Expected for issuer-side transactions.
              </div>
            </div>
          ) : !partyMerchant ? (
            <p className="text-xs text-gray-400">Loading merchant…</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-gray-500">Name</span><span className="font-medium truncate">{String(partyMerchant.merchantName ?? txn.cardTransactionMerchantName)}</span>
              <span className="text-gray-500">Status</span><span className="capitalize">{String(partyMerchant.merchantAgreementStatus ?? '-')}</span>
              <span className="text-gray-500">KYB check</span><span className="capitalize">{String((partyMerchant.merchantAgreementKybCheck as { merchantAgreementKybCheckStatus?: string } | null)?.merchantAgreementKybCheckStatus ?? 'n/a')}</span>
              <span className="text-gray-500">Risk</span><span className="capitalize">{String(partyMerchant.merchantRiskCategory ?? '-')}{partyMerchant.merchantTier ? ` · ${String(partyMerchant.merchantTier)}` : ''}</span>
              <span className="text-gray-500">Country / MCC</span><span className="font-mono text-xs">{String(partyMerchant.merchantCountryCode ?? '-')} / {String(partyMerchant.merchantCategoryCode ?? '-')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Investigation case  -  linked or open new */}
      <div className="bg-white rounded-xl border p-4">
        {linkedCase ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Investigation case</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-mono text-gray-600">{linkedCase.ref}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  linkedCase.status === 'escalated' ? 'bg-orange-100 text-orange-800' :
                  linkedCase.status.startsWith('resolved') ? 'bg-green-100 text-green-800' :
                  'bg-blue-100 text-blue-800'
                }`}>{linkedCase.status.replace(/_/g, ' ')}</span>
              </div>
            </div>
            <Link
              href={`/system/investigation/${linkedCase.id}`}
              className="text-sm px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors font-semibold"
            >
              Open case
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">No investigation case</p>
              <p className="text-xs text-gray-500 mt-0.5">This transaction has not triggered a fraud case.</p>
            </div>
            {(role === 'level1_analyst' || role === 'level2_investigator') && (
              <div className="text-right space-y-1">
                <button
                  disabled={openingCase}
                  onClick={async () => {
                    setOpeningCase(true);
                    setOpenCaseError(null);
                    try {
                      const res = await api.fraud.open({ transactionId: txnId, reason: 'Manual investigation opened by analyst' }, token);
                      // Fetch the newly created case to get its reference
                      const caseData = await api.fraud.getById(res.fraudDiagnosisInstanceReference, token);
                      setLinkedCase({
                        id: res.fraudDiagnosisInstanceReference,
                        ref: caseData.fraudDiagnosisCaseReference,
                        status: caseData.caseStatus,
                      });
                    } catch (e) {
                      setOpenCaseError(e instanceof Error ? e.message : 'Failed to open case');
                    } finally {
                      setOpeningCase(false);
                    }
                  }}
                  className="text-sm px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors font-semibold disabled:opacity-50"
                >
                  {openingCase ? 'Opening...' : 'Open investigation case'}
                </button>
                {openCaseError && <p className="text-xs text-red-600">{openCaseError}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* PCI DSS note for Auditor; debug/educational annotation only */}
      {isAuditor && debugMode && (
        <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm text-gray-600">
          <strong className="text-[#001E2B]">Security Auditor (read-only):</strong> All fields visible for audit review.
          Sensitive fields (QE:none) are accessible without escalation token per the role access model.
          No modifications permitted.
        </div>
      )}

      {/* Debug: raw MongoDB documents for all roles */}
      {debugMode && (
        <RawMongoPanel
          token={token}
          sections={[
            {
              kind: 'mongo' as const,
              collection: 'cardTransactionLog',
              id: txnId,
              label: 'cardTransactionLog',
              labelColor: 'text-amber-400',
              description: 'QE:equality (accountRef) + QE:none (raw gateway payload, processor metadata)',
            },
            ...(txn.paymentCardReference ? [{
              kind: 'mongo' as const,
              collection: 'paymentCardManagement',
              id: txn.paymentCardReference,
              label: 'paymentCardManagement',
              labelColor: 'text-blue-400',
              description: 'card token (QE:equality), PAN mask, network, expiry',
            }] : []),
            ...(linkedCase ? [{
              kind: 'mongo' as const,
              collection: 'fraudDiagnosisCase',
              id: linkedCase.id,
              label: 'fraudDiagnosisCase',
              labelColor: 'text-red-400',
              description: 'investigation case, risk indicators, resolution record',
            }] : []),
          ]}
        />
      )}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { useDebugMode } from '../../../../lib/debugMode';
import { RawMongoPanel } from '../../../../components/RawMongoPanel';
import { Breadcrumb, type Crumb } from '../../../../components/Breadcrumb';
import { useResource } from '../../../../lib/useResource';
import { useEffectivePermissions } from '../../../../lib/permissions';
import { AccessDenied } from '../../../../components/AccessDenied';
import { storeEscalationToken, readEscalationToken } from '../../../../lib/escalation';
import { Eye, EyeOff, UserCheck, Store, ChevronRight } from 'lucide-react';

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

function RevealField({ label, value, type }: { label: string; value: string; type: 'qe-equality' | 'qe-none' }) {
  const [shown, setShown] = useState(false);
  const masked = type === 'qe-equality'
    ? value.slice(0, 3) + '●●●●●●●●' + value.slice(-3)
    : '●●●●●●●●●●●●';
  return (
    <div className="flex items-center gap-2">
      <EncryptionBadge label={label} type={type} />
      <span className={`text-xs font-mono transition-colors ${shown ? 'text-gray-900' : 'text-gray-400 select-none'}`}>
        {shown ? value : masked}
      </span>
      <button onClick={() => setShown(v => !v)} className="text-gray-400 hover:text-[#001E2B] transition-colors" title={shown ? 'Hide' : 'Reveal'}>
        {shown ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );
}

export default function TransactionDetailPage() {
  const { txnId } = useParams<{ txnId: string }>();
  const router = useRouter();

  const [token, setToken] = useState('');
  const [role, setRole] = useState('level1_analyst');
  const [authReady, setAuthReady] = useState(false);
  const [linkedCase, setLinkedCase] = useState<{ id: string; ref: string; status: string } | null>(null);
  const [escalationToken, setEscalationToken] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [openingCase, setOpeningCase] = useState(false);
  const [openCaseError, setOpenCaseError] = useState<string | null>(null);
  // FDS/AML: how many customers hold the card used in this transaction (shared-card signal).
  const [cardHolders, setCardHolders] = useState<number | null>(null);

  // Parties involved (role-gated by the backend): customer (KYC) + merchant (KYB).
  const [partyCustomer, setPartyCustomer] = useState<Record<string, unknown> | null>(null);
  const [partyMerchant, setPartyMerchant] = useState<Record<string, unknown> | null>(null);
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
    // If we came from a case the L2 has escalated, reuse that case's token so sensitive
    // fields and parties resolve here too (backend re-validates; expired → no PII).
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const cid = sp.get('caseId');
      if (sp.get('from') === 'investigation' && cid) {
        setFromCase({ caseId: cid, caseRef: sp.get('caseRef') ?? undefined });
        const persisted = readEscalationToken(cid);
        if (persisted) setEscalationToken(persisted);
      }
    }
  }, [txnId, router]);

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
    const accountRef = txn.cardTransactionAccountReference;
    if (accountRef) {
      api.customer.getByAccountRef(accountRef, token, escalationToken ?? undefined)
        .then(setPartyCustomer).catch(() => setPartyCustomer(null));
    }
    const mid = txn.merchantAgreementInstanceReference;
    if (mid) {
      api.merchants.getById(mid, token).then(setPartyMerchant).catch(() => setPartyMerchant(null));
    }
  }, [txn, token, escalationToken]);

  async function approveAndReveal() {
    // Approve the escalation on the linked case to obtain a sensitive-access token. Setting the
    // token flips the resource key, so the cached transaction transparently refetches with the
    // sensitive (QE:none) fields decrypted — no manual re-fetch needed.
    if (!linkedCase) return;
    setApproving(true);
    try {
      const res = await api.fraud.escalateApprove(linkedCase.id, {}, token);
      setEscalationToken(res.escalationToken);
      storeEscalationToken(linkedCase.id, res.escalationToken); // persist for reload/navigation
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
      <Link href="/system/transactions" className="text-blue-600 hover:underline text-sm">← Back to transactions</Link>
    </div>
  );

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
  const custSensitive = partyCustomer?.sensitive as { customerAgreementResidentialAddress?: { streetAddress?: string; city?: string; postalCode?: string; countryCode?: string }; governmentIdentificationReference?: string; customerAgreementRiskNotes?: string } | undefined;

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
            <p className="text-2xl font-bold text-gray-900">{formattedAmount}</p>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[txn.cardTransactionStatus ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
              {txn.cardTransactionStatus}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm border-t pt-4">
          {txn.cardTransactionChannel && (
            <>
              <span className="text-gray-500">Channel</span>
              <span>{CHANNEL_LABELS[txn.cardTransactionChannel] ?? txn.cardTransactionChannel}</span>
            </>
          )}
          {txn.cardTransactionInitiationType && (
            <>
              <span className="text-gray-500">Initiation</span>
              <span>{INIT_LABELS[txn.cardTransactionInitiationType] ?? txn.cardTransactionInitiationType}</span>
            </>
          )}
          {txn.cardTransactionMerchantCategoryCode && (
            <>
              <span className="text-gray-500">Merchant category</span>
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
                <span className="text-gray-500">Card number</span>
                <span className="font-mono">{txn.cardTransactionMaskedPanDisplay}</span>
              </>
            )}
            {txn.paymentCardReference && (
              <>
                <span className="text-gray-500">Card token</span>
                <span className="font-mono text-xs text-gray-600 truncate">{txn.paymentCardReference}</span>
              </>
            )}
            {cardHolders !== null && cardHolders > 0 && (
              <>
                <span className="text-gray-500">Card held by</span>
                <span className={cardHolders > 3 ? 'text-amber-700 font-semibold' : 'text-gray-700'}>
                  {cardHolders} customer{cardHolders !== 1 ? 's' : ''}
                  {cardHolders > 3 && ' ⚠ shared-card / mule risk'}
                </span>
              </>
            )}
          </div>

          {/* Account Reference - QE:equality encrypted */}
          <div className="bg-blue-50 rounded-lg p-3">
            {debugMode && (
              <p className="text-xs font-semibold text-blue-700 uppercase mb-2">QE:equality  -  searchable while encrypted</p>
            )}
            {txn.cardTransactionAccountReference ? (
              <RevealField
                label="Account Reference"
                value={txn.cardTransactionAccountReference}
                type="qe-equality"
              />
            ) : (
              <div className="flex items-center gap-2">
                <EncryptionBadge label="Account Reference" type="qe-equality" />
                <span className="text-gray-400 text-xs italic">Not available at this access level</span>
              </div>
            )}
          </div>

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

              {canSeeSensitive && txn.sensitive ? (
                <div className="space-y-2">
                  {txn.sensitive.rawGatewayPayload && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1">Raw Gateway Payload</p>
                      <pre className="text-xs bg-white rounded border p-2 overflow-x-auto font-mono text-gray-700">
                        {JSON.stringify(txn.sensitive.rawGatewayPayload, null, 2)}
                      </pre>
                    </div>
                  )}
                  {txn.sensitive.processorTransactionMetadata && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1">Processor Metadata</p>
                      <pre className="text-xs bg-white rounded border p-2 overflow-x-auto font-mono text-gray-700">
                        {JSON.stringify(txn.sensitive.processorTransactionMetadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {['Raw Gateway Payload', 'Processor Metadata'].map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <EncryptionBadge label={f} type="qe-none" />
                      <span className="text-gray-400 text-xs italic">
                        {isL2 && !escalationToken ? 'Click "Approve escalation" above' : 'Requires Level 2 escalation approval'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Parties — customer (KYC) + merchant (KYB), role-gated, to continue the investigation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Customer (KYC) */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3">
            <UserCheck size={15} className="text-[#001E2B]" />
            <h2 className="font-semibold text-sm">Customer (KYC)</h2>
            {partyCustomer?.customerAgreementInstanceReference != null && (
              <Link href={`/system/users/${String(partyCustomer.customerAgreementInstanceReference)}?from=transaction&txnId=${txnId}`}
                className="ml-auto inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                Open customer <ChevronRight size={12} />
              </Link>
            )}
          </div>
          {!partyCustomer ? (
            <p className="text-xs text-gray-400">{acctRef ? 'Loading customer…' : 'No account reference on this transaction.'}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <span className="text-gray-500">Name</span><span className="font-medium truncate">{String(partyCustomer.customerName ?? '—')}</span>
                <span className="text-gray-500">Segment</span><span className="capitalize">{String(partyCustomer.customerSegment ?? '—')}</span>
                <span className="text-gray-500">Status</span><span className="capitalize">{String(partyCustomer.customerAgreementStatus ?? '—')}</span>
                <span className="text-gray-500">KYC check</span><span className="capitalize">{String((partyCustomer.customerAgreementKycCheck as { customerAgreementKycCheckStatus?: string } | null)?.customerAgreementKycCheckStatus ?? 'n/a')}</span>
              </div>
              {custSensitive ? (
                <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-3 text-xs space-y-1">
                  {custSensitive.customerAgreementResidentialAddress && (
                    <div><span className="text-gray-500">Address: </span><span className="font-mono">{[custSensitive.customerAgreementResidentialAddress.streetAddress, custSensitive.customerAgreementResidentialAddress.city, custSensitive.customerAgreementResidentialAddress.postalCode, custSensitive.customerAgreementResidentialAddress.countryCode].filter(Boolean).join(', ')}</span></div>
                  )}
                  {custSensitive.governmentIdentificationReference && <div><span className="text-gray-500">Gov ID: </span><span className="font-mono">{custSensitive.governmentIdentificationReference}</span></div>}
                  {custSensitive.customerAgreementRiskNotes && <div><span className="text-gray-500">Risk notes: </span>{custSensitive.customerAgreementRiskNotes}</div>}
                </div>
              ) : (
                <p className="mt-3 text-xs text-gray-400 italic">Sensitive KYC PII requires {isAuditor ? 'auditor access' : 'L2 escalation'}.</p>
              )}
            </>
          )}
        </div>

        {/* Merchant (KYB) */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3">
            <Store size={15} className="text-[#001E2B]" />
            <h2 className="font-semibold text-sm">Merchant (KYB)</h2>
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
                <span className="text-gray-500">MCC</span><span className="font-mono text-xs">{txn.cardTransactionMerchantCategoryCode ?? '—'}</span>
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
              <span className="text-gray-500">Status</span><span className="capitalize">{String(partyMerchant.merchantAgreementStatus ?? '—')}</span>
              <span className="text-gray-500">KYB check</span><span className="capitalize">{String((partyMerchant.merchantAgreementKybCheck as { merchantAgreementKybCheckStatus?: string } | null)?.merchantAgreementKybCheckStatus ?? 'n/a')}</span>
              <span className="text-gray-500">Risk</span><span className="capitalize">{String(partyMerchant.merchantRiskCategory ?? '—')}{partyMerchant.merchantTier ? ` · ${String(partyMerchant.merchantTier)}` : ''}</span>
              <span className="text-gray-500">Country / MCC</span><span className="font-mono text-xs">{String(partyMerchant.merchantCountryCode ?? '—')} / {String(partyMerchant.merchantCategoryCode ?? '—')}</span>
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

      {/* PCI DSS note for Auditor — debug/educational annotation only */}
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
              description: 'SD-27 - QE:equality (accountRef) + QE:none (raw gateway payload, processor metadata)',
            },
            ...(txn.paymentCardReference ? [{
              kind: 'mongo' as const,
              collection: 'paymentCardManagement',
              id: txn.paymentCardReference,
              label: 'paymentCardManagement',
              labelColor: 'text-blue-400',
              description: 'SD-170 - card token (QE:equality), PAN mask, network, expiry',
            }] : []),
            ...(linkedCase ? [{
              kind: 'mongo' as const,
              collection: 'fraudDiagnosisCase',
              id: linkedCase.id,
              label: 'fraudDiagnosisCase',
              labelColor: 'text-red-400',
              description: 'SD-92 - investigation case, risk indicators, resolution record',
            }] : []),
          ]}
        />
      )}
    </div>
  );
}

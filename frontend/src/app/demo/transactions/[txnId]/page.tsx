'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { useDebugMode } from '../../../../lib/debugMode';
import { DebugRawJson } from '../../../../components/DebugRawJson';
import { Eye, EyeOff } from 'lucide-react';

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
  const [txn, setTxn] = useState<TxnDetail | null>(null);
  const [linkedCase, setLinkedCase] = useState<{ id: string; ref: string; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [escalationToken, setEscalationToken] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [openingCase, setOpeningCase] = useState(false);
  const [openCaseError, setOpenCaseError] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken() ?? '';
    const user = t ? decodeToken(t) : null;
    if (user?.role === 'customer') { router.replace('/demo/payment/history'); return; }
    setToken(t);
    setRole(user?.role ?? 'level1_analyst');

    Promise.all([
      api.transactions.getById(txnId, t),
      api.fraud.list({ transactionId: txnId, limit: 1 }, t).catch(() => null),
    ]).then(([txnData, casesData]) => {
      setTxn(txnData);
      const c = casesData?.results?.[0];
      if (c) setLinkedCase({ id: c.fraudDiagnosisInstanceReference, ref: c.fraudDiagnosisCaseReference, status: c.caseStatus });
    }).catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [txnId, router]);

  async function approveAndReveal() {
    // Find the fraud case linked to this transaction via the investigation API,
    // then call escalate/approve to get a token for sensitive field access.
    // For demo purposes: use a simulated escalation token flow.
    setApproving(true);
    try {
      // Try to find fraud cases for this transaction
      const cases = await api.fraud.list({ limit: 50 }, token);
      const linked = cases.results.find(c => c.cardTransactionInstanceReference === txnId);
      if (linked) {
        const res = await api.fraud.escalateApprove(linked.fraudDiagnosisInstanceReference, {}, token);
        setEscalationToken(res.escalationToken);
        // Re-fetch transaction with escalation token
        const refreshed = await api.transactions.getById(txnId, token, res.escalationToken);
        setTxn(refreshed);
      }
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

  if (loading) return <div className="p-6 text-gray-400">Loading transaction...</div>;
  if (notFound || !txn) return (
    <div className="p-6 text-gray-500 space-y-3">
      <p>Transaction not found.</p>
      <Link href="/demo/transactions" className="text-blue-600 hover:underline text-sm">← Back to transactions</Link>
    </div>
  );

  const formattedAmount = txn.cardTransactionAmount
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.cardTransactionAmount.currency }).format(txn.cardTransactionAmount.amount)
    : '-';

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-5">
      <Link href="/demo/transactions" className="text-sm text-blue-600 hover:underline">← Back to transactions</Link>

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
          <span className="text-gray-500">Merchant category</span>
          <span className="font-mono text-xs">MCC {txn.cardTransactionMerchantCategoryCode ?? '-'}</span>

          <span className="text-gray-500">Card</span>
          <span className="font-mono">{txn.cardTransactionMaskedPanDisplay ?? '-'}</span>

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
          {txn.paymentCardReference && (
            <>
              <span className="text-gray-500">Card token</span>
              <span className="font-mono text-xs text-gray-600 truncate">{txn.paymentCardReference}</span>
            </>
          )}
        </div>
      </div>

      {/* QE:equality fields  -  Account Reference */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm text-gray-700">Encrypted Fields</h2>
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
            {role === 'level1_analyst' ? 'L1 Access' : role === 'level2_investigator' ? 'L2 Access' : 'Auditor Access'}
          </span>
        </div>

        <div className="space-y-3">
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-xs font-semibold text-blue-700 uppercase mb-2">QE:equality  -  searchable while encrypted</p>
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

          {/* QE:none  -  Sensitive fields */}
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
              href={`/demo/investigation/${linkedCase.id}`}
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

      {/* PCI DSS note for Auditor */}
      {isAuditor && (
        <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm text-gray-600">
          <strong className="text-[#001E2B]">Security Auditor (read-only):</strong> All fields visible for audit review.
          Sensitive fields (QE:none) are accessible without escalation token per the role access model.
          No modifications permitted.
        </div>
      )}

      {/* Debug: raw JSON */}
      {debugMode && (
        <DebugRawJson
          sections={[
            { label: 'API  -  GET /api/v1/transactions/:id', data: txn },
            { label: 'Linked case', data: linkedCase },
          ]}
        />
      )}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Receipt, ShieldCheck, ArrowLeft, CreditCard, Calendar, Hash, Tag, Radio, FileText, AlertTriangle } from 'lucide-react';
import { useRequireActiveMerchant } from '../../../../../../lib/merchantContext';
import { useDebugMode } from '../../../../../../lib/debugMode';
import { api, type TransactionNotesResponse } from '../../../../../../lib/api';
import { Breadcrumb, type Crumb } from '../../../../../../components/Breadcrumb';

type MerchantTxnDetail = Awaited<ReturnType<typeof api.merchants.transactionById>>;

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

const TYPE_LABELS: Record<string, string> = {
  purchase:         'Purchase',
  cash_advance:     'Cash Advance',
  balance_transfer: 'Balance Transfer',
  refund:           'Refund',
  fee:              'Fee',
  adjustment:       'Adjustment',
};

const INIT_LABELS: Record<string, string> = {
  customerInitiated: 'Customer Initiated (CIT)',
  merchantInitiated: 'Merchant Initiated (MIT)',
};

const CASE_STATUS_DISPLAY: Record<string, { label: string; color: string; icon: string }> = {
  open:             { label: 'Under review',             color: 'bg-amber-100 text-amber-800',  icon: '●' },
  escalated:        { label: 'In investigation',         color: 'bg-orange-100 text-orange-800', icon: '●' },
  resolved_cleared: { label: 'Cleared',                  color: 'bg-green-100 text-green-800',  icon: '✓' },
  resolved_fraud:   { label: 'Fraud confirmed',          color: 'bg-red-100 text-red-800',      icon: '!' },
  closed:           { label: 'Closed',                   color: 'bg-gray-100 text-gray-700',    icon: '–' },
};

export default function MerchantTransactionDetailPage() {
  const { tid } = useParams<{ tid: string }>();
  const { token, merchant } = useRequireActiveMerchant();
  const { debugMode } = useDebugMode();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [txn, setTxn] = useState<MerchantTxnDetail | null>(null);
  const [caseInfo, setCaseInfo] = useState<TransactionNotesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!merchantId || !tid) return;
    setLoading(true);
    api.merchants.transactionById(merchantId, tid, token)
      .then(setTxn)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    api.transactions.getNotes(tid, token)
      .then(setCaseInfo)
      .catch(() => setCaseInfo(null));
  }, [merchantId, tid, token]);

  if (!merchant) return null;

  const crumbs: Crumb[] = [
    { label: 'Merchant', href: `/system/merchant/${merchantId}/overview` },
    { label: 'Transactions', href: `/system/merchant/${merchantId}/payments` },
    { label: txn?.cardTransactionDescription ?? tid ?? 'Detail' },
  ];

  if (loading) return (
    <div className="w-full px-5 sm:px-8 py-6">
      <Breadcrumb items={crumbs} />
      <p className="text-gray-400 mt-4">Loading transaction…</p>
    </div>
  );

  if (error || !txn) return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-3">
      <Breadcrumb items={crumbs} />
      <p className="text-gray-500 mt-4">Transaction not found.</p>
      <Link href={`/system/merchant/${merchantId}/payments`} className="text-blue-600 hover:underline text-sm inline-flex items-center gap-1">
        <ArrowLeft size={14} /> Back to transactions
      </Link>
    </div>
  );

  const dt = new Date(txn.cardTransactionDateTime);
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: txn.cardTransactionAmount.currency,
  }).format(txn.cardTransactionAmount.amount);

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <Breadcrumb items={crumbs} />

      {/* Back link */}
      <Link href={`/system/merchant/${merchantId}/payments`} className="text-sm text-gray-500 hover:text-[#001E2B] inline-flex items-center gap-1 transition-colors">
        <ArrowLeft size={14} /> Back to transactions
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Receipt size={20} className="text-[#001E2B]" />
              Transaction Detail
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {dt.toLocaleDateString()} at {dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-gray-900">{formattedAmount}</p>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[txn.cardTransactionStatus] ?? 'bg-gray-100 text-gray-700'}`}>
              {txn.cardTransactionStatus}
            </span>
          </div>
        </div>
      </div>

      {debugMode && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-start gap-2">
          <ShieldCheck size={14} className="text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700">
            PCI DSS Req 3 &amp; 7 — Merchant acquiring view: only the masked PAN and card token are displayed. Full PAN, CVV, payer identity, and gateway payload are never exposed to the merchant.
          </p>
        </div>
      )}

      {/* Transaction details grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Transaction info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
            <FileText size={15} className="text-[#001E2B]" />
            Transaction Information
          </h2>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            <span className="text-gray-500 flex items-center gap-1.5"><Hash size={12} /> Transaction ID</span>
            <span className="font-mono text-xs break-all text-gray-700">{txn.cardTransactionInstanceReference}</span>

            <span className="text-gray-500 flex items-center gap-1.5"><Calendar size={12} /> Date &amp; Time</span>
            <span className="text-gray-700">{dt.toLocaleString()}</span>

            <span className="text-gray-500 flex items-center gap-1.5"><Tag size={12} /> Type</span>
            <span className="text-gray-700 capitalize">{TYPE_LABELS[txn.cardTransactionType ?? ''] ?? txn.cardTransactionType ?? '-'}</span>

            <span className="text-gray-500 flex items-center gap-1.5"><Radio size={12} /> Channel</span>
            <span className="text-gray-700">{CHANNEL_LABELS[txn.cardTransactionChannel ?? ''] ?? txn.cardTransactionChannel ?? '-'}</span>

            {txn.cardTransactionInitiationType && (
              <>
                <span className="text-gray-500">Initiation</span>
                <span className="text-gray-700">{INIT_LABELS[txn.cardTransactionInitiationType] ?? txn.cardTransactionInitiationType}</span>
              </>
            )}

            {txn.cardTransactionDescription && (
              <>
                <span className="text-gray-500">Description</span>
                <span className="text-gray-700">{txn.cardTransactionDescription}</span>
              </>
            )}

            {txn.cardTransactionNarrative && (
              <>
                <span className="text-gray-500">Narrative</span>
                <span className="text-gray-700">{txn.cardTransactionNarrative}</span>
              </>
            )}
          </div>
        </div>

        {/* Payment card info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
            <CreditCard size={15} className="text-[#001E2B]" />
            Payment Card
          </h2>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            <span className="text-gray-500">Masked PAN</span>
            <span className="font-mono text-gray-700">{txn.cardTransactionMaskedPanDisplay}</span>

            {txn.paymentCardReference && (
              <>
                <span className="text-gray-500">Card Token</span>
                <span className="font-mono text-xs text-gray-600 break-all">{txn.paymentCardReference}</span>
              </>
            )}
          </div>

          {debugMode && (
            <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500">
                <strong>Data minimization:</strong> The card token is a surrogate identifier — not classified as CHD under PCI DSS v4.0. The full PAN, CVV/CVC, PIN, and cardholder identity are never exposed in the merchant view.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Merchant context */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-sm text-gray-700 mb-3">Merchant Context</h2>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
          <span className="text-gray-500">Merchant</span>
          <span className="font-medium text-gray-900">{txn.cardTransactionMerchantName}</span>

          {txn.cardTransactionMerchantCategoryCode && (
            <>
              <span className="text-gray-500">Category (MCC)</span>
              <span className="font-mono text-xs text-gray-700">MCC {txn.cardTransactionMerchantCategoryCode}</span>
            </>
          )}

          <span className="text-gray-500">Amount</span>
          <span className="font-semibold text-gray-900">{formattedAmount}</span>

          <span className="text-gray-500">Currency</span>
          <span className="text-gray-700">{txn.cardTransactionAmount.currency}</span>

          <span className="text-gray-500">Status</span>
          <span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[txn.cardTransactionStatus] ?? 'bg-gray-100 text-gray-700'}`}>
              {txn.cardTransactionStatus}
            </span>
          </span>
        </div>
      </div>

      {/* Security review — investigation status visible to the merchant */}
      {caseInfo?.caseFound ? (() => {
        const caseStatus = caseInfo.fraudDiagnosisCaseStatus ?? '';
        const statusMeta = CASE_STATUS_DISPLAY[caseStatus] ?? { label: caseStatus.replace(/_/g, ' '), color: 'bg-gray-100 text-gray-700', icon: '●' };
        return (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-600" />
              <h2 className="font-semibold text-sm text-gray-700">Security Review</h2>
              {caseInfo.fraudDiagnosisCaseReference && (
                <span className="text-xs font-mono text-gray-400 ml-auto">{caseInfo.fraudDiagnosisCaseReference}</span>
              )}
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Status:</span>
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium ${statusMeta.color}`}>
                <span>{statusMeta.icon}</span> {statusMeta.label}
              </span>
              {caseInfo.fraudDiagnosisCaseSeverity && (
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  caseInfo.fraudDiagnosisCaseSeverity === 'critical' ? 'bg-red-600 text-white' :
                  caseInfo.fraudDiagnosisCaseSeverity === 'high'     ? 'bg-red-500 text-white' :
                  caseInfo.fraudDiagnosisCaseSeverity === 'medium'   ? 'bg-yellow-500 text-black' :
                  'bg-green-600 text-white'
                }`}>
                  {caseInfo.fraudDiagnosisCaseSeverity.toUpperCase()}
                </span>
              )}
            </div>

            {caseInfo.fraudDiagnosisResolutionOutcome && (
              <div className={`rounded-lg p-3 text-sm ${
                caseInfo.fraudDiagnosisResolutionOutcome === 'confirmed_fraud'
                  ? 'bg-red-50 border border-red-200 text-red-800'
                  : 'bg-green-50 border border-green-200 text-green-800'
              }`}>
                {caseInfo.fraudDiagnosisResolutionOutcome === 'confirmed_fraud'
                  ? 'This transaction has been flagged as fraudulent. A chargeback may be initiated. Please retain all transaction records for dispute resolution.'
                  : 'Security review complete. This transaction has been confirmed as legitimate. No action required.'}
              </div>
            )}

            {!caseInfo.fraudDiagnosisResolutionOutcome && (
              <p className="text-xs text-gray-500">
                This transaction is currently under security review by the PSP. You will be notified of any outcome that requires your attention. Please retain all relevant transaction documentation.
              </p>
            )}
          </div>
        );
      })() : caseInfo && !caseInfo.caseFound && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center text-sm text-gray-500">
          ✓ This transaction was processed normally and did not require additional security review.
        </div>
      )}
    </div>
  );
}

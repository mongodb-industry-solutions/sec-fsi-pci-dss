'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ClipboardList } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Pagination } from '../../../../components/Pagination';
import { useDebugMode } from '../../../../lib/debugMode';

interface StoredTransaction {
  txnId: string;
  amount: number;
  currency: string;
  merchant: string;
  mcc: string;
  channel: string;
  cardTransactionType?: string;
  maskedPan: string;
  status: string;
  fraudCaseCreated: boolean;
  caseId?: string;
  createdAt: string;
  paymentReference?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  purchase:         'Purchase',
  refund:           'Refund',
  cash_advance:     'Cash Advance',
  balance_transfer: 'Transfer',
  fee:              'Fee',
  adjustment:       'Adjustment',
};

const TYPE_COLORS: Record<string, string> = {
  purchase:         'bg-blue-50 text-blue-700 border border-blue-200',
  refund:           'bg-green-50 text-green-700 border border-green-200',
  cash_advance:     'bg-amber-50 text-amber-700 border border-amber-200',
  balance_transfer: 'bg-purple-50 text-purple-700 border border-purple-200',
  fee:              'bg-gray-100 text-gray-600',
  adjustment:       'bg-gray-100 text-gray-600',
};

interface TransactionWithCase extends StoredTransaction {
  caseStatus?: string;
  caseRef?: string;
  customerNote?: string | null;
  resolutionOutcome?: string | null;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  authorized:       { label: 'Authorized',                      color: 'bg-green-100 text-green-800' },
  settled:          { label: 'Settled',                         color: 'bg-green-100 text-green-800' },
  under_review:     { label: 'Under review',                    color: 'bg-amber-100 text-amber-800' },
  open:             { label: 'Under review',                    color: 'bg-amber-100 text-amber-800' },
  escalated:        { label: 'In investigation',                color: 'bg-orange-100 text-orange-800' },
  resolved_cleared: { label: 'Cleared',                         color: 'bg-green-100 text-green-800' },
  resolved_fraud:   { label: 'Fraud confirmed - refund issued', color: 'bg-red-100 text-red-800' },
  closed:           { label: 'Closed',                          color: 'bg-gray-100 text-gray-700' },
  declined:         { label: 'Declined',                        color: 'bg-red-100 text-red-800' },
};


function displayStatus(txn: TransactionWithCase) {
  const key = txn.caseStatus ?? txn.status;
  return STATUS_DISPLAY[key] ?? { label: key.replace(/_/g, ' '), color: 'bg-gray-100 text-gray-700' };
}

export default function TransactionHistoryPage() {
  const [allTxns, setAllTxns] = useState<TransactionWithCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  function handleLimitChange(newLimit: number) {
    setPageSize(newLimit);
    setPage(1);
  }
  const { debugMode } = useDebugMode();

  useEffect(() => {
    const load = async () => {
      const t = getToken() ?? '';
      const u = t ? decodeToken(t) : null;

      try {
        // Real, single source of truth. The backend scopes a customer to their own
        // transactions (it ignores the email param for the customer role).
        const res = await api.transactions.listAll({ email: u?.email, limit: 100 }, t);
        const mapped: TransactionWithCase[] = res.results.map((r) => {
          const row = r as {
            cardTransactionInstanceReference: string;
            cardTransactionAmount: { amount: number; currency: string };
            cardTransactionDateTime: string;
            cardTransactionStatus: string;
            cardTransactionType?: string;
            cardTransactionMerchantName: string;
            cardTransactionMerchantCategoryCode?: string;
            cardTransactionChannel?: string;
            cardTransactionMaskedPanDisplay: string;
          };
          return {
            txnId:               row.cardTransactionInstanceReference,
            amount:              row.cardTransactionAmount?.amount ?? 0,
            currency:            row.cardTransactionAmount?.currency ?? 'USD',
            merchant:            row.cardTransactionMerchantName,
            mcc:                 row.cardTransactionMerchantCategoryCode ?? '',
            channel:             row.cardTransactionChannel ?? '',
            cardTransactionType: row.cardTransactionType,
            maskedPan:           row.cardTransactionMaskedPanDisplay,
            status:              row.cardTransactionStatus,
            fraudCaseCreated:    false,
            createdAt:           row.cardTransactionDateTime,
          };
        });
        setAllTxns(mapped);
      } catch {
        setAllTxns([]);
      }
      setLoading(false);
    };
    load();
  }, []);

  const totalPages = Math.max(1, Math.ceil(allTxns.length / pageSize));
  const paginated = allTxns.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6">
        <div className="mb-5">
          <SectionHeader
            icon={ClipboardList}
            title="Transactions"
            description="Your payment history and the status of each transaction."
            debugInfo="BIAN SD-254 Card Transaction · PCI DSS Req 7.2 (need-to-know: own data only)"
            actions={
              <Link href="/system/payment" className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium">
                <Plus size={14} />
                New Payment
              </Link>
            }
          />
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading your transactions...</div>
        ) : allTxns.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
            <p className="mb-2">No transactions yet.</p>
            <Link href="/system/payment" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
              Make your first payment
            </Link>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-5">
              {paginated.map((txn) => {
                const { label, color } = displayStatus(txn);
                return (
                  <Link
                    key={txn.txnId}
                    href={`/system/payment/history/${txn.txnId}`}
                    className="group block bg-white rounded-xl border p-4 hover:border-[#001E2B]/30 hover:shadow-md transition-all cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{txn.merchant}</p>
                        <p className="text-xs text-gray-500">{new Date(txn.createdAt).toLocaleString()}</p>
                        {txn.paymentReference && (
                          <p className="text-xs text-gray-400 mt-0.5">Ref: {txn.paymentReference}</p>
                        )}
                      </div>
                      <div className="flex items-start gap-3 shrink-0">
                        <div className="text-right">
                          <p className="font-bold text-gray-900">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: txn.currency,
                            }).format(txn.amount)}
                          </p>
                          <p className="text-xs text-gray-500 font-mono">{txn.maskedPan}</p>
                        </div>
                        <span className="text-gray-300 group-hover:text-[#001E2B] transition-colors text-lg leading-none mt-0.5">›</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>{label}</span>
                      {txn.cardTransactionType && (
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_COLORS[txn.cardTransactionType] ?? 'bg-gray-100 text-gray-600'}`}>
                          {TYPE_LABELS[txn.cardTransactionType] ?? txn.cardTransactionType.replace(/_/g, ' ')}
                        </span>
                      )}
                      {txn.caseRef && (
                        <span className="text-xs text-gray-400 font-mono">{txn.caseRef}</span>
                      )}
                      <span className="text-xs text-gray-400 capitalize">{txn.channel}</span>
                    </div>

                    {txn.customerNote && (
                      <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs text-blue-800">
                        <span className="font-semibold">✉ Security team: </span>{txn.customerNote}
                      </div>
                    )}

                    {debugMode && (
                      <p className="mt-1.5 text-xs font-mono text-gray-400 truncate">id: {txn.txnId}</p>
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Pagination: count + size selector always visible, navigation when >1 page */}
            <Pagination
              page={page}
              totalPages={totalPages}
              total={allTxns.length}
              limit={pageSize}
              onPageChange={setPage}
              onLimitChange={handleLimitChange}
              limitOptions={[5, 10, 20, 50]}
              noun="transactions"
            />
          </>
        )}
      </main>
    </div>
  );
}

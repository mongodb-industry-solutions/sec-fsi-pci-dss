'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Pagination } from '../../../../components/Pagination';

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
  const [debugMode, setDebugMode] = useState(false);

  useEffect(() => {
    const load = async () => {
      const t = getToken() ?? '';
      const u = t ? decodeToken(t) : null;

      const storageKey = u?.sub ? `demo_transactions_${u.sub}` : 'demo_transactions_guest';
      const stored: StoredTransaction[] = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (stored.length === 0) { setLoading(false); return; }

      const enriched: TransactionWithCase[] = await Promise.all(
        stored.map(async (txn) => {
          if (!txn.caseId) return txn;
          try {
            const c = await api.fraud.getById(txn.caseId, t);
            return {
              ...txn,
              caseStatus: c.caseStatus,
              caseRef: c.fraudDiagnosisCaseReference,
              customerNote: c.fraudDiagnosisCustomerSubjectNotes,
              resolutionOutcome: c.fraudDiagnosisResolutionRecord?.resolutionOutcome ?? null,
            };
          } catch {
            return txn;
          }
        })
      );
      setAllTxns(enriched);
      setLoading(false);
    };
    load();
  }, []);

  const totalPages = Math.max(1, Math.ceil(allTxns.length / pageSize));
  const paginated = allTxns.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-2xl mx-auto p-6">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-2xl font-bold">My Transactions</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDebugMode((v) => !v)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${debugMode ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}
            >⚙ {debugMode ? 'Debug ON' : 'Debug'}</button>
            <Link href="/demo/payment" className="bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg text-sm font-semibold">
              New Payment
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading your transactions...</div>
        ) : allTxns.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
            <p className="mb-2">No transactions yet.</p>
            <Link href="/demo/payment" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
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
                    href={`/demo/payment/history/${txn.txnId}`}
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

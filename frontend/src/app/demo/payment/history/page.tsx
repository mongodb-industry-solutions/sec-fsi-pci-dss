'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';

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
  caseNotes?: string | null;
  customerNote?: string | null;
  riskSeverity?: string;
  caseRef?: string;
  resolutionOutcome?: string | null;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  authorized: { label: 'Authorized', color: 'bg-green-100 text-green-800' },
  settled: { label: 'Settled', color: 'bg-green-100 text-green-800' },
  under_review: { label: 'Under review', color: 'bg-amber-100 text-amber-800' },
  open: { label: 'Under review', color: 'bg-amber-100 text-amber-800' },
  escalated: { label: 'In investigation', color: 'bg-orange-100 text-orange-800' },
  under_review_case: { label: 'In investigation', color: 'bg-orange-100 text-orange-800' },
  resolved_cleared: { label: 'Cleared', color: 'bg-green-100 text-green-800' },
  resolved_fraud: { label: 'Fraud confirmed - refund issued', color: 'bg-red-100 text-red-800' },
  closed: { label: 'Closed', color: 'bg-gray-100 text-gray-700' },
  declined: { label: 'Declined', color: 'bg-red-100 text-red-800' },
};

export default function TransactionHistoryPage() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<ReturnType<typeof decodeToken>>(null);
  const [transactions, setTransactions] = useState<TransactionWithCase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const t = getToken() ?? '';
      setToken(t);
      setUser(t ? decodeToken(t) : null);
      const stored: StoredTransaction[] = JSON.parse(localStorage.getItem('demo_transactions') ?? '[]');
      if (stored.length === 0) { setLoading(false); return; }

      // Enrich with case status and notes where fraud case was created
      const enriched: TransactionWithCase[] = await Promise.all(
        stored.map(async (txn) => {
          if (!txn.caseId) return txn;
          try {
            const c = await api.fraud.getById(txn.caseId, t);
            return {
              ...txn,
              caseStatus: c.caseStatus,
              caseRef: c.fraudDiagnosisCaseReference,
              caseNotes: c.fraudDiagnosisCaseNotes,
              customerNote: c.fraudDiagnosisCustomerSubjectNotes,
              riskSeverity: c.riskSeverity,
              resolutionOutcome: c.fraudDiagnosisResolutionRecord?.resolutionOutcome ?? null,
            };
          } catch {
            return txn;
          }
        })
      );
      setTransactions(enriched);
      setLoading(false);
    };
    load();
  }, [token]);

  function resolvedDisplayStatus(txn: TransactionWithCase): { label: string; color: string } {
    if (txn.caseStatus) return STATUS_LABELS[txn.caseStatus] ?? { label: txn.caseStatus.replace(/_/g, ' '), color: 'bg-gray-100 text-gray-700' };
    return STATUS_LABELS[txn.status] ?? { label: txn.status.replace(/_/g, ' '), color: 'bg-gray-100 text-gray-700' };
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex justify-between items-center">
        <span className="font-bold text-[#00ED64]">LeafyBank</span>
        <div className="flex gap-3 items-center text-sm">
          {user && <span className="text-gray-300 text-xs">{user.name}</span>}
          <Link href="/demo" className="text-gray-400 hover:text-white">Sign out</Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-6">
        <div className="flex justify-between items-center mb-5">
          <h1 className="text-2xl font-bold">My Transactions</h1>
          <Link href="/demo/payment" className="bg-[#001E2B] text-[#00ED64] px-4 py-2 rounded-lg text-sm font-semibold">
            New Payment
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading your transactions...</div>
        ) : transactions.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
            <p className="mb-2">No transactions yet.</p>
            <p className="text-sm text-gray-400">Transactions above $500 or from high-risk merchants are automatically flagged for security review.</p>
            <Link href="/demo/payment" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
              Make your first payment
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.map((txn) => {
              const { label, color } = resolvedDisplayStatus(txn);
              return (
                <div key={txn.txnId} className="bg-white rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="font-semibold text-gray-900">{txn.merchant}</p>
                      <p className="text-xs text-gray-500">{new Date(txn.createdAt).toLocaleString()}</p>
                      {txn.paymentReference && <p className="text-xs text-gray-500 mt-0.5">Ref: {txn.paymentReference}</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.currency }).format(txn.amount)}
                      </p>
                      <p className="text-xs text-gray-500 font-mono">{txn.maskedPan}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>{label}</span>
                    {txn.caseRef && <span className="text-xs text-gray-400 font-mono">{txn.caseRef}</span>}
                    <span className="text-xs text-gray-400 capitalize">{txn.channel}</span>
                  </div>

                  {/* Customer-visible note from investigators */}
                  {txn.customerNote && (
                    <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-sm text-blue-800">
                      <p className="text-xs font-semibold mb-0.5">Message from security team</p>
                      {txn.customerNote}
                    </div>
                  )}

                  {/* Status transitions context */}
                  {txn.caseStatus && txn.caseStatus !== txn.status && (
                    <div className="mt-2 text-xs text-gray-500">
                      {txn.caseStatus === 'escalated' && 'Our security team is conducting a detailed review of this transaction.'}
                      {txn.caseStatus === 'under_review' && 'This transaction is being reviewed by our fraud prevention team.'}
                      {txn.caseStatus === 'resolved_fraud' && 'This transaction was confirmed as fraudulent. A full refund has been initiated.'}
                      {txn.caseStatus === 'resolved_cleared' && 'Our review is complete. This transaction has been confirmed as legitimate.'}
                    </div>
                  )}

                  {txn.resolutionOutcome === 'confirmed_fraud' && (
                    <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-800">
                      Unauthorized transaction confirmed. Your card has been secured and a refund is being processed.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

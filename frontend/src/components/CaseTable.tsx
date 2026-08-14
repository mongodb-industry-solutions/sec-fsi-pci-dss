'use client';
import { FraudCase, TransactionSnapshot } from '../lib/api';
import { SEVERITY_COLORS, STATUS_COLORS } from '../lib/constants';
import Link from 'next/link';
import { formatAmount } from '../lib/money';

interface Props {
  cases: FraudCase[];
  basePath: string;
}

function snapshotAmount(snap?: TransactionSnapshot): string {
  if (!snap) return '-';
  const { amount, currency } = snap.cardTransactionAmount;
  return formatAmount(amount, currency);
}

export function CaseTable({ cases, basePath }: Props) {
  if (cases.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No cases found matching the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {['Case', 'Masked PAN', 'Amount', 'Merchant', 'Severity', 'Status'].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wide text-xs"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {cases.map((c) => (
            <tr key={c.fraudDiagnosisInstanceReference} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-mono">
                <Link
                  href={`${basePath}/${c.fraudDiagnosisInstanceReference}`}
                  className="text-blue-600 hover:underline"
                >
                  {c.fraudDiagnosisCaseReference}
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-gray-600">
                {c.transactionSnapshot?.cardTransactionMaskedPanDisplay ?? '-'}
              </td>
              <td className="px-4 py-3 text-gray-800 font-medium">
                {snapshotAmount(c.transactionSnapshot)}
              </td>
              <td className="px-4 py-3 text-gray-600 truncate max-w-[160px]">
                {c.transactionSnapshot?.cardTransactionMerchantName ?? '-'}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${SEVERITY_COLORS[c.riskSeverity ?? ''] ?? 'bg-gray-100 text-gray-600'}`}
                >
                  {(c.riskSeverity ?? 'N/A').toUpperCase()}
                </span>
              </td>
              <td className="px-4 py-3">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[c.caseStatus ?? ''] ?? 'bg-gray-100 text-gray-800'}`}
                >
                  {(c.caseStatus ?? 'N/A').replace(/_/g, ' ')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

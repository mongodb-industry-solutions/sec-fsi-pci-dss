'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  caseId: string;
  severity: string;
  caseRef: string;
  investigationPath: string;
  noAutoRedirect?: boolean;
}

export function FraudAlert({ caseId, severity, caseRef, investigationPath, noAutoRedirect }: Props) {
  const [countdown, setCountdown] = useState(noAutoRedirect ? -1 : 3);
  const [stopped, setStopped] = useState(noAutoRedirect ?? false);
  const router = useRouter();

  useEffect(() => {
    if (stopped) return;
    if (countdown <= 0) {
      router.push(`${investigationPath}/${caseId}`);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, stopped, caseId, investigationPath, router]);

  const severityColor =
    severity === 'critical' || severity === 'high'
      ? 'bg-red-50 border-red-400 text-red-800'
      : severity === 'medium'
      ? 'bg-yellow-50 border-yellow-400 text-yellow-800'
      : 'bg-green-50 border-green-400 text-green-800';

  return (
    <div className={`rounded-lg border-2 p-4 ${severityColor}`}>
      <div className="flex items-center gap-2 font-semibold text-lg mb-1">
        🚨 Fraud Alert: Risk Severity: {severity.toUpperCase()}
      </div>
      <p className="text-sm mb-2">
        Case <strong>{caseRef}</strong> has been opened automatically.
      </p>
      {!stopped && (
        <p className="text-sm mb-3">
          Switching to Investigation in{' '}
          <strong>{countdown}s</strong>…
        </p>
      )}
      <div className="flex gap-3">
        <button
          onClick={() => setStopped(true)}
          className="px-3 py-1.5 text-sm border rounded hover:bg-white/50 transition-colors"
        >
          Stay here
        </button>
        <a
          href={`${investigationPath}/${caseId}`}
          className="px-3 py-1.5 text-sm bg-white rounded border font-medium hover:bg-gray-50 transition-colors"
        >
          → Investigate this case
        </a>
      </div>
    </div>
  );
}

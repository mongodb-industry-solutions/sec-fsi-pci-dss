'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, FraudCase } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { EncryptionBadge } from '../../../../components/EncryptionBadge';
import { RawDocumentPanel } from '../../../../components/RawDocumentPanel';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../../../lib/constants';

export default function DemoCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const token = getToken() ?? '';
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [rawDoc, setRawDoc] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.fraudCases.getById(caseId, token).then(setFraudCase).finally(() => setLoading(false));
  }, [caseId, token]);

  async function toggleRaw() {
    if (!showRaw && !rawDoc && fraudCase) {
      try {
        const res = await api.demo.rawDocument('cardTransaction', fraudCase.linkedCardTransactionReference, token);
        setRawDoc(res.document);
      } catch { /* non-prod endpoint unavailable */ }
    }
    setShowRaw((v) => !v);
  }

  if (loading) return <div className="text-center py-12 text-gray-400">Loading…</div>;
  if (!fraudCase) return <div className="text-center py-12 text-gray-500">Case not found.</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex items-center justify-between">
        <span className="font-bold text-[#00ED64]">🏦 LeafyBank Demo</span>
        <Link href="/demo" className="text-sm text-gray-400 hover:text-white">Sign out</Link>
      </header>
      <main className="max-w-2xl mx-auto p-6 space-y-5">
        <Link href="/demo/investigation" className="text-sm text-blue-600 hover:underline">← Back</Link>

        <div className="bg-white rounded-xl border p-5">
          <div className="flex gap-3 items-center mb-3">
            <h1 className="text-xl font-bold">{fraudCase.fraudDiagnosisCaseReference}</h1>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEVERITY_COLORS[fraudCase.riskSeverity] ?? ''}`}>{fraudCase.riskSeverity.toUpperCase()}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[fraudCase.caseStatus] ?? ''}`}>{fraudCase.caseStatus.replace(/_/g,' ')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="font-medium">Risk indicators:</span>
            <span>{fraudCase.fraudDiagnosisAssessment?.riskIndicators.join(', ') ?? '—'}</span>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold mb-3">Customer Profile</h2>
          <div className="space-y-2 text-sm">
            <div className="flex gap-2 items-center">
              <EncryptionBadge label="Email" type="qe-equality" />
              <span className="text-gray-500 italic">[encrypted: equality-searchable]</span>
            </div>
            <div className="flex gap-2 items-center">
              <EncryptionBadge label="Phone" type="qe-equality" />
              <span className="text-gray-500 italic">[encrypted: equality-searchable]</span>
            </div>
            <div className="flex gap-2 items-center">
              <EncryptionBadge label="Account Ref" type="qe-equality" />
              <span className="text-gray-500 italic">[encrypted: equality-searchable]</span>
            </div>
            <div className="pt-2 border-t text-gray-500">
              🔒 <strong>Address</strong> &amp; <strong>Gov. ID</strong>: Level 2 escalation required
              <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Coming in v2</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Atlas Storage</h2>
            <button onClick={toggleRaw} className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50">
              {showRaw ? '👁 Business View' : '🔐 Raw Atlas Document'}
            </button>
          </div>
          {showRaw && rawDoc && <RawDocumentPanel document={rawDoc} collection="cardTransaction" />}
          {showRaw && !rawDoc && (
            <p className="text-sm text-gray-500">Raw document endpoint unavailable (requires non-production env).</p>
          )}
        </div>

        {fraudCase.diagnosisActionLog && fraudCase.diagnosisActionLog.length > 0 && (
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-3">📋 Audit Log</h2>
            {fraudCase.diagnosisActionLog.map((e, i) => (
              <div key={i} className="flex gap-3 text-sm py-1.5 border-b last:border-0">
                <span className="text-gray-400 font-mono text-xs">{new Date(e.actionDateTime).toLocaleString()}</span>
                <span className="font-medium">{e.actionType.replace(/_/g,' ')}</span>
                <span className="text-gray-500">{e.performedByRole}</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

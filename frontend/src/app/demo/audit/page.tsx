'use client';
import { useEffect, useState } from 'react';
import { api, FraudCase } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import Link from 'next/link';

export default function AuditPage() {
  const token = getToken() ?? '';
  const user = token ? decodeToken(token) : null;
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.fraudCases.list({ limit: 50 }, token)
      .then((res) => setCases(res.results))
      .finally(() => setLoading(false));
  }, [token]);

  const allEvents = cases.flatMap((c) =>
    (c.diagnosisActionLog ?? []).map((e) => ({
      ...e,
      caseRef: c.fraudDiagnosisCaseReference,
      caseId: c.fraudDiagnosisInstanceReference,
    }))
  ).sort((a, b) => new Date(b.actionDateTime).getTime() - new Date(a.actionDateTime).getTime());

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex justify-between">
        <span className="font-bold text-[#00ED64]">🏦 LeafyBank Demo</span>
        <div className="flex gap-3 items-center text-sm">
          {user && <span className="text-gray-300">{user.name} [Security Auditor]</span>}
          <Link href="/demo" className="text-gray-400 hover:text-white">Sign out</Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-5">📋 Audit Log</h1>
        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading audit events…</div>
        ) : (
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="min-w-full text-sm divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Datetime (UTC)', 'Case', 'Action', 'Role', 'Details'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {allEvents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      No audit events found.
                    </td>
                  </tr>
                ) : (
                  allEvents.map((e, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
                        {new Date(e.actionDateTime).toISOString().replace('T', ' ').slice(0, 19)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        <Link href={`/demo/investigation/${e.caseId}`} className="text-blue-600 hover:underline">
                          {e.caseRef}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 font-medium">{e.actionType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2.5 text-gray-600">{e.performedByRole}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">
                        {JSON.stringify(e.actionDetails ?? {})}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

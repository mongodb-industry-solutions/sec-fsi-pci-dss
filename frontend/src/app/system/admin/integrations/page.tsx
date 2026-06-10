'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, CheckCircle2, AlertCircle, Clock, WifiOff, RefreshCw, Pause,
} from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { useDebugMode } from '../../../../lib/debugMode';
import { ROLE_LABELS } from '../../../../lib/constants';

interface Integration {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName: string;
  externalProviderArrangementType: string;
  externalProviderArrangementStatus: string;
  externalProviderIsInternal: boolean;
  externalProviderMode: string;
  externalProviderApiKeyPrefix?: string;
  externalProviderApiEndpoint?: string;
  externalProviderHealthStatus?: string;
  externalProviderLastHealthCheckAt?: string;
  bianServiceDomain: string;
  pciDssRequirements: string[];
  recordCreatedDateTime: string;
}

const TYPE_LABEL: Record<string, string> = {
  fraud_detection: 'Fraud Detection',
  hrp_sanctions:   'HRP / Sanctions',
  kyc_identity:    'KYC / Identity',
  kyb_business:    'KYB / Business',
  aml_monitoring:  'AML Monitoring',
  credit_bureau:   'Credit Bureau',
};

function HealthDot({ status }: { status?: string }) {
  if (!status || status === 'unknown')  return <span title="Unknown"><Clock size={14} className="text-gray-400" /></span>;
  if (status === 'ok')                  return <span title="Healthy"><CheckCircle2 size={14} className="text-green-600" /></span>;
  if (status === 'degraded')            return <span title="Degraded"><AlertCircle size={14} className="text-amber-600" /></span>;
  if (status === 'unreachable')         return <span title="Unreachable"><WifiOff size={14} className="text-red-600" /></span>;
  return null;
}

export default function IntegrationsListPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { status: string; latencyMs: number }>>({});
  const { debugMode } = useDebugMode();

  const token = getToken() ?? '';

  function reload() {
    setLoading(true);
    api.integrations.list(token)
      .then(d => { setIntegrations(d.integrations as unknown as Integration[]); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const r = await api.integrations.test(id, token);
      setTestResult(prev => ({ ...prev, [id]: r }));
      reload();
    } catch {
      setTestResult(prev => ({ ...prev, [id]: { status: 'error', latencyMs: 0 } }));
    } finally {
      setTesting(null);
    }
  }

  async function handleSuspend(id: string) {
    try {
      await api.integrations.suspend(id, token);
      reload();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
            <p className="text-sm text-gray-500 mt-0.5">SD-193 External Provider Arrangements</p>
          </div>
          <Link
            href="/system/admin/integrations/new"
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"
          >
            <Plus size={14} />
            Register Provider
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading integrations...</div>
        ) : (
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="text-left px-4 py-3 font-medium">Provider</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Mode</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Health</th>
                  {debugMode && <th className="text-left px-4 py-3 font-medium">BIAN</th>}
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {integrations.map(i => (
                  <tr key={i.externalProviderArrangementInstanceReference} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{i.externalProviderArrangementName}</span>
                        {i.externalProviderIsInternal && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium border border-slate-200">Built-in</span>
                        )}
                      </div>
                      {i.externalProviderApiKeyPrefix && (
                        <span className="text-xs text-gray-400 font-mono">{i.externalProviderApiKeyPrefix}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{TYPE_LABEL[i.externalProviderArrangementType] ?? i.externalProviderArrangementType}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${i.externalProviderMode === 'sync' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                        {i.externalProviderMode}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        i.externalProviderArrangementStatus === 'active'    ? 'bg-green-100 text-green-700' :
                        i.externalProviderArrangementStatus === 'inactive'  ? 'bg-gray-100 text-gray-600' :
                        i.externalProviderArrangementStatus === 'test'      ? 'bg-blue-100 text-blue-700' :
                                                                              'bg-red-100 text-red-700'
                      }`}>
                        {i.externalProviderArrangementStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <HealthDot status={i.externalProviderHealthStatus} />
                        {testResult[i.externalProviderArrangementInstanceReference] && (
                          <span className={`text-xs ${testResult[i.externalProviderArrangementInstanceReference].status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                            {testResult[i.externalProviderArrangementInstanceReference].latencyMs}ms
                          </span>
                        )}
                      </div>
                    </td>
                    {debugMode && (
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">{i.bianServiceDomain}</td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleTest(i.externalProviderArrangementInstanceReference)}
                          disabled={testing === i.externalProviderArrangementInstanceReference}
                          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw size={11} className={testing === i.externalProviderArrangementInstanceReference ? 'animate-spin' : ''} />
                          Test
                        </button>
                        {!i.externalProviderIsInternal && i.externalProviderArrangementStatus !== 'suspended' && (
                          <button
                            onClick={() => handleSuspend(i.externalProviderArrangementInstanceReference)}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-red-200 hover:border-red-400 text-red-600 hover:text-red-800 transition-colors"
                          >
                            <Pause size={11} />
                            Suspend
                          </button>
                        )}
                        <Link
                          href={`/system/admin/integrations/${i.externalProviderArrangementInstanceReference}`}
                          className="text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition-colors"
                        >
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {debugMode && (
          <div className="mt-4 text-xs text-gray-400 font-mono">
            {ROLE_LABELS['manager']} · PCI DSS Req 12.8.1 — maintained list of all third-party service providers
          </div>
        )}
      </main>
    </div>
  );
}

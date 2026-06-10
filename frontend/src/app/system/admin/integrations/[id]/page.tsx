'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, KeyRound, Pause, CheckCircle2,
  AlertCircle, Clock, WifiOff, ChevronRight, ChevronDown,
} from 'lucide-react';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useDebugMode } from '../../../../../lib/debugMode';

interface Integration {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName: string;
  externalProviderArrangementType: string;
  externalProviderArrangementStatus: string;
  externalProviderIsInternal: boolean;
  externalProviderMode: string;
  externalProviderApiEndpoint?: string;
  externalProviderApiKeyPrefix?: string;
  externalProviderHealthStatus?: string;
  externalProviderLastHealthCheckAt?: string;
  externalProviderCallbackUrl?: string;
  bianServiceDomain: string;
  bianControlRecordType: string;
  pciDssRequirements: string[];
  recordCreatedDateTime: string;
  externalProviderInternalHandler?: string;
  externalProviderRetryPolicy?: { maxAttempts: number; backoffMs: number };
}

interface IntegrationEvent {
  integrationEventInstanceReference: string;
  integrationEventType: string;
  integrationEventStatus: string;
  integrationEventLatencyMs?: number;
  integrationEventErrorMessage?: string;
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

function HealthBadge({ status }: { status?: string }) {
  if (!status || status === 'unknown') return <span className="flex items-center gap-1 text-xs text-gray-400"><Clock size={12} />Unknown</span>;
  if (status === 'ok')          return <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle2 size={12} />Healthy</span>;
  if (status === 'degraded')    return <span className="flex items-center gap-1 text-xs text-amber-600 font-medium"><AlertCircle size={12} />Degraded</span>;
  if (status === 'unreachable') return <span className="flex items-center gap-1 text-xs text-red-600 font-medium"><WifiOff size={12} />Unreachable</span>;
  return null;
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`text-sm text-gray-900 mt-0.5 break-all ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

export default function IntegrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = getToken() ?? '';
  const { debugMode } = useDebugMode();

  const [integration, setIntegration] = useState<Integration | null>(null);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; latencyMs: number } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(true);

  function load() {
    Promise.all([
      api.integrations.get(id, token),
      api.integrations.events(id, token, 1, 20),
    ]).then(([d1, d2]) => {
      setIntegration(d1.integration as unknown as Integration);
      const evts = d2 as unknown as { events: IntegrationEvent[]; total: number };
      setEvents(evts.events);
      setEventsTotal(evts.total);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.integrations.test(id, token);
      setTestResult(r);
      load();
    } catch {
      setTestResult({ status: 'error', latencyMs: 0 });
    } finally {
      setTesting(false);
    }
  }

  async function handleRotate() {
    if (!confirm('Rotate the API key? The current key will be invalidated immediately.')) return;
    setRotating(true);
    try {
      const r = await api.integrations.rotateKey(id, token);
      setNewKey((r as { apiKey: string }).apiKey);
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRotating(false);
    }
  }

  async function handleSuspend() {
    if (!confirm('Suspend this integration? Traffic will fall back to the built-in default.')) return;
    try {
      await api.integrations.suspend(id, token);
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading...</div>;
  if (!integration) return <div className="flex items-center justify-center min-h-screen text-gray-400">Integration not found.</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6">
        <div className="mb-5">
          <Link href="/system/admin/integrations" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors w-fit">
            <ArrowLeft size={12} />
            All Integrations
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{integration.externalProviderArrangementName}</h1>
              {integration.externalProviderIsInternal && (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium border border-slate-200">Built-in</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                integration.externalProviderArrangementStatus === 'active'   ? 'bg-green-100 text-green-700' :
                integration.externalProviderArrangementStatus === 'inactive' ? 'bg-gray-100 text-gray-600' :
                integration.externalProviderArrangementStatus === 'test'     ? 'bg-blue-100 text-blue-700' :
                                                                               'bg-red-100 text-red-700'
              }`}>
                {integration.externalProviderArrangementStatus}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:border-gray-500 text-gray-700 hover:text-gray-900 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={testing ? 'animate-spin' : ''} />
                {testing ? 'Testing…' : 'Run Test'}
              </button>
              {!integration.externalProviderIsInternal && (
                <>
                  <button
                    onClick={handleRotate}
                    disabled={rotating}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-300 hover:border-amber-500 text-amber-700 hover:text-amber-900 transition-colors disabled:opacity-50"
                  >
                    <KeyRound size={12} />
                    {rotating ? 'Rotating…' : 'Rotate Key'}
                  </button>
                  {integration.externalProviderArrangementStatus !== 'suspended' && (
                    <button
                      onClick={handleSuspend}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-300 hover:border-red-500 text-red-700 hover:text-red-900 transition-colors"
                    >
                      <Pause size={12} />
                      Suspend
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* New key banner — shown exactly once */}
        {newKey && (
          <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-900 mb-1">New API Key — save it now</p>
            <p className="text-xs text-amber-700 mb-2">This key will not be shown again. Copy it and store it securely.</p>
            <code className="block bg-white border border-amber-200 rounded px-3 py-2 text-sm font-mono text-amber-900 break-all select-all">{newKey}</code>
            <button onClick={() => setNewKey(null)} className="mt-2 text-xs text-amber-600 hover:text-amber-900 underline">Dismiss</button>
          </div>
        )}

        {/* Test result banner */}
        {testResult && (
          <div className={`mb-4 rounded-xl border p-3 flex items-center gap-2 ${testResult.status === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {testResult.status === 'ok'
              ? <CheckCircle2 size={14} />
              : <AlertCircle size={14} />
            }
            <span className="text-sm font-medium">
              {testResult.status === 'ok' ? `Test passed — ${testResult.latencyMs}ms` : `Test failed (${testResult.status})`}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
          {/* Configuration */}
          <div className="lg:col-span-2 bg-white rounded-xl border p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Configuration</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Type" value={TYPE_LABEL[integration.externalProviderArrangementType] ?? integration.externalProviderArrangementType} />
              <Field label="Mode" value={integration.externalProviderMode} />
              {integration.externalProviderApiEndpoint && (
                <Field label="API Endpoint" value={integration.externalProviderApiEndpoint} mono />
              )}
              {integration.externalProviderApiKeyPrefix && (
                <Field label="API Key (prefix)" value={integration.externalProviderApiKeyPrefix + '…'} mono />
              )}
              {integration.externalProviderCallbackUrl && (
                <Field label="Callback URL" value={integration.externalProviderCallbackUrl} mono />
              )}
              {integration.externalProviderInternalHandler && (
                <Field label="Internal Handler" value={integration.externalProviderInternalHandler} mono />
              )}
              {integration.externalProviderRetryPolicy && (
                <Field
                  label="Retry Policy"
                  value={`${integration.externalProviderRetryPolicy.maxAttempts} attempts · ${integration.externalProviderRetryPolicy.backoffMs}ms backoff`}
                />
              )}
              <Field label="Registered" value={new Date(integration.recordCreatedDateTime).toLocaleString()} />
            </dl>
          </div>

          {/* BIAN + Health */}
          <div className="flex flex-col gap-4">
            <div className="bg-white rounded-xl border p-4">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Health</h2>
              <HealthBadge status={integration.externalProviderHealthStatus} />
              {integration.externalProviderLastHealthCheckAt && (
                <p className="text-xs text-gray-400 mt-1">
                  Last checked {new Date(integration.externalProviderLastHealthCheckAt).toLocaleString()}
                </p>
              )}
            </div>
            {debugMode && (
              <div className="bg-white rounded-xl border p-4">
                <h2 className="text-sm font-semibold text-gray-800 mb-3">BIAN Mapping</h2>
                <dl className="space-y-2">
                  <div>
                    <dt className="text-xs text-gray-500">Service Domain</dt>
                    <dd className="text-sm font-mono text-gray-900">{integration.bianServiceDomain}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Control Record</dt>
                    <dd className="text-sm text-gray-900">{integration.bianControlRecordType}</dd>
                  </div>
                  {integration.pciDssRequirements?.length > 0 && (
                    <div>
                      <dt className="text-xs text-gray-500">PCI DSS</dt>
                      <dd className="text-xs font-mono text-gray-900 mt-0.5">{integration.pciDssRequirements.join(', ')}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        </div>

        {/* Event Log */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
            onClick={() => setShowEvents(v => !v)}
          >
            <span>Event Log <span className="text-gray-400 font-normal">({eventsTotal} total)</span></span>
            {showEvents ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {showEvents && (
            events.length === 0 ? (
              <div className="px-5 pb-5 text-sm text-gray-400">No events yet. Run a test to see results here.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-t border-b bg-gray-50 text-gray-500 uppercase">
                    <th className="text-left px-4 py-2.5 font-medium">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th className="text-right px-4 py-2.5 font-medium">Latency</th>
                    <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Error</th>
                    <th className="text-right px-4 py-2.5 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.integrationEventInstanceReference} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-gray-600">{e.integrationEventType}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${
                          e.integrationEventStatus === 'success'  ? 'bg-green-100 text-green-700' :
                          e.integrationEventStatus === 'failed'   ? 'bg-red-100 text-red-700' :
                          e.integrationEventStatus === 'timeout'  ? 'bg-amber-100 text-amber-700' :
                                                                    'bg-gray-100 text-gray-600'
                        }`}>
                          {e.integrationEventStatus}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-500">
                        {e.integrationEventLatencyMs != null ? `${e.integrationEventLatencyMs}ms` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-red-500 hidden sm:table-cell truncate max-w-[200px]">
                        {e.integrationEventErrorMessage ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-400">
                        {new Date(e.recordCreatedDateTime).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </main>
    </div>
  );
}

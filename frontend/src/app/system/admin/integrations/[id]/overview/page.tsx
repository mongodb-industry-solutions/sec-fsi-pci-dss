'use client';
import { useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, WifiOff, Clock } from 'lucide-react';
import { useIntegration, TYPE_LABEL } from '../_context';
import { Card } from '../_shared';
import { api } from '../../../../../../lib/api';
import { useDebugMode } from '../../../../../../lib/debugMode';

// ── Type descriptions ────────────────────────────────────────────────────────

const TYPE_PURPOSE: Record<string, string> = {
  fraud_detection: 'Evaluates transactions and events in real time to detect and score potential fraud using configurable rule engines, ML models, or external scoring APIs. Results inform whether transactions should be blocked, flagged, or allowed.',
  hrp_sanctions:   'Screens counterparties, beneficiaries, and transaction participants against global sanctions lists and high-risk-person (HRP) databases. Required for regulatory compliance in cross-border and domestic payment flows.',
  kyc_identity:    'Verifies the identity of individual customers by matching submitted documents and biometric data against authoritative sources. Feeds the customer onboarding and periodic review workflows.',
  kyb_business:    'Validates the legal existence, beneficial ownership, and compliance standing of business customers. Required before activating commercial accounts or raising transaction limits.',
  aml_monitoring:  'Continuously monitors transaction patterns for signs of money laundering, structuring, or layering. Generates alerts that feed the case management and SAR filing workflows.',
  credit_bureau:   'Retrieves credit scores, bureau reports, and risk attributes to support lending, credit-limit decisions, and affordability assessments.',
  generic:         'General-purpose external integration provider. Handles custom data flows not covered by the standard integration types.',
};

// ── Health badge ──────────────────────────────────────────────────────────────

function HealthStatus({ status }: { status?: string }) {
  if (!status || status === 'unknown') return (
    <span className="flex items-center gap-1.5 text-sm text-gray-400"><Clock size={14} />Unknown; no test run yet</span>
  );
  if (status === 'ok') return (
    <span className="flex items-center gap-1.5 text-sm text-green-700 font-medium"><CheckCircle2 size={14} />Healthy</span>
  );
  if (status === 'degraded') return (
    <span className="flex items-center gap-1.5 text-sm text-amber-700 font-medium"><AlertCircle size={14} />Degraded; elevated response times</span>
  );
  if (status === 'unreachable') return (
    <span className="flex items-center gap-1.5 text-sm text-red-600 font-medium"><WifiOff size={14} />Unreachable; connection failed</span>
  );
  return null;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const { integration, reload, token } = useIntegration();
  const { debugMode } = useDebugMode();
  const [testing, setTesting]   = useState(false);
  const [testMsg, setTestMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  if (!integration) return null;

  const id = integration.externalProviderArrangementInstanceReference;

  async function handleTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await api.integrations.test(id, token);
      setTestMsg({ ok: r.status === 'ok', text: r.status === 'ok' ? `Connection OK; ${r.latencyMs}ms` : `Test failed: ${r.status}` });
      reload();
    } catch (err) {
      setTestMsg({ ok: false, text: (err as Error).message });
    } finally { setTesting(false); }
  }

  const triggerEvents = integration.externalProviderTriggerEvents ?? [];

  return (
    <div className="space-y-5">
      {/* Purpose */}
      <Card title="Purpose">
        <p className="text-sm text-gray-700 leading-relaxed">
          {TYPE_PURPOSE[integration.externalProviderArrangementType] ?? 'No description available.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium border">
            {TYPE_LABEL[integration.externalProviderArrangementType] ?? integration.externalProviderArrangementType}
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium border">
            {integration.bianServiceDomain}
          </span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
            integration.externalProviderMode === 'sync' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'
          }`}>
            {integration.externalProviderMode === 'sync' ? 'Synchronous' : 'Asynchronous'}
          </span>
        </div>
      </Card>

      {/* Provider info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Card title="Provider">
          <dl className="space-y-3">
            <div>
              <dt className="text-xs text-gray-500">Name</dt>
              <dd className="text-sm font-medium text-gray-900 mt-0.5">{integration.externalProviderArrangementName}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Provider type</dt>
              <dd className="text-sm text-gray-700 mt-0.5">
                {integration.externalProviderIsInternal
                  ? <span>Built-in <span className="text-gray-400">(LeafyBank internal module)</span></span>
                  : 'External (third-party API)'}
              </dd>
            </div>
            {integration.externalProviderInternalHandler && (
              <div>
                <dt className="text-xs text-gray-500">Internal handler</dt>
                <dd className="text-sm font-mono text-gray-700 mt-0.5">{integration.externalProviderInternalHandler}</dd>
              </div>
            )}
            {integration.externalProviderApiEndpoint && (
              <div>
                <dt className="text-xs text-gray-500">Outbound endpoint</dt>
                <dd className="text-sm font-mono text-gray-700 mt-0.5 break-all">{integration.externalProviderApiEndpoint}</dd>
              </div>
            )}
            {integration.externalProviderApiKeyPrefix && (
              <div>
                <dt className="text-xs text-gray-500">API key (prefix)</dt>
                <dd className="text-sm font-mono text-gray-500 mt-0.5">{integration.externalProviderApiKeyPrefix}…</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-gray-500">Registered</dt>
              <dd className="text-sm text-gray-700 mt-0.5">{new Date(integration.recordCreatedDateTime).toLocaleString()}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Health">
          <div className="space-y-3">
            <HealthStatus status={integration.externalProviderHealthStatus} />
            {integration.externalProviderLastHealthCheckAt && (
              <p className="text-xs text-gray-400">
                Last checked: {new Date(integration.externalProviderLastHealthCheckAt).toLocaleString()}
              </p>
            )}
            {!integration.externalProviderIsInternal && (
              <button onClick={handleTest} disabled={testing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-300 hover:border-gray-500 text-gray-700 disabled:opacity-50 mt-2 transition-colors">
                <RefreshCw size={11} className={testing ? 'animate-spin' : ''} />
                {testing ? 'Testing connection…' : 'Test connection now'}
              </button>
            )}
            {testMsg && (
              <p className={`text-xs font-medium ${testMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{testMsg.text}</p>
            )}
          </div>
        </Card>
      </div>

      {/* Trigger events */}
      <Card
        title="System events linked to this integration"
        subtitle="These are the internal LeafyBank events that can activate or be processed by this integration provider.">
        {triggerEvents.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No trigger events configured.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {triggerEvents.map(ev => (
              <span key={ev}
                className="text-xs px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium font-mono">
                {ev}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* BIAN / PCI (debug only) */}
      {debugMode && (
        <Card title="BIAN Mapping & PCI DSS">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-gray-500">BIAN Service Domain</dt>
              <dd className="font-mono text-gray-800 mt-0.5">{integration.bianServiceDomain}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Control Record Type</dt>
              <dd className="text-gray-800 mt-0.5">{integration.bianControlRecordType}</dd>
            </div>
            {integration.pciDssRequirements?.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-gray-500">PCI DSS Requirements</dt>
                <dd className="font-mono text-gray-700 mt-0.5 text-xs">{integration.pciDssRequirements.join(', ')}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}
    </div>
  );
}

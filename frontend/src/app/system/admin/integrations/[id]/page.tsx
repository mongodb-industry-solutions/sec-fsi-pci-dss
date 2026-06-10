'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, KeyRound, Pause, CheckCircle2,
  AlertCircle, Clock, WifiOff, ChevronRight, ChevronDown,
  Settings, Shield, ArrowRightLeft, Layers, Network, List,
  Plus, Trash2, FlaskConical,
} from 'lucide-react';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useDebugMode } from '../../../../../lib/debugMode';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FieldMapping {
  sourcePath: string;
  targetPath: string;
  transform?: { type: string; scaleFactor?: number; valueMap?: Record<string, string> };
  required?: boolean;
}

interface FieldMappingConfig {
  outbound: FieldMapping[];
  inbound: FieldMapping[];
  schemaVersion: number;
}

interface AuthConfig {
  scheme?: string;
  bearer?: { tokenHeaderName?: string; tokenPrefix?: string };
  apiKey?: { keyHeaderName?: string; keyLocation?: string };
}

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
  externalProviderInternalHandler?: string;
  externalProviderRetryPolicy?: { maxAttempts: number; backoffMs: number };
  categoryConfig?: Record<string, unknown>;
  authConfig?: AuthConfig;
  fieldMappingConfig?: FieldMappingConfig;
  routingGroupId?: string;
  routingPriority?: number;
  bianServiceDomain: string;
  bianControlRecordType: string;
  pciDssRequirements: string[];
  recordCreatedDateTime: string;
}

interface IntegrationEvent {
  integrationEventInstanceReference: string;
  integrationEventType: string;
  integrationEventStatus: string;
  integrationEventLatencyMs?: number;
  integrationEventErrorMessage?: string;
  recordCreatedDateTime: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  fraud_detection: 'Fraud Detection', hrp_sanctions: 'HRP / Sanctions',
  kyc_identity: 'KYC / Identity', kyb_business: 'KYB / Business',
  aml_monitoring: 'AML Monitoring', credit_bureau: 'Credit Bureau', generic: 'Generic',
};

const TABS = [
  { id: 'overview',   label: 'Overview',        icon: Settings },
  { id: 'auth',       label: 'Authentication',  icon: Shield },
  { id: 'mapping',    label: 'Field Mapping',   icon: ArrowRightLeft },
  { id: 'category',   label: 'Category Config', icon: Layers },
  { id: 'routing',    label: 'Routing',         icon: Network },
  { id: 'events',     label: 'Events',          icon: List },
];

const TRANSFORM_TYPES = ['rename', 'value_map', 'scale', 'nested_extract', 'nested_wrap'];

// ── Sub-components ────────────────────────────────────────────────────────────

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

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ integration, debugMode }: { integration: Integration; debugMode: boolean }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 bg-white rounded-xl border p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">Configuration</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Type" value={TYPE_LABEL[integration.externalProviderArrangementType] ?? integration.externalProviderArrangementType} />
          <Field label="Mode" value={integration.externalProviderMode} />
          {integration.externalProviderApiEndpoint && <Field label="API Endpoint" value={integration.externalProviderApiEndpoint} mono />}
          {integration.externalProviderApiKeyPrefix && <Field label="API Key (prefix)" value={integration.externalProviderApiKeyPrefix + '…'} mono />}
          {integration.externalProviderInternalHandler && <Field label="Internal Handler" value={integration.externalProviderInternalHandler} mono />}
          {integration.externalProviderRetryPolicy && (
            <Field label="Retry Policy" value={`${integration.externalProviderRetryPolicy.maxAttempts} attempts · ${integration.externalProviderRetryPolicy.backoffMs}ms backoff`} />
          )}
          <Field label="Registered" value={new Date(integration.recordCreatedDateTime).toLocaleString()} />
        </dl>
      </div>
      <div className="flex flex-col gap-4">
        <div className="bg-white rounded-xl border p-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">Health</h2>
          <HealthBadge status={integration.externalProviderHealthStatus} />
          {integration.externalProviderLastHealthCheckAt && (
            <p className="text-xs text-gray-400 mt-1">Last checked {new Date(integration.externalProviderLastHealthCheckAt).toLocaleString()}</p>
          )}
        </div>
        {debugMode && (
          <div className="bg-white rounded-xl border p-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">BIAN Mapping</h2>
            <dl className="space-y-2">
              <div><dt className="text-xs text-gray-500">Service Domain</dt><dd className="text-sm font-mono text-gray-900">{integration.bianServiceDomain}</dd></div>
              <div><dt className="text-xs text-gray-500">Control Record</dt><dd className="text-sm text-gray-900">{integration.bianControlRecordType}</dd></div>
              {integration.pciDssRequirements?.length > 0 && (
                <div><dt className="text-xs text-gray-500">PCI DSS</dt><dd className="text-xs font-mono text-gray-900 mt-0.5">{integration.pciDssRequirements.join(', ')}</dd></div>
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Authentication ───────────────────────────────────────────────────────

function AuthTab({ integration, token, onSave }: { integration: Integration; token: string; onSave: () => void }) {
  const [authConfig, setAuthConfig] = useState<AuthConfig>(integration.authConfig ?? { scheme: 'bearer' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (integration.externalProviderIsInternal) {
    return <div className="bg-white rounded-xl border p-5 text-sm text-gray-400">Built-in providers use internal authentication. No external credentials required.</div>;
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.integrations.update(integration.externalProviderArrangementInstanceReference, { authConfig }, token);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSave();
    } finally {
      setSaving(false);
    }
  }

  const scheme = authConfig.scheme ?? 'bearer';

  return (
    <div className="bg-white rounded-xl border p-5 space-y-4 max-w-xl">
      <h2 className="text-sm font-semibold text-gray-800">Authentication Configuration</h2>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Auth Scheme</label>
        <select
          value={scheme}
          onChange={e => setAuthConfig(c => ({ ...c, scheme: e.target.value }))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="bearer">Bearer Token</option>
          <option value="api_key">API Key</option>
          <option value="hmac">HMAC</option>
          <option value="oauth2_cc">OAuth2 Client Credentials</option>
        </select>
      </div>

      {scheme === 'bearer' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Header Name</label>
            <input
              value={authConfig.bearer?.tokenHeaderName ?? 'Authorization'}
              onChange={e => setAuthConfig(c => ({ ...c, bearer: { ...c.bearer, tokenHeaderName: e.target.value } }))}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Token Prefix</label>
            <input
              value={authConfig.bearer?.tokenPrefix ?? 'Bearer'}
              onChange={e => setAuthConfig(c => ({ ...c, bearer: { ...c.bearer, tokenPrefix: e.target.value } }))}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      )}

      {scheme === 'api_key' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Header Name</label>
            <input
              value={authConfig.apiKey?.keyHeaderName ?? 'X-API-Key'}
              onChange={e => setAuthConfig(c => ({ ...c, apiKey: { ...c.apiKey, keyHeaderName: e.target.value } }))}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
            <select
              value={authConfig.apiKey?.keyLocation ?? 'header'}
              onChange={e => setAuthConfig(c => ({ ...c, apiKey: { ...c.apiKey, keyLocation: e.target.value } }))}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            >
              <option value="header">Header</option>
              <option value="query">Query Param</option>
            </select>
          </div>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${saved ? 'bg-green-600 text-white' : 'bg-[#001E2B] text-[#00ED64] hover:opacity-90'} disabled:opacity-50`}
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Auth Config'}
      </button>
    </div>
  );
}

// ── Tab: Field Mapping ────────────────────────────────────────────────────────

const EMPTY_RULE: FieldMapping = { sourcePath: '', targetPath: '', transform: { type: 'rename' } };

function MappingRuleRow({
  rule, onChange, onRemove,
}: { rule: FieldMapping; onChange: (r: FieldMapping) => void; onRemove: () => void }) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2">
        <input
          value={rule.sourcePath}
          onChange={e => onChange({ ...rule, sourcePath: e.target.value })}
          placeholder="source.field"
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono"
        />
      </td>
      <td className="px-3 py-2">
        <input
          value={rule.targetPath}
          onChange={e => onChange({ ...rule, targetPath: e.target.value })}
          placeholder="target.field"
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs font-mono"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={rule.transform?.type ?? 'rename'}
          onChange={e => onChange({ ...rule, transform: { ...rule.transform, type: e.target.value } })}
          className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
        >
          {TRANSFORM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      {rule.transform?.type === 'scale' && (
        <td className="px-3 py-2">
          <input
            type="number"
            value={rule.transform?.scaleFactor ?? 1}
            onChange={e => onChange({ ...rule, transform: { ...rule.transform, type: 'scale', scaleFactor: parseFloat(e.target.value) } })}
            className="w-20 border border-gray-200 rounded px-2 py-1 text-xs"
          />
        </td>
      )}
      <td className="px-3 py-2">
        <button onClick={onRemove} className="text-red-400 hover:text-red-600">
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
}

function FieldMappingTab({ integration, token, onSave }: { integration: Integration; token: string; onSave: () => void }) {
  const [outbound, setOutbound] = useState<FieldMapping[]>(integration.fieldMappingConfig?.outbound ?? []);
  const [inbound, setInbound]   = useState<FieldMapping[]>(integration.fieldMappingConfig?.inbound ?? []);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [testDir, setTestDir]   = useState<'outbound' | 'inbound'>('outbound');
  const [testPayload, setTestPayload] = useState('{\n  "caseId": "case-123",\n  "score": 0.85\n}');
  const [testResult, setTestResult]   = useState<{ original: Record<string, unknown>; transformed: Record<string, unknown>; appliedRules: number } | null>(null);
  const [testError, setTestError]     = useState('');

  async function handleSave() {
    setSaving(true);
    try {
      await api.integrations.update(
        integration.externalProviderArrangementInstanceReference,
        { fieldMappingConfig: { outbound, inbound, schemaVersion: 1 } },
        token
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSave();
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestError('');
    setTestResult(null);
    try {
      const payload = JSON.parse(testPayload) as Record<string, unknown>;
      const r = await api.integrations.testMapping(
        integration.externalProviderArrangementInstanceReference,
        { direction: testDir, payload },
        token
      );
      setTestResult(r);
    } catch (err) {
      setTestError((err as Error).message);
    }
  }

  function RuleTable({ rules, setRules, dir }: { rules: FieldMapping[]; setRules: (r: FieldMapping[]) => void; dir: string }) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{dir === 'outbound' ? 'Outbound (LeafyBank → External)' : 'Inbound (External → LeafyBank)'}</h3>
          <button
            onClick={() => setRules([...rules, { ...EMPTY_RULE }])}
            className="flex items-center gap-1 text-xs text-[#001E2B] hover:underline"
          >
            <Plus size={11} /> Add rule
          </button>
        </div>
        {rules.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-2">No mapping rules. Fields pass through unchanged.</p>
        ) : (
          <table className="w-full text-xs border rounded-lg overflow-hidden">
            <thead><tr className="bg-gray-50 border-b text-gray-500"><th className="text-left px-3 py-2">Source path</th><th className="text-left px-3 py-2">Target path</th><th className="text-left px-3 py-2">Transform</th><th className="px-3 py-2 w-6"></th></tr></thead>
            <tbody>
              {rules.map((r, idx) => (
                <MappingRuleRow
                  key={idx}
                  rule={r}
                  onChange={updated => { const copy = [...rules]; copy[idx] = updated; setRules(copy); }}
                  onRemove={() => setRules(rules.filter((_, i) => i !== idx))}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border p-5 space-y-5">
        <RuleTable rules={outbound} setRules={setOutbound} dir="outbound" />
        <div className="border-t" />
        <RuleTable rules={inbound} setRules={setInbound} dir="inbound" />
        <button
          onClick={handleSave}
          disabled={saving}
          className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${saved ? 'bg-green-600 text-white' : 'bg-[#001E2B] text-[#00ED64] hover:opacity-90'} disabled:opacity-50`}
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Mapping Rules'}
        </button>
      </div>

      {/* Test panel */}
      <div className="bg-white rounded-xl border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical size={14} className="text-violet-600" />
          <h3 className="text-sm font-semibold text-gray-800">Test Mapping (Dry Run)</h3>
        </div>
        <div className="flex gap-3 items-center">
          <label className="text-xs text-gray-600">Direction:</label>
          <select value={testDir} onChange={e => setTestDir(e.target.value as 'outbound' | 'inbound')} className="border rounded px-2 py-1 text-xs">
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
        </div>
        <textarea
          value={testPayload}
          onChange={e => setTestPayload(e.target.value)}
          rows={4}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono resize-none"
        />
        <button onClick={handleTest} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-violet-300 text-violet-700 hover:bg-violet-50">
          <FlaskConical size={11} /> Run Test
        </button>
        {testError && <p className="text-xs text-red-600">{testError}</p>}
        {testResult && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Original</p>
              <pre className="bg-gray-50 border rounded p-2 text-xs overflow-auto max-h-32">{JSON.stringify(testResult.original, null, 2)}</pre>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Transformed ({testResult.appliedRules} rules applied)</p>
              <pre className="bg-green-50 border border-green-200 rounded p-2 text-xs overflow-auto max-h-32">{JSON.stringify(testResult.transformed, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Category Config ──────────────────────────────────────────────────────

function CategoryConfigTab({ integration, token, onSave }: { integration: Integration; token: string; onSave: () => void }) {
  const [config, setConfig] = useState<Record<string, unknown>>(
    (integration.categoryConfig as Record<string, unknown>) ?? {}
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  if (integration.externalProviderIsInternal) {
    return (
      <div className="bg-white rounded-xl border p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">Category Configuration</h2>
        <pre className="bg-gray-50 border rounded-lg p-3 text-xs overflow-auto max-h-60">{JSON.stringify(config, null, 2)}</pre>
        <p className="text-xs text-gray-400">Built-in providers have read-only category configuration.</p>
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.integrations.update(integration.externalProviderArrangementInstanceReference, { categoryConfig: config }, token);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSave();
    } finally {
      setSaving(false);
    }
  }

  // Render string/number/boolean fields from the config object
  function renderField(key: string, value: unknown) {
    if (typeof value === 'boolean') {
      return (
        <div key={key} className="flex items-center justify-between">
          <label className="text-xs text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</label>
          <input type="checkbox" checked={value} onChange={e => setConfig(c => ({ ...c, [key]: e.target.checked }))} className="rounded" />
        </div>
      );
    }
    if (typeof value === 'number') {
      return (
        <div key={key}>
          <label className="block text-xs text-gray-600 mb-1 capitalize">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</label>
          <input
            type="number"
            value={value}
            onChange={e => setConfig(c => ({ ...c, [key]: parseFloat(e.target.value) }))}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
          />
        </div>
      );
    }
    if (typeof value === 'string') {
      return (
        <div key={key}>
          <label className="block text-xs text-gray-600 mb-1 capitalize">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</label>
          <input
            value={value}
            onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
          />
        </div>
      );
    }
    if (Array.isArray(value)) {
      return (
        <div key={key}>
          <label className="block text-xs text-gray-600 mb-1 capitalize">{key.replace(/([A-Z])/g, ' $1').toLowerCase()} (comma-separated)</label>
          <input
            value={value.join(', ')}
            onChange={e => setConfig(c => ({ ...c, [key]: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
          />
        </div>
      );
    }
    return null;
  }

  const simpleFields = Object.entries(config).filter(([, v]) => typeof v !== 'object' || Array.isArray(v));

  return (
    <div className="bg-white rounded-xl border p-5 space-y-4 max-w-xl">
      <h2 className="text-sm font-semibold text-gray-800">
        Category Configuration — {TYPE_LABEL[integration.externalProviderArrangementType] ?? integration.externalProviderArrangementType}
      </h2>
      <div className="space-y-3">
        {simpleFields.map(([k, v]) => renderField(k, v))}
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${saved ? 'bg-green-600 text-white' : 'bg-[#001E2B] text-[#00ED64] hover:opacity-90'} disabled:opacity-50`}
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Category Config'}
      </button>
    </div>
  );
}

// ── Tab: Routing ──────────────────────────────────────────────────────────────

function RoutingTab({ integration, token }: { integration: Integration; token: string }) {
  const [groups, setGroups] = useState<Record<string, unknown>[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupStrategy, setNewGroupStrategy] = useState('primary_fallback');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.integrationGroups.list(token, { type: integration.externalProviderArrangementType })
      .then(r => setGroups(r.groups))
      .catch(() => {});
  }, [token, integration.externalProviderArrangementType]);

  if (integration.externalProviderIsInternal) {
    return <div className="bg-white rounded-xl border p-5 text-sm text-gray-400">Built-in providers cannot be added to routing groups.</div>;
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    setCreating(true);
    try {
      await api.integrationGroups.create({
        name: newGroupName,
        providerType: integration.externalProviderArrangementType,
        strategy: newGroupStrategy,
      }, token);
      const r = await api.integrationGroups.list(token, { type: integration.externalProviderArrangementType });
      setGroups(r.groups);
      setNewGroupName('');
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinGroup(groupId: string) {
    await api.integrationGroups.addMember(groupId, { providerId: integration.externalProviderArrangementInstanceReference }, token);
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      {integration.routingGroupId ? (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-800">
          <strong>Member of routing group</strong> — ID: <code className="font-mono text-xs">{integration.routingGroupId}</code>
          <p className="text-xs mt-1">Priority: {integration.routingPriority ?? 100} (lower = higher priority)</p>
        </div>
      ) : (
        <div className="bg-gray-50 border rounded-xl p-4 text-sm text-gray-500">Not part of any routing group. Single provider mode.</div>
      )}

      {/* Existing groups for this type */}
      {groups.length > 0 && (
        <div className="bg-white rounded-xl border p-4 space-y-2">
          <h3 className="text-sm font-semibold text-gray-800">Available Groups</h3>
          {groups.map(g => {
            const gid = g.routingGroupInstanceReference as string;
            const members = (g.routingGroupMembers as Record<string, unknown>[]) ?? [];
            const isMember = members.some(m => m.externalProviderArrangementInstanceReference === integration.externalProviderArrangementInstanceReference);
            return (
              <div key={gid} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{g.routingGroupName as string}</span>
                  <span className="ml-2 text-xs text-gray-400">{g.routingGroupStrategy as string} · {members.length} member(s)</span>
                </div>
                {!isMember && (
                  <button onClick={() => handleJoinGroup(gid)} className="text-xs px-2 py-1 rounded border border-violet-300 text-violet-700 hover:bg-violet-50">
                    Join
                  </button>
                )}
                {isMember && <span className="text-xs text-violet-600 font-medium">✓ Member</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Create new group */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Create New Routing Group</h3>
        <div className="grid grid-cols-2 gap-3">
          <input
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            placeholder="Group name"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={newGroupStrategy}
            onChange={e => setNewGroupStrategy(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="primary_fallback">Primary / Fallback</option>
            <option value="round_robin">Round Robin</option>
          </select>
        </div>
        <button
          onClick={handleCreateGroup}
          disabled={creating || !newGroupName.trim()}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border border-gray-300 hover:border-gray-500 text-gray-700 disabled:opacity-50"
        >
          <Plus size={12} /> Create Group
        </button>
      </div>
    </div>
  );
}

// ── Tab: Events ───────────────────────────────────────────────────────────────

function EventsTab({ integration, token }: { integration: Integration; token: string }) {
  const [events, setEvents]   = useState<IntegrationEvent[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]       = useState(true);

  useEffect(() => {
    api.integrations.events(integration.externalProviderArrangementInstanceReference, token, 1, 20)
      .then(r => { const d = r as unknown as { events: IntegrationEvent[]; total: number }; setEvents(d.events); setTotal(d.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [integration.externalProviderArrangementInstanceReference, token]);

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-gray-800 hover:bg-gray-50"
        onClick={() => setOpen(v => !v)}
      >
        <span>Event Log <span className="text-gray-400 font-normal">({total} total)</span></span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && !loading && (
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
                      e.integrationEventStatus === 'received' ? 'bg-green-100 text-green-700' :
                      e.integrationEventStatus === 'error'    ? 'bg-red-100 text-red-700' :
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
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function IntegrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const token = getToken() ?? '';
  const { debugMode } = useDebugMode();

  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; latencyMs: number } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey]     = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.integrations.get(id, token)
      .then(d => { setIntegration(d.integration as unknown as Integration); })
      .catch((err: unknown) => {
        const msg = (err as Error)?.message ?? 'Failed to load integration';
        setLoadError(msg.includes('404') || msg.includes('not found') ? 'Integration not found.' : msg);
      })
      .finally(() => setLoading(false));
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try {
      const r = await api.integrations.test(id, token);
      setTestResult(r);
      load();
    } catch { setTestResult({ status: 'error', latencyMs: 0 }); }
    finally { setTesting(false); }
  }

  async function handleRotate() {
    if (!confirm('Rotate the API key? The current key will be invalidated immediately.')) return;
    setRotating(true);
    try {
      const r = await api.integrations.rotateKey(id, token);
      setNewKey((r as { apiKey: string }).apiKey);
      load();
    } catch (err) { alert((err as Error).message); }
    finally { setRotating(false); }
  }

  async function handleSuspend() {
    if (!confirm('Suspend this integration? Traffic will fall back to the built-in default.')) return;
    try { await api.integrations.suspend(id, token); load(); }
    catch (err) { alert((err as Error).message); }
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen text-gray-400">Loading...</div>;
  if (!integration) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3">
      <AlertCircle size={28} className="text-red-400" />
      <p className="text-gray-700 font-medium">{loadError ?? 'Integration not found.'}</p>
      <Link href="/system/admin/integrations" className="text-xs text-gray-400 hover:text-gray-700 underline flex items-center gap-1">
        <ArrowLeft size={12} />Back to Registry
      </Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6">
        {/* Header */}
        <div className="mb-5">
          <Link href="/system/admin/integrations" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors w-fit">
            <ArrowLeft size={12} />All Integrations
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
              <button onClick={handleTest} disabled={testing} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:border-gray-500 text-gray-700 disabled:opacity-50">
                <RefreshCw size={12} className={testing ? 'animate-spin' : ''} />
                {testing ? 'Testing…' : 'Run Test'}
              </button>
              {!integration.externalProviderIsInternal && (
                <>
                  <button onClick={handleRotate} disabled={rotating} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-300 hover:border-amber-500 text-amber-700 disabled:opacity-50">
                    <KeyRound size={12} />{rotating ? 'Rotating…' : 'Rotate Key'}
                  </button>
                  {integration.externalProviderArrangementStatus !== 'suspended' && (
                    <button onClick={handleSuspend} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-red-300 hover:border-red-500 text-red-700">
                      <Pause size={12} />Suspend
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Banners */}
        {newKey && (
          <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-900 mb-1">New API Key — save it now</p>
            <p className="text-xs text-amber-700 mb-2">This key will not be shown again.</p>
            <code className="block bg-white border border-amber-200 rounded px-3 py-2 text-sm font-mono text-amber-900 break-all select-all">{newKey}</code>
            <button onClick={() => setNewKey(null)} className="mt-2 text-xs text-amber-600 hover:text-amber-900 underline">Dismiss</button>
          </div>
        )}
        {testResult && (
          <div className={`mb-4 rounded-xl border p-3 flex items-center gap-2 ${testResult.status === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {testResult.status === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span className="text-sm font-medium">
              {testResult.status === 'ok' ? `Test passed — ${testResult.latencyMs}ms` : `Test failed (${testResult.status})`}
            </span>
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex gap-1 mb-5 bg-white border rounded-xl p-1 overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[#001E2B] text-[#00ED64]'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'overview'  && <OverviewTab integration={integration} debugMode={debugMode} />}
        {activeTab === 'auth'      && <AuthTab integration={integration} token={token} onSave={load} />}
        {activeTab === 'mapping'   && <FieldMappingTab integration={integration} token={token} onSave={load} />}
        {activeTab === 'category'  && <CategoryConfigTab integration={integration} token={token} onSave={load} />}
        {activeTab === 'routing'   && <RoutingTab integration={integration} token={token} />}
        {activeTab === 'events'    && <EventsTab integration={integration} token={token} />}
      </main>
    </div>
  );
}

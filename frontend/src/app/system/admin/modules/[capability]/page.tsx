'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Boxes, Save } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { JsonEditor } from '../../../../../components/json/JsonEditor';
import { JsonView } from '../../../../../components/json/JsonView';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';
import { byCapability, isCapabilityKey } from '../../../../../config/capabilities';

export default function ModuleConfigPage() {
  const params = useParams();
  const capability = String(params.capability);
  const token = getToken() ?? '';
  const notify = useNotify();

  const descriptor = isCapabilityKey(capability) ? byCapability(capability) : null;

  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const c = await api.modules.getConfig(capability, token);
        setConfig(c);
        setText(JSON.stringify((c?.moduleConfig as Record<string, unknown>) ?? {}, null, 2));
      } catch {
        setConfig(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [capability, token]);

  const invalid = (() => { try { if (text.trim()) JSON.parse(text); return false; } catch { return true; } })();

  async function save() {
    if (invalid) return;
    setSaving(true);
    try {
      const moduleConfig = text.trim() ? JSON.parse(text) : {};
      const updated = await api.modules.updateConfig(capability, moduleConfig, token);
      setConfig(updated);
      notify('Module configuration saved', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: descriptor?.label ?? capability }]} />
      <SectionHeader
        icon={Boxes}
        title={`${descriptor?.label ?? capability}; Internal Module`}
        description={descriptor?.description ?? 'Internal engine configuration.'}
        debugInfo={`capability=${capability}${descriptor ? ` · ${descriptor.bianServiceDomain}` : ''}`}
      />

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="font-semibold text-gray-800 text-sm">Engine configuration <code className="font-mono text-xs text-gray-500">moduleConfig</code></h2>
            <p className="text-xs text-gray-500">Thresholds / rules used by the internal engine; overrides the built-in defaults.</p>
            <JsonEditor value={text} onChange={setText} minHeight="10rem" maxHeight="22rem" error={invalid ? 'Invalid JSON' : null} />
            <button onClick={save} disabled={saving || invalid}
              className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
              <Save size={15} />{saving ? 'Saving…' : 'Save configuration'}
            </button>
          </div>

          {config?.moduleCallbackEndpoints !== undefined && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2">
              <h2 className="font-semibold text-gray-800 text-sm">Callback endpoints</h2>
              <p className="text-xs text-gray-500">Routes this module calls back into the PSP after processing (the round-trip the linking vendor relies on).</p>
              <JsonView data={config.moduleCallbackEndpoints} maxHeight="10rem" collapsed={2} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { KeyRound, Power, Trash2, Shield, Info, Pencil, Check, X } from 'lucide-react';
import { api } from '../../../../../../lib/api';
import { getToken } from '../../../../../../lib/auth';
import { SectionHeader } from '../../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../../components/Breadcrumb';
import { RequirePermission } from '../../../../../../components/RequirePermission';
import { useConfirm, useNotify } from '../../../../../../components/ui/ConfirmProvider';
import { DomainAccessPanel } from '../DomainAccessPanel';

type Domain = Record<string, unknown>;

const FLOW_LABELS: Record<string, string> = {
  client_credentials: 'Client Credentials', authorization_code: 'Authorization Code (OIDC)', saml: 'SAML 2.0', oidc: 'OIDC',
};
const DOMAIN_TYPES = ['local', 'oidc', 'saml'];
const FLOW_TYPES = ['client_credentials', 'authorization_code', 'saml', 'oidc'];

interface DomainDraft { display: string; type: string; flow: string; enabled: boolean; alert: string; selfReg: boolean; autoApprove: boolean; }

function DomainDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();
  const [token, setToken] = useState('');
  const [domain, setDomain] = useState<Domain | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DomainDraft | null>(null);

  useEffect(() => { setToken(getToken() ?? ''); }, []);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try { setDomain(await api.modules.domains.get(id, token)); }
    catch (err) { notify((err as Error).message, 'error'); setDomain(null); }
    finally { setLoading(false); }
  }, [token, id, notify]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="w-full px-5 sm:px-8 lg:px-12 py-8 text-center text-sm text-gray-400">Loading domain…</div>;
  if (!domain) return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-8 text-sm text-gray-500">
      Domain not found. <button onClick={() => router.push('/system/admin/modules/domains')} className="text-blue-600 hover:underline">Back to domains</button>
    </div>
  );

  const name = String(domain.partyAuthenticationDomainName ?? '');
  const display = String(domain.partyAuthenticationDomainDisplayName ?? name);
  const type = String(domain.partyAuthenticationDomainType ?? 'local');
  const flow = String(domain.partyAuthenticationDomainFlowType ?? (type === 'local' ? 'client_credentials' : type));
  const enabled = Boolean(domain.partyAuthenticationDomainEnabled);
  const isLocal = type === 'local';

  async function toggleEnabled() {
    setBusy(true);
    try {
      await api.modules.domains.update(id, { partyAuthenticationDomainEnabled: !enabled } as Record<string, unknown>, token);
      notify(`Domain ${!enabled ? 'enabled' : 'disabled'}.`, 'success'); load();
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  function startEdit() {
    setDraft({
      display, type, flow, enabled,
      alert: String(domain?.partyAuthenticationDomainAlertMessage ?? ''),
      selfReg: Boolean(domain?.partyAuthenticationDomainSelfRegistrationEnabled),
      autoApprove: Boolean(domain?.partyAuthenticationDomainSelfRegistrationAutoApprove),
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!draft) return;
    setBusy(true);
    try {
      await api.modules.domains.update(id, {
        partyAuthenticationDomainDisplayName: draft.display.trim(),
        partyAuthenticationDomainType: draft.type,
        partyAuthenticationDomainFlowType: draft.flow,
        partyAuthenticationDomainEnabled: draft.enabled,
        partyAuthenticationDomainAlertMessage: draft.alert.trim() || undefined,
        // Self-registration only applies to local domains; auto-approve is meaningless without it.
        partyAuthenticationDomainSelfRegistrationEnabled: draft.type === 'local' ? draft.selfReg : false,
        partyAuthenticationDomainSelfRegistrationAutoApprove: draft.type === 'local' && draft.selfReg ? draft.autoApprove : false,
      } as Record<string, unknown>, token);
      notify('Domain updated.', 'success'); setEditing(false); load();
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  async function remove() {
    const ok = await confirm({ title: `Delete domain "${display}"?`, message: 'Users/mappings tied to this domain lose their login path. This cannot be undone.', confirmLabel: 'Delete domain', tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    try { await api.modules.domains.remove(id, token); notify('Domain deleted.', 'success'); router.push('/system/admin/modules/domains'); }
    catch (err) { notify((err as Error).message, 'error'); setBusy(false); }
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[
        { label: 'Home', href: '/system' },
        { label: 'Domains', href: '/system/admin/modules/domains' },
        { label: display },
      ]} />
      <SectionHeader
        icon={KeyRound}
        title={display}
        description={`${isLocal ? 'Local' : type.toUpperCase()} authentication & authorization domain · ${FLOW_LABELS[flow] ?? flow}`}
        debugInfo={`${name} · ${enabled ? 'enabled' : 'disabled'}`}
        actions={
          <button onClick={toggleEnabled} disabled={busy}
            className={`inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border font-medium transition-colors ${enabled ? 'border-gray-300 text-gray-600 hover:bg-gray-50' : 'border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64]'}`}>
            <Power size={14} /> {enabled ? 'Disable' : 'Enable'}
          </button>
        }
      />

      {/* Details; read-only summary or inline editor (main fields) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-gray-800">Domain details</h2>
          {editing ? (
            <div className="flex items-center gap-2">
              <button onClick={saveEdit} disabled={busy} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-[#001E2B] text-[#00ED64] font-medium disabled:opacity-50"><Check size={14} /> Save</button>
              <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border text-gray-500 hover:bg-gray-50"><X size={14} /> Cancel</button>
            </div>
          ) : (
            <button onClick={startEdit} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"><Pencil size={13} /> Edit</button>
          )}
        </div>

        {editing && draft ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Slug (login identifier)</label>
              <input value={name} disabled className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-400" />
              <p className="text-[10px] text-gray-400 mt-0.5">Immutable; used in the JWT domain claim.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Display name</label>
              <input value={draft.display} onChange={(e) => setDraft({ ...draft, display: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                {DOMAIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Flow</label>
              <select value={draft.flow} onChange={(e) => setDraft({ ...draft, flow: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                {FLOW_TYPES.map((f) => <option key={f} value={f}>{FLOW_LABELS[f] ?? f}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input id="dom-enabled" type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="w-4 h-4 accent-[#00ED64]" />
              <label htmlFor="dom-enabled" className="text-sm text-gray-700">Enabled (shown in login selector)</label>
            </div>
            {/* Self-registration (local domains only) */}
            {draft.type === 'local' && (
              <div className="sm:col-span-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input id="dom-selfreg" type="checkbox" checked={draft.selfReg} onChange={(e) => setDraft({ ...draft, selfReg: e.target.checked })} className="w-4 h-4 accent-[#00ED64]" />
                  <label htmlFor="dom-selfreg" className="text-sm text-gray-700">Allow self-registration (shows a Register link on login)</label>
                </div>
                <div className={`flex items-center gap-2 pl-6 ${draft.selfReg ? '' : 'opacity-40 pointer-events-none'}`}>
                  <input id="dom-autoapprove" type="checkbox" checked={draft.autoApprove} disabled={!draft.selfReg} onChange={(e) => setDraft({ ...draft, autoApprove: e.target.checked })} className="w-4 h-4 accent-[#00ED64]" />
                  <label htmlFor="dom-autoapprove" className="text-sm text-gray-700">Auto-approve new accounts (skip manager approval; does not imply KYC)</label>
                </div>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Login banner (optional)</label>
              <input value={draft.alert} onChange={(e) => setDraft({ ...draft, alert: e.target.value })} placeholder="e.g. SSO not active in this build" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-gray-500">Slug</p><p className="font-mono">{name}</p></div>
            <div><p className="text-xs text-gray-500">Type</p><p className="capitalize">{type}</p></div>
            <div><p className="text-xs text-gray-500">Flow</p><p>{FLOW_LABELS[flow] ?? flow}</p></div>
            <div><p className="text-xs text-gray-500">Status</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{enabled ? 'enabled' : 'disabled'}</span>
            </div>
            {isLocal && (
              <div><p className="text-xs text-gray-500">Self-registration</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${domain.partyAuthenticationDomainSelfRegistrationEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                  {domain.partyAuthenticationDomainSelfRegistrationEnabled ? (domain.partyAuthenticationDomainSelfRegistrationAutoApprove ? 'on · auto-approve' : 'on · manual approval') : 'off'}
                </span>
              </div>
            )}
            {Boolean(domain.partyAuthenticationDomainAlertMessage) && (
              <div className="col-span-2 sm:col-span-4 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                <Info size={14} className="mt-0.5 shrink-0" /> {String(domain.partyAuthenticationDomainAlertMessage)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Access management; users (local) or role mappings (remote) */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <Shield size={15} className="text-[#001E2B]" />
          <h2 className="font-semibold text-sm text-gray-800">{isLocal ? 'Users & role assignment' : 'Role mapping (IdP claim → role)'}</h2>
        </div>
        <DomainAccessPanel
          domainId={id}
          domainName={name}
          domainType={type}
          initialMappings={(domain.partyAuthenticationDomainRoleMappings as { externalClaimOrGroup: string; roleName: string }[]) ?? []}
          token={token}
        />
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-xl border border-red-200 p-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-sm text-gray-800">Delete this domain</p>
          <p className="text-xs text-gray-500">Removes the domain from the login selector and its access configuration.</p>
        </div>
        <button onClick={remove} disabled={busy}
          className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 font-medium disabled:opacity-50">
          <Trash2 size={14} /> Delete domain
        </button>
      </div>
    </div>
  );
}

export default function DomainDetailPage() {
  return (
    <RequirePermission resource="authDomains" action="view">
      <DomainDetail />
    </RequirePermission>
  );
}

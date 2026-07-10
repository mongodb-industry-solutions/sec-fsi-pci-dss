'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { UserCog, Save, Trash2, Lock, Eye, EyeOff, Power, KeyRound } from 'lucide-react';
import { api, type ManagedUserDTO, type RoleRecordDTO } from '../../../../../../../../lib/api';
import { getToken } from '../../../../../../../../lib/auth';
import { SectionHeader } from '../../../../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../../../../components/Breadcrumb';
import { RequirePermission } from '../../../../../../../../components/RequirePermission';
import { useConfirm, useNotify } from '../../../../../../../../components/ui/ConfirmProvider';
import { PasswordFields, passwordFieldsValid } from '../../../../../../../../components/PasswordFields';

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface Draft { name: string; role: string; status: 'active' | 'suspended' | 'pending'; password: string; phone: string; }

// Mask a phone leaving only the last 2 digits visible (protected PII).
function maskPhone(phone: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return '—';
  return `${'•'.repeat(Math.max(3, digits.length - 2))}${digits.slice(-2)}`;
}

function UserDetail() {
  const { id: domainId, userId } = useParams<{ id: string; userId: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();

  const [token, setToken] = useState('');
  const [user, setUser] = useState<ManagedUserDTO | null>(null);
  const [roles, setRoles] = useState<RoleRecordDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmPw, setConfirmPw] = useState('');
  // Protected PII (QE-encrypted at rest): masked by default, revealed on demand.
  const [emailRevealed, setEmailRevealed] = useState(false);
  const [phoneRevealed, setPhoneRevealed] = useState(false);

  useEffect(() => { setToken(getToken() ?? ''); }, []);

  const load = useCallback(async () => {
    if (!token || !userId) return;
    setLoading(true);
    try {
      const u = await api.users.get(userId, token);
      setUser(u);
      setDraft({ name: u.name, role: u.role, status: u.status, password: '', phone: u.phone ?? '' });
    } catch (err) { notify((err as Error).message, 'error'); setUser(null); }
    finally { setLoading(false); }
  }, [token, userId, notify]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.roles.list(token).then((r) => setRoles(r.roles)).catch(() => setRoles([])); }, [token]);

  const backToDomain = () => router.push(`/system/admin/modules/domains/${domainId}`);

  if (loading) return <div className="w-full px-5 sm:px-8 lg:px-12 py-8 text-center text-sm text-gray-400">Loading account…</div>;
  if (!user || !draft) return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-8 text-sm text-gray-500">
      Account not found. <button onClick={backToDomain} className="text-blue-600 hover:underline">Back to domain</button>
    </div>
  );

  const roleOptions = roles.map((r) => r.roleName);
  const roleLabel = (name: string) => roles.find((r) => r.roleName === name)?.roleLabel ?? name;
  const maskedEmail = (() => {
    const [local, dom] = (user.email ?? '').split('@');
    if (!dom) return '•••';
    return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, local.length - 1))}@${dom}`;
  })();

  // Enable Save only when the form differs from the loaded account (a set password always counts).
  const dirty =
    draft.name.trim() !== user.name ||
    draft.role !== user.role ||
    draft.status !== user.status ||
    draft.phone.trim() !== (user.phone ?? '') ||
    draft.password.length > 0;

  async function save() {
    if (!draft || !user) return;
    if (!draft.name.trim()) { notify('Name is required.', 'error'); return; }
    if (!passwordFieldsValid(draft.password, confirmPw, true)) { notify('New password does not meet the policy or does not match its confirmation.', 'error'); return; }
    setBusy(true);
    try {
      await api.users.update(user.id, {
        name: draft.name.trim(),
        role: draft.role,
        status: draft.status,
        ...(draft.password ? { password: draft.password } : {}),
        ...(draft.phone.trim() && draft.phone.trim() !== (user.phone ?? '') ? { phone: draft.phone.trim() } : {}),
      }, token);
      notify('Account updated.', 'success');
      setDraft({ ...draft, password: '' });
      setConfirmPw('');
      load();
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  async function toggleStatus() {
    if (!draft || !user) return;
    const next = draft.status === 'active' ? 'suspended' : 'active';
    setDraft({ ...draft, status: next });
    setBusy(true);
    try { await api.users.update(user.id, { status: next }, token); notify(`Account ${next}.`, 'success'); load(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!user) return;
    const ok = await confirm({ title: `Delete account "${user.name}"?`, message: 'This removes the login account. This cannot be undone.', confirmLabel: 'Delete account', tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    try { await api.users.remove(user.id, token); notify('Account deleted.', 'success'); backToDomain(); }
    catch (err) { notify((err as Error).message, 'error'); setBusy(false); }
  }

  const isActive = draft.status === 'active';

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[
        { label: 'Home', href: '/system' },
        { label: 'Domains', href: '/system/admin/modules/domains' },
        { label: user.domain, href: `/system/admin/modules/domains/${domainId}` },
        { label: user.name },
      ]} />
      <SectionHeader
        icon={UserCog}
        title={user.name}
        description={`Local account · ${user.domain} · ${user.role}`}
        debugInfo={`BIAN SD-91 · ${user.id} · ${user.status}`}
        actions={
          <button onClick={toggleStatus} disabled={busy}
            className={`inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border font-medium transition-colors ${isActive ? 'border-gray-300 text-gray-600 hover:bg-gray-50' : 'border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64]'}`}>
            <Power size={14} /> {isActive ? 'Suspend' : 'Activate'}
          </button>
        }
      />

      {/* Editable account fields */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-sm text-gray-800">Account details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {/* Email — protected PII, masked with reveal toggle */}
          <div className="sm:col-span-2">
            <label className="flex items-center gap-1 text-xs text-gray-500 mb-1"><Lock size={11} className="text-gray-400" /> Email (login identifier · protected)</label>
            <div className="flex items-center gap-2">
              <input value={emailRevealed ? user.email : maskedEmail} disabled
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-500" />
              <button type="button" onClick={() => setEmailRevealed((v) => !v)}
                title={emailRevealed ? 'Hide email' : 'Reveal email (PII)'}
                className="p-2 rounded-lg border border-gray-300 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors">
                {emailRevealed ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">Immutable; QE-encrypted at rest and masked by default (PCI DSS Req 3.3 / data minimization).</p>
          </div>
          {/* Phone — protected PII (party SD-13); masked with reveal toggle, editable once revealed */}
          <div className="sm:col-span-2">
            <label className="flex items-center gap-1 text-xs text-gray-500 mb-1"><Lock size={11} className="text-gray-400" /> Mobile phone (protected)</label>
            <div className="flex items-center gap-2">
              <input
                value={phoneRevealed ? draft.phone : maskPhone(draft.phone)}
                readOnly={!phoneRevealed}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder={phoneRevealed ? '+44 7…' : ''}
                className={`flex-1 border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64] ${phoneRevealed ? 'border-gray-300' : 'border-gray-200 bg-gray-50 text-gray-500'}`} />
              <button type="button" onClick={() => setPhoneRevealed((v) => !v)}
                title={phoneRevealed ? 'Hide phone' : 'Reveal / edit phone (PII)'}
                className="p-2 rounded-lg border border-gray-300 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors">
                {phoneRevealed ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">QE-encrypted, unique across parties. Reveal to edit. Used for beneficiary lookup.</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Display name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]">
              {(roleOptions.includes(draft.role) ? roleOptions : [draft.role, ...roleOptions]).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft['status'] })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]">
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="pending">pending</option>
            </select>
          </div>
          <div className="sm:col-span-2 border-t border-gray-100 pt-4">
            <div className="flex items-center gap-1.5 mb-1">
              <KeyRound size={13} className="text-gray-500" />
              <h3 className="text-xs font-semibold text-gray-700">Set a new password</h3>
            </div>
            <p className="text-[11px] text-gray-400 mb-2">As an administrator you can set a new password directly, without knowing the current one. Leave blank to keep it unchanged.</p>
            <PasswordFields
              optional label="New password" idPrefix="reset"
              password={draft.password} confirm={confirmPw}
              onPasswordChange={(v) => setDraft({ ...draft, password: v })}
              onConfirmChange={setConfirmPw}
            />
          </div>
        </div>

        {/* Read-only metadata */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm border-t border-gray-100 pt-4">
          <div><p className="text-xs text-gray-500">Domain</p><p className="capitalize">{user.domain}</p></div>
          <div><p className="text-xs text-gray-500">User ID</p><p className="font-mono text-xs truncate" title={user.id}>{user.id}</p></div>
          <div><p className="text-xs text-gray-500">Last login</p><p>{fmtDate(user.lastLoginAt)}</p></div>
          <div><p className="text-xs text-gray-500">Created</p><p>{fmtDate(user.createdAt)}</p></div>
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={busy || !dirty || !passwordFieldsValid(draft.password, confirmPw, true)}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] font-medium disabled:opacity-40 disabled:cursor-not-allowed">
            <Save size={14} /> {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-xl border border-red-200 p-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-sm text-gray-800">Delete this account</p>
          <p className="text-xs text-gray-500">Removes the login account from this domain.</p>
        </div>
        <button onClick={remove} disabled={busy}
          className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 font-medium disabled:opacity-50">
          <Trash2 size={14} /> Delete account
        </button>
      </div>
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <RequirePermission resource="authDomains" action="view">
      <UserDetail />
    </RequirePermission>
  );
}

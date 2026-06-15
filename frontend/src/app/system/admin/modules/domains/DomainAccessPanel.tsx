'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Users, GitBranch } from 'lucide-react';
import { api, type ManagedUserDTO, type RoleRecordDTO } from '../../../../../lib/api';
import { useConfirm, useNotify } from '../../../../../components/ui/ConfirmProvider';

type RoleMapping = { externalClaimOrGroup: string; roleName: string };

// ADR-030 / §13.5: per-domain access management. Local domains → user CRUD + role assignment.
// Remote (OIDC/SAML) domains → claim/group → role mapping only (no user CRUD; users come from the IdP).
export function DomainAccessPanel({
  domainId, domainName, domainType, initialMappings, token,
}: {
  domainId: string;
  domainName: string;
  domainType: string;
  initialMappings?: RoleMapping[];
  token: string;
}) {
  const confirm = useConfirm();
  const notify = useNotify();
  const isLocal = domainType === 'local';

  const [roles, setRoles] = useState<RoleRecordDTO[]>([]);
  useEffect(() => { api.roles.list(token).then((r) => setRoles(r.roles)).catch(() => setRoles([])); }, [token]);
  const roleOptions = roles.map((r) => r.roleName);

  // ── Local: users ──
  const [users, setUsers] = useState<ManagedUserDTO[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(isLocal);
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'level1_analyst', password: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!isLocal) return;
    setLoadingUsers(true);
    try { setUsers((await api.users.list(token, { domain: domainName })).users); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setLoadingUsers(false); }
  }, [isLocal, token, domainName, notify]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function addUser() {
    if (!newUser.email.trim() || !newUser.name.trim()) { notify('Email and name are required.', 'error'); return; }
    setBusy('new');
    try {
      await api.users.create({ ...newUser, domain: domainName, password: newUser.password || undefined }, token);
      setNewUser({ email: '', name: '', role: 'level1_analyst', password: '' });
      notify('User created.', 'success'); loadUsers();
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }
  async function changeRole(u: ManagedUserDTO, role: string) {
    setBusy(u.id);
    try { await api.users.update(u.id, { role }, token); loadUsers(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }
  async function toggleStatus(u: ManagedUserDTO) {
    const status = u.status === 'active' ? 'suspended' : 'active';
    setBusy(u.id);
    try { await api.users.update(u.id, { status }, token); loadUsers(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }
  async function removeUser(u: ManagedUserDTO) {
    const ok = await confirm({ title: `Delete user "${u.name}"?`, message: 'This removes the login account.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    setBusy(u.id);
    try { await api.users.remove(u.id, token); notify('User deleted.', 'success'); loadUsers(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }

  // ── Remote: role mappings ──
  const [mappings, setMappings] = useState<RoleMapping[]>(initialMappings ?? []);
  const [savingMap, setSavingMap] = useState(false);
  function addMapping() { setMappings((m) => [...m, { externalClaimOrGroup: '', roleName: roleOptions[0] ?? 'level1_analyst' }]); }
  function updateMapping(i: number, patch: Partial<RoleMapping>) { setMappings((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x))); }
  function removeMapping(i: number) { setMappings((m) => m.filter((_, j) => j !== i)); }
  async function saveMappings() {
    setSavingMap(true);
    try {
      await api.modules.domains.update(domainId, { partyAuthenticationDomainRoleMappings: mappings.filter((m) => m.externalClaimOrGroup.trim()) }, token);
      notify('Role mappings saved.', 'success');
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setSavingMap(false); }
  }

  if (isLocal) {
    return (
      <div className="bg-gray-50 border-t border-gray-100 px-5 py-4 space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600"><Users size={13} /> Users in this domain</div>
        {loadingUsers ? (
          <p className="text-xs text-gray-400">Loading users…</p>
        ) : (
          <div className="space-y-1.5">
            {users.length === 0 && <p className="text-xs text-gray-400">No users yet.</p>}
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-2 flex-wrap bg-white border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-800">{u.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{u.email}</span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <select value={u.role} disabled={busy === u.id} onChange={(e) => changeRole(u, e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                    {(roleOptions.includes(u.role) ? roleOptions : [u.role, ...roleOptions]).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button onClick={() => toggleStatus(u)} disabled={busy === u.id}
                    className={`text-xs px-2 py-1 rounded-lg border ${u.status === 'active' ? 'border-green-200 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                    {u.status}
                  </button>
                  <button onClick={() => removeUser(u)} disabled={busy === u.id}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Add user */}
        <div className="flex flex-wrap gap-2 items-end pt-1">
          <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="email"
            className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          <input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="name"
            className="flex-1 min-w-[120px] border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
            {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="password (optional)" type="password"
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          <button onClick={addUser} disabled={busy === 'new'}
            className="inline-flex items-center gap-1.5 bg-[#001E2B] text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-50">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>
    );
  }

  // Remote domain → role mapping
  return (
    <div className="bg-gray-50 border-t border-gray-100 px-5 py-4 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
        <GitBranch size={13} /> IdP claim / group → role mapping
      </div>
      <p className="text-xs text-gray-400">Users are provisioned by the identity provider. Map an external claim or group to a local role; everything else is denied by default.</p>
      <div className="space-y-1.5">
        {mappings.length === 0 && <p className="text-xs text-gray-400">No mappings yet.</p>}
        {mappings.map((m, i) => (
          <div key={i} className="flex items-center gap-2 bg-white border rounded-lg px-3 py-2">
            <input value={m.externalClaimOrGroup} onChange={(e) => updateMapping(i, { externalClaimOrGroup: e.target.value })}
              placeholder="IdP claim or group (e.g. group:FraudOps)" className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
            <span className="text-gray-400 text-sm">→</span>
            <select value={m.roleName} onChange={(e) => updateMapping(i, { roleName: e.target.value })}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
              {(roleOptions.includes(m.roleName) ? roleOptions : [m.roleName, ...roleOptions]).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button onClick={() => removeMapping(i)} className="text-red-600 hover:bg-red-50 rounded-lg p-1.5"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={addMapping} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-white">
          <Plus size={14} /> Add mapping
        </button>
        <button onClick={saveMappings} disabled={savingMap}
          className="inline-flex items-center gap-1.5 bg-[#001E2B] text-white text-sm px-3 py-1.5 rounded-lg disabled:opacity-50">
          {savingMap ? 'Saving…' : 'Save mappings'}
        </button>
      </div>
    </div>
  );
}

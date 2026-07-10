'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Users, GitBranch, Search, Pencil, Check, X, ChevronRight } from 'lucide-react';
import { api, type ManagedUserDTO, type RoleRecordDTO } from '../../../../../lib/api';
import { useConfirm, useNotify } from '../../../../../components/ui/ConfirmProvider';
import { Pagination } from '../../../../../components/Pagination';
import { PasswordFields, passwordFieldsValid } from '../../../../../components/PasswordFields';

type RoleMapping = { externalClaimOrGroup: string; roleName: string };

const USERS_PAGE_SIZE = 8;

// PII minimization (PCI DSS Req 7 / data minimization): the admin browse-list identifies accounts
// by name + role; the full QE-encrypted email is not needed here, so it is masked in the list.
function maskEmail(email: string): string {
  const [local, domain] = (email ?? '').split('@');
  if (!domain) return '•••';
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}

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
  const router = useRouter();
  const isLocal = domainType === 'local';

  const [roles, setRoles] = useState<RoleRecordDTO[]>([]);
  useEffect(() => { api.roles.list(token).then((r) => setRoles(r.roles)).catch(() => setRoles([])); }, [token]);
  const roleOptions = roles.map((r) => r.roleName);
  // Show the human-friendly label in selects while keeping the roleName as the value.
  const roleLabel = (name: string) => roles.find((r) => r.roleName === name)?.roleLabel ?? name;

  // ── Local: users ──
  const [users, setUsers] = useState<ManagedUserDTO[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(isLocal);
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'level1_analyst', password: '', phone: '' });
  const [newConfirm, setNewConfirm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // Inline quick-edit of an existing account's name only (email is immutable; password changes go
  // through the account detail page, which enforces the repeat + policy checklist).
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string }>({ name: '' });
  // Standard list controls (search + role filter + pagination)
  const [userQuery, setUserQuery] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('');
  const [userPage, setUserPage] = useState(1);

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
    if (!passwordFieldsValid(newUser.password, newConfirm, true)) { notify('Password does not meet the policy or does not match its confirmation.', 'error'); return; }
    setBusy('new');
    try {
      await api.users.create({ ...newUser, domain: domainName, password: newUser.password || undefined, phone: newUser.phone.trim() || undefined }, token);
      setNewUser({ email: '', name: '', role: 'level1_analyst', password: '', phone: '' });
      setNewConfirm('');
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
  // Approve/reject a self-registered pending account. Reject marks it suspended (kept for audit),
  // never touching KYC (a separate process).
  async function setStatus(u: ManagedUserDTO, status: 'active' | 'suspended', label: string) {
    setBusy(u.id);
    try { await api.users.update(u.id, { status }, token); notify(label, 'success'); loadUsers(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }
  function startEditUser(u: ManagedUserDTO) {
    setEditId(u.id);
    setEditDraft({ name: u.name });
  }
  async function saveUser(u: ManagedUserDTO) {
    if (!editDraft.name.trim()) { notify('Name is required.', 'error'); return; }
    setBusy(u.id);
    try {
      await api.users.update(u.id, { name: editDraft.name.trim() }, token);
      setEditId(null);
      notify('User updated.', 'success'); loadUsers();
    } catch (err) { notify((err as Error).message, 'error'); }
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

  // Standard filter + search + pagination over the loaded users (PII-minimized list).
  const filteredUsers = users.filter((u) => {
    if (userRoleFilter && u.role !== userRoleFilter) return false;
    if (userStatusFilter && u.status !== userStatusFilter) return false;
    const q = userQuery.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
  });
  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
  const userSafePage = Math.min(userPage, userTotalPages);
  const pagedUsers = filteredUsers.slice((userSafePage - 1) * USERS_PAGE_SIZE, userSafePage * USERS_PAGE_SIZE);

  if (isLocal) {
    return (
      <div className="bg-gray-50 border-t border-gray-100 px-5 py-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600"><Users size={13} /> Users in this domain</div>
          <span className="text-[10px] text-gray-400">Identity records (SD-91) · email masked · no cardholder data</span>
        </div>

        {/* Search + role filter; standard pattern */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={userQuery} onChange={(e) => { setUserQuery(e.target.value); setUserPage(1); }}
              placeholder="Search by name, email or role…" className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm bg-white" />
          </div>
          <select value={userRoleFilter} onChange={(e) => { setUserRoleFilter(e.target.value); setUserPage(1); }}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
            <option value="">All roles</option>
            {roleOptions.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
          <select value={userStatusFilter} onChange={(e) => { setUserStatusFilter(e.target.value); setUserPage(1); }}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        {loadingUsers ? (
          <p className="text-xs text-gray-400">Loading users…</p>
        ) : (
          <div className="space-y-1.5">
            {filteredUsers.length === 0 && <p className="text-xs text-gray-400">{users.length === 0 ? 'No users yet.' : 'No users match the filters.'}</p>}
            {pagedUsers.map((u) => (
              <div key={u.id}
                onClick={editId === u.id ? undefined : () => router.push(`/system/admin/modules/domains/${domainId}/users/${u.id}`)}
                onKeyDown={editId === u.id ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/system/admin/modules/domains/${domainId}/users/${u.id}`); } }}
                role={editId === u.id ? undefined : 'button'}
                tabIndex={editId === u.id ? undefined : 0}
                title={editId === u.id ? undefined : 'Open account details'}
                className={`flex items-center gap-2 flex-wrap bg-white border rounded-lg px-3 py-2 ${editId === u.id ? '' : 'cursor-pointer hover:border-gray-300 hover:bg-gray-50/60 transition-colors focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40'}`}>
                {editId === u.id ? (
                  <>
                    <input value={editDraft.name} onChange={(e) => setEditDraft({ name: e.target.value })} placeholder="name"
                      className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]" />
                    <div className="flex items-center gap-2 ml-auto">
                      <button onClick={() => saveUser(u)} disabled={busy === u.id}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-[#001E2B] text-[#00ED64] font-medium disabled:opacity-50"><Check size={12} /> Save</button>
                      <button onClick={() => setEditId(null)} disabled={busy === u.id}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border text-gray-500 hover:bg-gray-50"><X size={12} /> Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-gray-800">{u.name}</span>
                      <span className="text-xs text-gray-400 ml-2 font-mono" title="Email masked (PII minimization)">{maskEmail(u.email)}</span>
                    </div>
                    {/* Inline quick controls; stop propagation so they don't trigger the row navigation. */}
                    <div className="flex items-center gap-2 ml-auto" onClick={(e) => e.stopPropagation()}>
                      <select value={u.role} disabled={busy === u.id} onChange={(e) => changeRole(u, e.target.value)}
                        className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                        {(roleOptions.includes(u.role) ? roleOptions : [u.role, ...roleOptions]).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                      {u.status === 'pending' ? (
                        <>
                          <span className="text-xs px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700">pending</span>
                          <button onClick={() => setStatus(u, 'active', 'Account approved.')} disabled={busy === u.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-40" title="Approve account">
                            <Check size={11} /> Approve
                          </button>
                          <button onClick={() => setStatus(u, 'suspended', 'Account rejected (suspended).')} disabled={busy === u.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-40" title="Reject account (suspend)">
                            <X size={11} /> Reject
                          </button>
                        </>
                      ) : (
                        <button onClick={() => toggleStatus(u)} disabled={busy === u.id}
                          className={`text-xs px-2 py-1 rounded-lg border ${u.status === 'active' ? 'border-green-200 text-green-700' : 'border-gray-300 text-gray-500'}`}>
                          {u.status}
                        </button>
                      )}
                      <button onClick={() => startEditUser(u)} disabled={busy === u.id}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40" title="Quick edit name (password change on the detail page)">
                        <Pencil size={11} />
                      </button>
                      <button onClick={() => removeUser(u)} disabled={busy === u.id}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 shrink-0" />
                  </>
                )}
              </div>
            ))}
            {filteredUsers.length > 0 && (
              <Pagination page={userSafePage} totalPages={userTotalPages} total={filteredUsers.length} limit={USERS_PAGE_SIZE} onPageChange={setUserPage} noun="users" />
            )}
          </div>
        )}
        {/* Add user */}
        <div className="pt-1 space-y-2 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-600 pt-2">Add a user</p>
          <div className="flex flex-wrap gap-2 items-end">
            <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="email"
              className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
            <input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="name"
              className="flex-1 min-w-[120px] border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
              {roleOptions.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            <input value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} placeholder="phone (optional)"
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          </div>
          <div className="max-w-xl">
            <PasswordFields
              optional label="Password" idPrefix="newuser"
              password={newUser.password} confirm={newConfirm}
              onPasswordChange={(v) => setNewUser({ ...newUser, password: v })}
              onConfirmChange={setNewConfirm}
            />
            <p className="text-[10px] text-gray-400 mt-1">Leave blank to use the default demo password.</p>
          </div>
          <button onClick={addUser} disabled={busy === 'new' || !passwordFieldsValid(newUser.password, newConfirm, true)}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[#001E2B]">
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
              {(roleOptions.includes(m.roleName) ? roleOptions : [m.roleName, ...roleOptions]).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
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

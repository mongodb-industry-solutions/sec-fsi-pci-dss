'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Plus, Trash2, Pencil, ShieldCheck, Search } from 'lucide-react';
import { api, type RoleRecordDTO } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { SectionHeader } from '../../../../components/SectionHeader';
import { Pagination } from '../../../../components/Pagination';
import { RequirePermission } from '../../../../components/RequirePermission';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';
import { RESOURCES, ACTIONS, RESOURCE_LABELS, ACTION_LABELS, RESOURCE_BIAN, type AclPermissionMap } from '../../../../config/acl';

const PAGE_SIZE = 8;

interface DraftRole {
  roleName: string;
  roleLabel: string;
  roleDescription: string;
  roleScope: 'own' | 'all';
  rolePermissions: AclPermissionMap;
  roleIsBuiltin: boolean;
  isNew: boolean;
}

function emptyDraft(): DraftRole {
  return { roleName: '', roleLabel: '', roleDescription: '', roleScope: 'all', rolePermissions: {}, roleIsBuiltin: false, isNew: true };
}

function RolesAdmin() {
  const confirm = useConfirm();
  const notify = useNotify();
  const [token, setToken] = useState('');
  const [roles, setRoles] = useState<RoleRecordDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<DraftRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { setToken(getToken() ?? ''); }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await api.roles.list(token);
      setRoles(r.roles);
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [token, notify]);

  useEffect(() => { if (token) load(); }, [token, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => r.roleName.toLowerCase().includes(q) || r.roleLabel.toLowerCase().includes(q));
  }, [roles, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function startEdit(r: RoleRecordDTO) {
    setDraft({
      roleName: r.roleName,
      roleLabel: r.roleLabel,
      roleDescription: r.roleDescription ?? '',
      roleScope: r.roleScope,
      rolePermissions: JSON.parse(JSON.stringify(r.rolePermissions ?? {})),
      roleIsBuiltin: r.roleIsBuiltin,
      isNew: false,
    });
  }

  function toggle(resource: string, action: string) {
    setDraft((d) => {
      if (!d) return d;
      const cur = new Set(d.rolePermissions[resource] ?? []);
      if (cur.has(action)) cur.delete(action); else cur.add(action);
      const next = { ...d.rolePermissions };
      if (cur.size) next[resource] = ACTIONS.filter((a) => cur.has(a)); else delete next[resource];
      return { ...d, rolePermissions: next };
    });
  }

  async function save() {
    if (!draft) return;
    if (draft.isNew && !/^[a-z0-9][a-z0-9_-]*$/.test(draft.roleName.trim())) {
      notify('Role name must be lowercase letters, digits, hyphen or underscore.', 'error'); return;
    }
    if (!draft.roleLabel.trim()) { notify('A display label is required.', 'error'); return; }
    setSaving(true);
    try {
      if (draft.isNew) {
        await api.roles.create({
          roleName: draft.roleName.trim(), roleLabel: draft.roleLabel.trim(),
          roleDescription: draft.roleDescription || undefined, roleScope: draft.roleScope,
          rolePermissions: draft.rolePermissions,
        }, token);
        notify(`Role '${draft.roleName.trim()}' created.`, 'success');
      } else {
        await api.roles.update(draft.roleName, {
          roleLabel: draft.roleLabel.trim(), roleDescription: draft.roleDescription,
          roleScope: draft.roleScope, rolePermissions: draft.rolePermissions,
        }, token);
        notify(`Role '${draft.roleName}' updated.`, 'success');
      }
      setDraft(null);
      load();
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setSaving(false); }
  }

  async function remove(r: RoleRecordDTO) {
    const ok = await confirm({
      title: `Delete role "${r.roleLabel}"?`,
      message: 'Users currently mapped to this role will lose its permissions. This cannot be undone.',
      confirmLabel: 'Delete role', tone: 'danger',
    });
    if (!ok) return;
    setBusy(r.roleName);
    try { await api.roles.remove(r.roleName, token); notify('Role deleted.', 'success'); load(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Lock}
        title="Roles & Access"
        description="Define what each role can do. Permissions are data, not code (default-deny)."
        info="Builtin roles can have their permissions edited but cannot be deleted. Custom roles support any subset of the catalog, including full management. Roles are global across authentication domains."
        debugInfo="ADR-030 Party Authentication · PCI DSS (RBAC, least privilege, documented matrix)"
        actions={
          <button onClick={() => setDraft(emptyDraft())}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium">
            <Plus size={14} /> New role
          </button>
        }
      />

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search roles by name or label…" className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm" />
        </div>
      </div>

      {/* Editor */}
      {draft && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 text-sm">
              {draft.isNew ? 'New custom role' : `Edit role: ${draft.roleLabel}`}
              {draft.roleIsBuiltin && <span className="ml-2 text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">Builtin</span>}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name (identifier)</label>
              <input value={draft.roleName} disabled={!draft.isNew}
                onChange={(e) => setDraft({ ...draft, roleName: e.target.value })}
                placeholder="e.g. compliance-reviewer"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Display label</label>
              <input value={draft.roleLabel} onChange={(e) => setDraft({ ...draft, roleLabel: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Data scope</label>
              <select value={draft.roleScope} onChange={(e) => setDraft({ ...draft, roleScope: e.target.value as 'own' | 'all' })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="all">All records</option>
                <option value="own">Own records only</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description</label>
            <input value={draft.roleDescription} onChange={(e) => setDraft({ ...draft, roleDescription: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* Permission matrix */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2 pr-3 font-medium">Resource</th>
                  {ACTIONS.map((a) => <th key={a} className="py-2 px-2 font-medium text-center whitespace-nowrap">{ACTION_LABELS[a]}</th>)}
                </tr>
              </thead>
              <tbody>
                {RESOURCES.map((res) => (
                  <tr key={res} className="border-b border-gray-50">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-gray-800">{RESOURCE_LABELS[res]}</span>
                      <span className="block text-[10px] font-mono text-gray-400">{RESOURCE_BIAN[res]}</span>
                    </td>
                    {ACTIONS.map((a) => (
                      <td key={a} className="py-2 px-2 text-center">
                        <input type="checkbox"
                          checked={draft.rolePermissions[res]?.includes(a) ?? false}
                          onChange={() => toggle(res, a)}
                          className="w-4 h-4 accent-[#00ED64] cursor-pointer" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm">
              <ShieldCheck size={15} />{saving ? 'Saving…' : draft.isNew ? 'Create role' : 'Save changes'}
            </button>
            <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-lg border text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm">Loading roles…</div>
      ) : paginated.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">No roles match your search.</div>
      ) : (
        <div className="space-y-3">
          {paginated.map((r) => {
            const permCount = Object.values(r.rolePermissions ?? {}).reduce((n, a) => n + a.length, 0);
            return (
              <div key={r.roleName} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800 text-sm">{r.roleLabel}</span>
                    <span className="text-xs font-mono text-gray-400">{r.roleName}</span>
                    {r.roleIsBuiltin
                      ? <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">Builtin</span>
                      : <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-2 py-0.5 font-medium">Custom</span>}
                    <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">scope: {r.roleScope}</span>
                  </div>
                  {r.roleDescription && <p className="text-xs text-gray-500 mt-1">{r.roleDescription}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(r.rolePermissions ?? {}).map(([res, acts]) => (
                      <span key={res} className="text-[11px] px-1.5 py-0.5 rounded bg-[#00ED64]/10 text-[#007a4d] border border-[#00ED64]/30">
                        {RESOURCE_LABELS[res] ?? res}: {(acts as string[]).join(', ')}
                      </span>
                    ))}
                    {permCount === 0 && <span className="text-[11px] text-gray-400">no permissions</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => startEdit(r)}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                    <Pencil size={12} /> Edit
                  </button>
                  <button onClick={() => remove(r)} disabled={r.roleIsBuiltin || busy === r.roleName}
                    title={r.roleIsBuiltin ? 'Builtin roles cannot be deleted' : 'Delete role'}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
          <Pagination page={safePage} totalPages={totalPages} total={filtered.length} limit={PAGE_SIZE} onPageChange={setPage} noun="roles" />
        </div>
      )}
    </div>
  );
}

export default function RolesPage() {
  return (
    <RequirePermission resource="roles" action="view">
      <RolesAdmin />
    </RequirePermission>
  );
}

'use client';
// v31 (SD-89 + SD-13): beneficial-owner / shareholder panel. Reused by the KYB administration detail
// and the merchant detail Owners tab. Read-only unless `canManage` (merchants:manage). Enforces the
// invariants client-side (sum ≤ 100 meter, one-primary) mirroring the server (which is authoritative).
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Users, Star, Plus, Trash2, Save, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { api } from '../../lib/api';
import { useNotify } from '../ui/ConfirmProvider';

interface Owner {
  merchantBeneficialOwnerPartyReference: string;
  merchantBeneficialOwnerRole: string;
  merchantBeneficialOwnerOwnershipPercentage: number;
  merchantBeneficialOwnerIsPrimary: boolean;
  merchantBeneficialOwnerIsControllingPerson: boolean;
  party?: { partyName?: string | null; partyType?: string | null } | null;
}

const ROLES = ['ultimate_beneficial_owner', 'director', 'shareholder', 'authorized_signatory'];
const ROLE_LABEL: Record<string, string> = {
  ultimate_beneficial_owner: 'UBO', director: 'Director', shareholder: 'Shareholder', authorized_signatory: 'Signatory',
};

export function OwnersPanel({ merchantId, token, canManage }: { merchantId: string; token: string; canManage: boolean }) {
  const notify = useNotify();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newOwner, setNewOwner] = useState({ partyRef : '', role: 'shareholder', pct: 0, primary: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.merchants.kybOwners(merchantId, token);
      setOwners((r.owners ?? []) as unknown as Owner[]);
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not load owners', 'error'); }
    finally { setLoading(false); }
  }, [merchantId, token, notify]);

  useEffect(() => { void load(); }, [load]);

  const sum = owners.reduce((s, o) => s + (o.merchantBeneficialOwnerOwnershipPercentage || 0), 0);
  const sumOver = sum > 100.001;

  const setPrimary = async (partyRef: string) => {
    try { await api.merchants.kybOwnerUpdate(merchantId, partyRef, { merchantBeneficialOwnerIsPrimary: true }, token); notify('Primary owner reassigned', 'success'); await load(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not set primary', 'error'); }
  };
  const updatePct = async (partyRef: string, pct: number) => {
    try { await api.merchants.kybOwnerUpdate(merchantId, partyRef, { merchantBeneficialOwnerOwnershipPercentage: pct }, token); notify('Ownership updated', 'success'); await load(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not update', 'error'); }
  };
  const remove = async (partyRef: string) => {
    try { await api.merchants.kybOwnerRemove(merchantId, partyRef, token); notify('Owner removed', 'success'); await load(); }
    catch (e) { notify(e instanceof Error ? e.message : 'Could not remove owner', 'error'); }
  };
  const add = async () => {
    try {
      await api.merchants.kybOwnerAdd(merchantId, {
        merchantBeneficialOwnerPartyReference: newOwner.partyRef.trim(),
        merchantBeneficialOwnerRole: newOwner.role,
        merchantBeneficialOwnerOwnershipPercentage: Number(newOwner.pct),
        merchantBeneficialOwnerIsPrimary: newOwner.primary,
      }, token);
      notify('Owner added', 'success');
      setAdding(false); setNewOwner({ partyRef : '', role: 'shareholder', pct: 0, primary: false });
      await load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not add owner', 'error'); }
  };

  if (loading) return <div className="text-sm text-gray-500">Loading owners…</div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5"><Users size={15} /> Beneficial owners / shareholders
          <Tooltip text="FATF / 4th AMLD. 1..N owners with exactly one primary/controlling owner (UBO). Ownership % is business metadata; owner PII (name, DOB, address) lives on the party record, not here (GDPR minimization)." />
        </h3>
        {canManage && !adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"><Plus size={13} /> Add owner</button>
        )}
      </div>

      {/* Ownership sum meter */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>Total ownership participation</span>
          <span className={sumOver ? 'text-red-600 font-semibold' : sum < 99.999 ? 'text-amber-600' : 'text-emerald-600'}>{sum.toFixed(2)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full ${sumOver ? 'bg-red-500' : sum < 99.999 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, sum)}%` }} />
        </div>
        {sum < 99.999 && !sumOver && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> Residual free-float / minority holders below the reporting threshold ({(100 - sum).toFixed(2)}%).</p>}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="py-2 pr-3">Owner</th>
              <th className="py-2 pr-3 hidden sm:table-cell">Role</th>
              <th className="py-2 pr-3">Ownership %</th>
              <th className="py-2 pr-3 hidden sm:table-cell">Flags</th>
              {canManage && <th className="py-2 pr-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {owners.map((o) => (
              <tr key={o.merchantBeneficialOwnerPartyReference} className="border-b border-gray-50">
                <td className="py-2 pr-3">
                  {/* Staff (merchants:manage) get a link to the owner's KYC detail, closes the KYB→KYC
                      analysis loop (owner layer). A merchant-owner viewing the shell sees plain text. */}
                  {canManage ? (
                    <Link href={`/system/admin/modules/kyc/${o.merchantBeneficialOwnerPartyReference}`} title="Open this owner's KYC record" className="font-medium text-[#016BF8] hover:underline inline-flex items-center gap-1">
                      {o.party?.partyName ?? o.merchantBeneficialOwnerPartyReference.slice(0, 8)}<ArrowUpRight size={12} className="text-gray-400" />
                    </Link>
                  ) : (
                    <span className="font-medium text-gray-900">{o.party?.partyName ?? o.merchantBeneficialOwnerPartyReference.slice(0, 8)}</span>
                  )}
                  <div className="font-mono text-[11px] text-gray-400">{o.merchantBeneficialOwnerPartyReference.slice(0, 13)}</div>
                </td>
                <td className="py-2 pr-3 hidden sm:table-cell">{ROLE_LABEL[o.merchantBeneficialOwnerRole] ?? o.merchantBeneficialOwnerRole}</td>
                <td className="py-2 pr-3">
                  {canManage ? (
                    <input type="number" min={0} max={100} step={0.01} defaultValue={o.merchantBeneficialOwnerOwnershipPercentage}
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== o.merchantBeneficialOwnerOwnershipPercentage) void updatePct(o.merchantBeneficialOwnerPartyReference, v); }}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm" />
                  ) : <span>{o.merchantBeneficialOwnerOwnershipPercentage}%</span>}
                </td>
                <td className="py-2 pr-3 hidden sm:table-cell">
                  <div className="flex items-center gap-1.5">
                    {o.merchantBeneficialOwnerIsPrimary && <span className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"><Star size={10} /> Primary</span>}
                    {o.merchantBeneficialOwnerIsControllingPerson && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Controlling</span>}
                  </div>
                </td>
                {canManage && (
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      {!o.merchantBeneficialOwnerIsPrimary && <button onClick={() => void setPrimary(o.merchantBeneficialOwnerPartyReference)} title="Make primary" className="text-gray-400 hover:text-amber-600"><Star size={14} /></button>}
                      {!o.merchantBeneficialOwnerIsPrimary && owners.length > 1 && <button onClick={() => void remove(o.merchantBeneficialOwnerPartyReference)} title="Remove" className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input placeholder="Party reference" value={newOwner.partyRef} onChange={(e) => setNewOwner({ ...newOwner, partyRef: e.target.value })} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm sm:col-span-2 font-mono" />
            <select value={newOwner.role} onChange={(e) => setNewOwner({ ...newOwner, role: e.target.value })} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <input type="number" min={0} max={100} step={0.01} placeholder="%" value={newOwner.pct} onChange={(e) => setNewOwner({ ...newOwner, pct: Number(e.target.value) })} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={newOwner.primary} onChange={(e) => setNewOwner({ ...newOwner, primary: e.target.checked })} /> Set as primary/controlling owner</label>
          <div className="flex items-center gap-2">
            <button onClick={() => void add()} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium"><Save size={13} /> Save</button>
            <button onClick={() => setAdding(false)} className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
          </div>
          <p className="text-[11px] text-gray-500">References an existing seeded party. PII (name, DOB, address) is edited on the party record. Sum must stay ≤ 100%.</p>
        </div>
      )}
    </div>
  );
}

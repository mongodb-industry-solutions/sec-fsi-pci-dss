'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type ConsentGrant, type CustomerTransactionRow } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Breadcrumb, type Crumb } from '../../../../components/Breadcrumb';
import { useResource } from '../../../../lib/useResource';
import { readEscalationToken } from '../../../../lib/escalation';
import { useDebugMode } from '../../../../lib/debugMode';
import { LoadingIndicator } from '../../../../components/LoadingIndicator';
import { Pagination } from '../../../../components/Pagination';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';
import { UserCheck, ShieldCheck, Lock, ArrowUpRight, ArrowDownLeft, Layers, Landmark, CreditCard, Trash2, Pause } from 'lucide-react';

const SEGMENT_LABELS: Record<string, string> = { retail: 'Retail', premium: 'Premium', corporate: 'Corporate', sme: 'SME' };

function money(amount?: number, currency?: string): string {
  if (amount == null) return '-';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency ?? ''}`.trim(); }
}

function statusPill(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'completed', 'settled', 'authorized', 'approved'].includes(s)) return 'bg-green-100 text-green-700';
  if (['pending', 'pending_activation', 'processing'].includes(s)) return 'bg-amber-100 text-amber-700';
  if (['failed', 'declined', 'blocked', 'expired', 'revoked'].includes(s)) return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-500';
}

// --- Staff-only sections (VIEW: L2 + auditor · ACTIONS: level2_investigator only) ------------

// Transactions (SD-65 + SD-254), display-safe + paginated. Read-only for both staff roles.
function StaffTransactionsSection({ customerId, token }: { customerId: string; token: string }) {
  const [rows, setRows] = useState<CustomerTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.customer.transactions(customerId, { page, limit }, token)
      .then((r) => { if (alive) { setRows(r.results); setTotal(r.total); } })
      .catch(() => { if (alive) { setRows([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customerId, token, page, limit]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="bg-white rounded-xl border p-5">
      <h2 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><ArrowUpRight size={14} className="text-[#00684A]" /> Transactions</h2>
      {loading ? <LoadingIndicator label="Loading transactions…" /> : rows.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4">No transactions for this customer.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2 pr-3 font-medium">Direction</th>
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Rail</th>
                  <th className="py-2 pr-3 font-medium">Concept</th>
                  <th className="py-2 pr-3 font-medium">Beneficiary</th>
                  <th className="py-2 pr-3 font-medium">Destination</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const when = r.completedAt ?? r.initiatedAt;
                  return (
                    <tr key={r.paymentExecutionInstanceReference} className="border-b border-gray-50">
                      <td className="py-2 pr-3">
                        <span className={`inline-flex items-center gap-1 text-xs ${r.direction === 'received' ? 'text-green-700' : 'text-gray-600'}`}>
                          {r.direction === 'received' ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}{r.direction}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-medium text-gray-900 whitespace-nowrap">{money(r.grossAmount, r.currency)}</td>
                      <td className="py-2 pr-3 text-gray-600">{r.paymentExecutionRail ?? '-'}</td>
                      <td className="py-2 pr-3 text-gray-600 max-w-[16ch] truncate">{r.concept ?? '-'}</td>
                      <td className="py-2 pr-3 text-gray-600 max-w-[16ch] truncate">{r.beneficiaryName ?? '-'}</td>
                      <td className="py-2 pr-3 text-gray-500 font-mono text-xs">{r.destinationAccountMasked ?? '-'}</td>
                      <td className="py-2 pr-3"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusPill(r.paymentExecutionStatus)}`}>{r.paymentExecutionStatus}</span></td>
                      <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{when ? new Date(when).toLocaleDateString() : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pt-2">
            <Pagination page={page} totalPages={totalPages} total={total} limit={limit}
              onPageChange={setPage} onLimitChange={(l) => { setLimit(l); setPage(1); }} noun="transactions" />
          </div>
        </>
      )}
    </div>
  );
}

// Authorized apps (OAuth consent grants) for the party. Staff revoke is level2_investigator only.
function StaffAppsSection({ partyRef, token, canAct }: { partyRef: string; token: string; canAct: boolean }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [grants, setGrants] = useState<ConsentGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.consentGrants.listForParty(partyRef, token, 'all')
      .then((r) => { if (alive) setGrants(r.grants); })
      .catch(() => { if (alive) setGrants([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [partyRef, token]);

  async function revoke(grant: ConsentGrant) {
    const ok = await confirm({
      title: `Revoke "${grant.merchantName}" for this customer?`,
      message: 'This immediately invalidates the app\'s tokens for this customer. The grant stays listed as Revoked for audit.',
      confirmLabel: 'Revoke access',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(grant.consentId);
    try {
      await api.consentGrants.revokeForParty(grant.consentId, partyRef, token);
      setGrants((gs) => gs.map((x) => x.consentId === grant.consentId
        ? { ...x, consentStatus: 'revoked', consentRevokedAt: new Date().toISOString() } : x));
      notify(`Access revoked for ${grant.merchantName}.`, 'success');
    } catch { notify('Could not revoke access. Please try again.', 'error'); }
    setBusy(null);
  }

  return (
    <div className="bg-white rounded-xl border p-5">
      <h2 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><Layers size={14} className="text-[#00684A]" /> Authorized apps</h2>
      {loading ? <LoadingIndicator label="Loading authorized apps…" /> : grants.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4">No authorized applications.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {grants.map((g) => {
            const revoked = g.consentStatus === 'revoked';
            return (
              <li key={g.consentId} className="py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-gray-800 truncate flex items-center gap-2">
                    {g.merchantName}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${revoked ? 'bg-gray-100 text-gray-500 border border-gray-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                      {revoked ? 'Revoked' : 'Active'}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {g.grantedScopes.slice(0, 4).map((s) => (
                      <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{s}</span>
                    ))}
                    {g.grantedScopes.length > 4 && <span className="text-[10px] text-gray-400">+{g.grantedScopes.length - 4} more</span>}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Approved {new Date(g.consentGrantedAt).toLocaleDateString()}
                    {g.lastUsedAt && ` · Last used ${new Date(g.lastUsedAt).toLocaleDateString()}`}
                  </p>
                </div>
                {canAct && !revoked && (
                  <button onClick={() => revoke(g)} disabled={busy === g.consentId}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded-lg px-2 py-1 disabled:opacity-50 shrink-0">
                    <Trash2 size={12} />{busy === g.consentId ? 'Revoking…' : 'Revoke'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Payout accounts (GDPR/PSD2). IBAN reveal is gated server-side; here we show display-safe fields only.
function StaffAccountsSection({ partyRef, token }: { partyRef: string; token: string }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.accounts.list(partyRef, token)
      .then((r) => { if (alive) setRows(r.results); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [partyRef, token]);

  return (
    <div className="bg-white rounded-xl border p-5">
      <h2 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><Landmark size={14} className="text-[#00684A]" /> Payout accounts</h2>
      {loading ? <LoadingIndicator label="Loading accounts…" /> : rows.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4">No payout accounts.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((a) => (
            <li key={String(a.payoutAccountInstanceReference)} className="py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-gray-800 truncate flex items-center gap-2">
                  {String(a.payoutAccountAlias ?? a.payoutAccountBankName ?? a.payoutAccountType ?? 'Account')}
                  {a.payoutAccountIsDefault === true && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">Default</span>}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {String(a.payoutAccountType ?? '-')} · {String(a.payoutAccountCurrency ?? '-')} · Rail {String(a.payoutAccountPreferredRail ?? '-')}
                </p>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${statusPill(String(a.payoutAccountStatus ?? ''))}`}>{String(a.payoutAccountStatus ?? '-')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Saved cards (SD-88), masked PAN only. Deactivate / remove are level2_investigator only.
function StaffCardsSection({ customerId, token, canAct }: { customerId: string; token: string; canAct: boolean }) {
  const confirm = useConfirm();
  const notify = useNotify();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api.customer.getCards(customerId, token)
      .then((r) => { if (alive) setRows(r.results); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customerId, token]);

  useEffect(() => load(), [load]);

  async function deactivate(cardId: string, masked: string) {
    const ok = await confirm({ title: 'Deactivate this card?', message: `Card ${masked} will be declined on every operation until reactivated.`, confirmLabel: 'Deactivate', tone: 'danger' });
    if (!ok) return;
    setBusy(cardId);
    try { await api.customer.setCardActive(customerId, cardId, false, token); load(); notify('Card deactivated.', 'success'); }
    catch { notify('Could not deactivate the card.', 'error'); setBusy(null); }
  }

  async function remove(cardId: string, masked: string) {
    const ok = await confirm({ title: 'Remove this card?', message: `Card ${masked} will be removed (soft-delete). This is audited.`, confirmLabel: 'Remove card', tone: 'danger' });
    if (!ok) return;
    setBusy(cardId);
    try { await api.customer.deleteCard(customerId, cardId, token); setRows((cs) => cs.filter((c) => String(c.paymentCardInstanceReference) !== cardId)); notify('Card removed.', 'success'); }
    catch { notify('Could not remove the card.', 'error'); }
    setBusy(null);
  }

  return (
    <div className="bg-white rounded-xl border p-5">
      <h2 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><CreditCard size={14} className="text-[#00684A]" /> Saved cards</h2>
      {loading ? <LoadingIndicator label="Loading cards…" /> : rows.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4">No saved cards.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((c) => {
            const cardId = String(c.paymentCardInstanceReference);
            const masked = String(c.paymentCardMaskedPanDisplay ?? '••••');
            const status = String(c.paymentCardStatus ?? '');
            return (
              <li key={cardId} className="py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-gray-800 truncate flex items-center gap-2">
                    <span className="font-mono">{masked}</span>
                    <span className="text-xs text-gray-500">{String(c.paymentCardNetwork ?? '')}</span>
                    {c.paymentCardIsPreferred === true && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">Preferred</span>}
                  </p>
                  {c.paymentCardAlias != null && String(c.paymentCardAlias) !== '' && (
                    <p className="text-[11px] text-gray-400 mt-0.5">{String(c.paymentCardAlias)}</p>
                  )}
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${statusPill(status)}`}>{status || '-'}</span>
                {canAct && (
                  <div className="flex items-center gap-1 shrink-0">
                    {status === 'active' && (
                      <button onClick={() => deactivate(cardId, masked)} disabled={busy === cardId}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 border border-amber-200 hover:border-amber-400 rounded-lg px-2 py-1 disabled:opacity-50">
                        <Pause size={12} />Deactivate
                      </button>
                    )}
                    <button onClick={() => remove(cardId, masked)} disabled={busy === cardId}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded-lg px-2 py-1 disabled:opacity-50">
                      <Trash2 size={12} />Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Customer detail (KYC) by instance reference, role-gated by the backend:
//  L1 → summary only · L2 → sensitive PII with a valid escalation token · Auditor → full.
export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const router = useRouter();
  const { debugMode } = useDebugMode();

  const [token, setToken] = useState('');
  const [role, setRole] = useState('level1_analyst');
  const [authReady, setAuthReady] = useState(false);
  const [navCtx, setNavCtx] = useState<{ from: string; txnId?: string; caseId?: string; caseRef?: string } | null>(null);

  useEffect(() => {
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    if (u?.role === 'customer') { router.replace('/system/payment/history'); return; }
    setToken(t);
    setRole(u?.role ?? 'level1_analyst');
    setAuthReady(true);
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const from = sp.get('from');
      if (from === 'transaction' && sp.get('txnId')) setNavCtx({ from, txnId: sp.get('txnId')! });
      else if (from === 'investigation' && sp.get('caseId')) setNavCtx({ from, caseId: sp.get('caseId')!, caseRef: sp.get('caseRef') ?? undefined });
    }
  }, [customerId, router]);

  // When arriving from a case, reuse that case's escalation token so an L2 who approved the
  // escalation keeps sensitive access here (the backend re-validates it; expired → no PII).
  const escToken = navCtx?.from === 'investigation' && navCtx.caseId ? readEscalationToken(navCtx.caseId) : undefined;
  // Cache key scoped by role AND escalation so a summary view is never reused as a full view.
  const key = authReady ? `customer:${customerId}:${role}:${escToken ? 'e' : 'n'}` : null;
  const { data: customer, loading: resLoading, error } = useResource<Record<string, unknown>>(
    key, () => api.customer.getById(customerId, token, escToken),
  );
  const loading = !authReady || resLoading;
  const notFound = !!error;

  const isAuditor = role === 'security_auditor';
  const roleLabel = role === 'level1_analyst' ? 'L1 Access' : role === 'level2_investigator' ? 'L2 Access' : isAuditor ? 'Auditor Access' : role;

  if (loading) return <div className="w-full px-5 sm:px-8 lg:px-12 py-6 text-gray-400 text-sm">Loading customer…</div>;
  if (notFound || !customer) return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 text-gray-500 space-y-3">
      <p>Customer not found.</p>
      <Link href="/system/users" className="text-blue-600 hover:underline text-sm">← Back to users</Link>
    </div>
  );

  const c = customer;
  const name = String(c.customerName ?? 'Customer');
  // Staff-only block gating (server re-enforces): VIEW = L2 + auditor, ACTIONS = L2 only.
  const isStaff = role === 'level2_investigator' || role === 'security_auditor';
  const canAct = role === 'level2_investigator';
  const partyRef = c.partyInstanceReference != null ? String(c.partyInstanceReference) : '';
  const kyc = c.customerAgreementKycCheck as { customerAgreementKycCheckStatus?: string; customerAgreementKycCheckReference?: string; customerAgreementKycCheckCompletedDate?: string; customerAgreementKycCheckNotes?: string } | null;
  const sensitive = c.sensitive as { customerAgreementResidentialAddress?: { streetAddress?: string; city?: string; postalCode?: string; countryCode?: string }; governmentIdentificationReference?: string; customerAgreementRiskNotes?: string } | undefined;

  const crumbs: Crumb[] =
    navCtx?.from === 'investigation' && navCtx.caseId
      ? [
          { label: 'Home', href: '/system' },
          { label: 'Cases', href: '/system/investigation' },
          { label: navCtx.caseRef || 'Case', href: `/system/investigation/${navCtx.caseId}` },
          { label: name },
        ]
      : navCtx?.from === 'transaction' && navCtx.txnId
      ? [
          { label: 'Home', href: '/system' },
          { label: 'Transactions', href: '/system/transactions' },
          { label: 'Transaction', href: `/system/transactions/${navCtx.txnId}` },
          { label: name },
        ]
      : [
          { label: 'Home', href: '/system' },
          { label: 'Users', href: '/system/users' },
          { label: name },
        ];

  const Field = ({ label, value }: { label: string; value?: unknown }) => (
    <>
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right truncate">{value != null && value !== '' ? String(value) : '-'}</span>
    </>
  );

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={crumbs} />

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[#001E2B]/10 flex items-center justify-center"><UserCheck size={18} className="text-[#001E2B]" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{name}</h1>
          <p className="text-xs text-gray-400 font-mono">{String(c.customerAgreementInstanceReference ?? customerId)}</p>
        </div>
        <span className="ml-auto text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{roleLabel}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profile (QE:equality fields decrypt for staff; no QE:none here) */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-3">Profile</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Email" value={c.customerEmailAddress} />
            <Field label="Phone" value={c.customerMobilePhoneNumber} />
            <Field label="Account reference" value={c.customerAgreementReference} />
            <Field label="Segment" value={SEGMENT_LABELS[String(c.customerSegment)] ?? c.customerSegment} />
            <Field label="Status" value={c.customerAgreementStatus} />
            <Field label="Enrolled" value={c.customerAgreementEnrollmentDate ? new Date(String(c.customerAgreementEnrollmentDate)).toLocaleDateString() : undefined} />
            <Field label="Language" value={c.customerAgreementPreferredLanguage} />
          </div>
          {c.contactPiiRestricted === true && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Contact PII (email, phone) is restricted at the L1 access level{debugMode ? ' (PCI DSS Req 7, need-to-know)' : ''}. Available to L2 investigators and the security auditor.
            </p>
          )}
        </div>

        {/* KYC check (BIAN SD-53 BQ:Step) */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><ShieldCheck size={14} className="text-teal-600" /> KYC check{debugMode ? ' (SD-53)' : ''}</h2>
          {kyc ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label="Status" value={kyc.customerAgreementKycCheckStatus} />
              <Field label="Reference" value={kyc.customerAgreementKycCheckReference} />
              <Field label="Completed" value={kyc.customerAgreementKycCheckCompletedDate ? new Date(String(kyc.customerAgreementKycCheckCompletedDate)).toLocaleDateString() : undefined} />
              {kyc.customerAgreementKycCheckNotes && (<><span className="text-gray-500">Notes</span><span className="text-right">{kyc.customerAgreementKycCheckNotes}</span></>)}
            </div>
          ) : <p className="text-sm text-gray-400">No KYC record.</p>}
        </div>
      </div>

      {/* Sensitive PII; auditor always; L2 only with a valid escalation token */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-3">
          <Lock size={14} className="text-gray-400" />
          <h2 className="font-semibold text-gray-800 text-sm">Sensitive PII{debugMode ? ' (QE:none)' : ''}</h2>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${sensitive ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>
            {sensitive ? 'Unlocked' : 'Restricted'}
          </span>
        </div>
        {sensitive ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Address" value={sensitive.customerAgreementResidentialAddress ? [sensitive.customerAgreementResidentialAddress.streetAddress, sensitive.customerAgreementResidentialAddress.city, sensitive.customerAgreementResidentialAddress.postalCode, sensitive.customerAgreementResidentialAddress.countryCode].filter(Boolean).join(', ') : undefined} />
            <Field label="Government ID" value={sensitive.governmentIdentificationReference} />
            {sensitive.customerAgreementRiskNotes && (<><span className="text-gray-500">Risk notes</span><span className="text-right">{sensitive.customerAgreementRiskNotes}</span></>)}
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">
            {debugMode && 'Address, government ID and risk notes are QE:none (encrypted, not searchable). '}
            {isAuditor ? 'Address, government ID and risk notes are unavailable.' : 'Address, government ID and risk notes require a valid L2 escalation acceptance; the security auditor has full access.'}
          </p>
        )}
      </div>

      {/* Staff-only investigation sections. VIEW: level2_investigator + security_auditor.
          ACTIONS (revoke app, deactivate/remove card): level2_investigator only. The server
          re-enforces both (defense in depth); this gating is UX. Not rendered for L1/customer. */}
      {isStaff && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 pt-1">
            <h2 className="text-sm font-semibold text-gray-700">Investigation</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#001E2B]/10 text-[#001E2B] font-medium">
              {canAct ? 'L2 actions enabled' : 'Read-only (auditor)'}
            </span>
          </div>
          <StaffTransactionsSection customerId={customerId} token={token} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {partyRef ? <StaffAppsSection partyRef={partyRef} token={token} canAct={canAct} /> : null}
            {partyRef ? <StaffAccountsSection partyRef={partyRef} token={token} /> : null}
          </div>
          <StaffCardsSection customerId={customerId} token={token} canAct={canAct} />
        </div>
      )}
    </div>
  );
}

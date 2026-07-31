'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type ConsentGrant, type CustomerTransactionRow, type FraudCase } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Breadcrumb, type Crumb } from '../../../../components/Breadcrumb';
import { useResource } from '../../../../lib/useResource';
import { useCaseEscalation } from '../../../../lib/useCaseEscalation';
import { useDebugMode } from '../../../../lib/debugMode';
import { useEffectivePermissions } from '../../../../lib/permissions';
import { LoadingIndicator } from '../../../../components/LoadingIndicator';
import { Pagination } from '../../../../components/Pagination';
import { CaseTable } from '../../../../components/CaseTable';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';
import { UserCheck, ShieldCheck, Lock, ArrowUpRight, ArrowDownLeft, Layers, Landmark, CreditCard, Trash2, Pause, ShieldAlert, IdCard, ExternalLink } from 'lucide-react';
// v32 B4/D1: the shared record primitives. This page used a local plain `Field` with no mask, no
// tooltip and no reveal, so the auditor read QE:none PII in clear here while the operations officer
// had to perform an audited reveal for the same fields. One renderer, one contract (ADR-052).
import { RecordGroup, RecordGroupGrid } from '../../../../components/record/RecordGroup';
import { RecordField } from '../../../../components/record/RecordField';
import { IdentityDocumentBlock } from '../../../../components/record/IdentityDocumentBlock';
import { humanize, fmtAddress, fmtDate } from '../../../../components/record/format';

const SEGMENT_LABELS: Record<string, string> = { retail: 'Retail', premium: 'Premium', corporate: 'Corporate', sme: 'SME' };

// v27 staff navigation context appended to a detail-page URL so it opens in staff-target mode
// (the target's data via staff endpoints, breadcrumb back to this profile). The page enforces the
// role; these params only carry WHO is being inspected.
function staffQuery(customerId: string, partyRef: string): string {
  return `?ctx=staff&customerId=${encodeURIComponent(customerId)}&partyRef=${encodeURIComponent(partyRef)}`;
}

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
function StaffTransactionsSection({ customerId, partyRef, token }: { customerId: string; partyRef: string; token: string }) {
  const router = useRouter();
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
                  // Card-kind → existing staff transaction detail; transfer-kind → SD-65 staff execution detail.
                  const href = r.kind === 'card'
                    ? `/system/transactions/${encodeURIComponent(r.paymentExecutionInstanceReference)}${staffQuery(customerId, partyRef)}`
                    : `/system/users/${encodeURIComponent(customerId)}/transactions/${encodeURIComponent(r.paymentExecutionInstanceReference)}`;
                  return (
                    <tr key={r.paymentExecutionInstanceReference} onClick={() => router.push(href)}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
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
function StaffAppsSection({ customerId, partyRef, token, canAct }: { customerId: string; partyRef: string; token: string; canAct: boolean }) {
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
                    <Link href={`/system/applications/${encodeURIComponent(g.consentId)}${staffQuery(customerId, partyRef)}`}
                      className="hover:underline text-[#00684A]">{g.merchantName}</Link>
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
function StaffAccountsSection({ customerId, partyRef, token }: { customerId: string; partyRef: string; token: string }) {
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
                  <Link href={`/system/accounts/${encodeURIComponent(String(a.payoutAccountInstanceReference))}${staffQuery(customerId, partyRef)}`}
                    className="hover:underline text-[#00684A]">
                    {String(a.payoutAccountAlias ?? a.payoutAccountBankName ?? a.payoutAccountType ?? 'Account')}
                  </Link>
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
function StaffCardsSection({ customerId, partyRef, token, canAct }: { customerId: string; partyRef: string; token: string; canAct: boolean }) {
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
                    <Link href={`/system/cards/${encodeURIComponent(cardId)}${staffQuery(customerId, partyRef)}`}
                      className="font-mono hover:underline text-[#00684A]">{masked}</Link>
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

// Fraud/investigation cases opened against this customer (SD-77). Read-only list; each row links to
// the existing case detail. Reuses CaseTable + Pagination. VIEW = L2 + auditor (server re-enforces).
function StaffCasesSection({ customerId, token }: { customerId: string; token: string }) {
  const [cases, setCases] = useState<FraudCase[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.fraud.list({ customerId, page, limit }, token)
      .then((r) => { if (alive) { setCases(r.results); setTotal(r.total); } })
      .catch(() => { if (alive) { setCases([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customerId, token, page, limit]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="bg-white rounded-xl border p-5">
      <h2 className="font-semibold text-gray-800 text-sm mb-3 flex items-center gap-1.5"><ShieldAlert size={14} className="text-[#00684A]" /> Cases</h2>
      {loading ? <LoadingIndicator label="Loading cases…" /> : cases.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4">No investigation cases for this customer.</p>
      ) : (
        <>
          <CaseTable cases={cases} basePath="/system/investigation" />
          <div className="pt-2">
            <Pagination page={page} totalPages={totalPages} total={total} limit={limit}
              onPageChange={setPage} onLimitChange={(l) => { setLimit(l); setPage(1); }} noun="cases" />
          </div>
        </>
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
  const { can } = useEffectivePermissions();
  // v32 C2: one audited reveal per view; the ephemeral values live here only while shown.
  const revealCache = useRef<Record<string, unknown> | null>(null);

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

  // Arriving from a case: reuse that case's escalation token, re-deriving it when this tab has
  // none (deep link / new tab). The backend re-validates it; expired or absent → no PII.
  const caseIdCtx = navCtx?.from === 'investigation' ? navCtx.caseId : undefined;
  const { escalationToken: escToken, resolving: escResolving } = useCaseEscalation({
    caseId: caseIdCtx, role, token,
  });
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
  // v32 C2: QE:none values travel in the payload only on the audited escalation path (a case
  // reference). Otherwise the server sends `sensitiveAvailable` and the value is fetched from the
  // reveal endpoint, which emits one compliance event per disclosure (PCI DSS Req 10.2.2).
  const sensitive = c.sensitive as { customerAgreementResidentialAddress?: Record<string, unknown>; customerAgreementRiskNotes?: string } | undefined;
  const sensitiveAvailable = sensitive != null || c.sensitiveAvailable === true;
  // v32 B7 (P5): no orphan information. The auditor and the L2 investigator already hold both
  // permissions the KYC record needs; they were simply never given a link to it.
  const canOpenKycRecord = !!partyRef && can('customers', 'view') && can('modules', 'view');

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

  // v32 C2: the audited reveal endpoint is the only way to obtain a QE:none value. Fetched once
  // per view and cached, so toggling the eye does not re-request (and does not re-audit) it.
  const revealKyc = async (): Promise<Record<string, unknown>> => {
    if (!revealCache.current) revealCache.current = await api.customer.kycReveal(partyRef, token);
    return revealCache.current;
  };

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

      <RecordGroupGrid>
        {/* Profile: SD-13/SD-53 lookup tier (QE equality/range), decrypted in-process for staff. */}
        <RecordGroup
          icon={UserCheck}
          title="Profile"
          info="Party and agreement attributes at LOOKUP tier: encrypted at rest in Atlas with Queryable Encryption and searchable while encrypted. Decrypted in-process for a role with need-to-know."
          accessNote={c.contactPiiRestricted === true
            ? `Contact PII (email, phone) is restricted at the L1 access level${debugMode ? ' (PCI DSS Req 7, need-to-know)' : ''}. Available to L2 investigators and the security auditor.`
            : undefined}
        >
          <RecordField label="Email" tier="lookup" value={c.customerEmailAddress ? String(c.customerEmailAddress) : ''} info="Contact email (SD-13). QE:equality encrypted at rest (exact-match searchable)." />
          <RecordField label="Phone" tier="lookup" value={c.customerMobilePhoneNumber ? String(c.customerMobilePhoneNumber) : ''} info="Contact mobile phone (SD-13). QE:equality encrypted at rest (exact-match searchable)." />
          <RecordField label="Account reference" tier="lookup" mono value={c.customerAgreementReference ? String(c.customerAgreementReference) : ''} info="Internal reference for the customer agreement (SD-53), used for lookups. QE:equality encrypted at rest." />
          <RecordField label="Segment" value={SEGMENT_LABELS[String(c.customerSegment)] ?? humanize(c.customerSegment)} info="Commercial segment (retail / premium / corporate / SME). Business metadata, plaintext." />
          <RecordField label="Status" value={humanize(c.customerAgreementStatus)} info="BIAN SD-53 agreement lifecycle status. Plaintext." />
          <RecordField label="Enrolled" value={fmtDate(c.customerAgreementEnrollmentDate)} info="Date the customer agreement was enrolled. Plaintext business metadata." />
          <RecordField label="Language" value={humanize(c.customerAgreementPreferredLanguage)} info="Preferred communication language (SD-53). Plaintext business metadata." />
        </RecordGroup>

        {/* v32 B4: the same identity document the KYC administration page shows, from the same
            source of truth, so a displayed value is always a searchable value. */}
        <IdentityDocumentBlock
          governmentId={c.customerAgreementGovernmentID as Record<string, unknown> | null}
          taxIdNumber={c.customerAgreementTaxIDNumber}
        />

        {/* KYC check (BIAN SD-53 BQ:Step), with the v32 B7 link onward to the full KYC record. */}
        <RecordGroup
          icon={ShieldCheck}
          title={`KYC check${debugMode ? ' (SD-53)' : ''}`}
          info="Outcome of the Know Your Customer verification step (SD-53 BQ:Step): lifecycle status, provider reference and completion date."
          badge={canOpenKycRecord ? (
            <Link
              href={`/system/admin/modules/kyc/${encodeURIComponent(partyRef)}`}
              className="text-xs inline-flex items-center gap-1 text-[#001E2B] hover:underline"
            >
              KYC record <ExternalLink size={12} />
            </Link>
          ) : undefined}
        >
          {kyc ? (
            <>
              <RecordField label="Status" value={humanize(kyc.customerAgreementKycCheckStatus)} info="KYC lifecycle status derived from the screening verdict (initiated / verified / rejected / expired)." />
              <RecordField label="Reference" tier="lookup" mono value={kyc.customerAgreementKycCheckReference ? String(kyc.customerAgreementKycCheckReference) : ''} info="Provider-side reference for the KYC check (SD-53)." />
              <RecordField label="Completed" value={fmtDate(kyc.customerAgreementKycCheckCompletedDate)} info="Date the KYC check completed. Plaintext business metadata." />
              {kyc.customerAgreementKycCheckNotes ? (
                <RecordField label="Notes" value={String(kyc.customerAgreementKycCheckNotes)} info="Free-text notes recorded with the KYC outcome." />
              ) : null}
            </>
          ) : <p className="text-sm text-gray-400">No KYC record.</p>}
        </RecordGroup>

        {/* Protected details (QE:none). Masked for EVERY role; the eye performs the audited reveal.
            v32 C1/C3: this page used to print these values in clear for the auditor while the
            operations officer had to reveal the same fields, which inverted the friction. */}
        <RecordGroup
          icon={Lock}
          title={`Protected details${debugMode ? ' (QE:none)' : ''}`}
          info="QE:none fields (encrypted at rest, NOT searchable): residential address and risk notes. Hidden by default; the eye performs an on-demand, ephemeral, audited reveal (PCI DSS Req 3.2/3.3 and Req 10, GDPR need-to-know). The value is never persisted; only the fact of the reveal is audited, by field name."
          badge={
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              sensitiveAvailable ? 'bg-purple-100 text-purple-700'
                : escResolving ? 'bg-gray-100 text-gray-600'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {sensitiveAvailable ? 'Reveal available' : escResolving ? 'Checking access…' : 'Restricted'}
            </span>
          }
          accessNote={sensitiveAvailable || escResolving
            ? undefined
            : (isAuditor
              ? 'These fields are unavailable for this record.'
              : 'Revealing these fields requires a valid L2 escalation acceptance; the security auditor reveals them directly.')}
        >
          <RecordField
            label="Residential address"
            tier="sensitive"
            info="Full residential address (SD-53). QE:none: encrypted at rest and not searchable."
            {...(sensitiveAvailable ? { fetchValue: async () => fmtAddress(sensitive?.customerAgreementResidentialAddress ?? (await revealKyc()).customerAgreementResidentialAddress) || 'n/a' } : {})}
          />
          <RecordField
            label="Risk notes"
            tier="sensitive"
            info="Internal analyst risk notes. QE:none: encrypted at rest, never exposed to L1."
            {...(sensitiveAvailable ? { fetchValue: async () => String(sensitive?.customerAgreementRiskNotes ?? (await revealKyc()).customerAgreementRiskNotes ?? 'n/a') } : {})}
          />
        </RecordGroup>
      </RecordGroupGrid>

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
          <StaffTransactionsSection customerId={customerId} partyRef={partyRef} token={token} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {partyRef ? <StaffAppsSection customerId={customerId} partyRef={partyRef} token={token} canAct={canAct} /> : null}
            {partyRef ? <StaffAccountsSection customerId={customerId} partyRef={partyRef} token={token} /> : null}
          </div>
          <StaffCardsSection customerId={customerId} partyRef={partyRef} token={token} canAct={canAct} />
          <StaffCasesSection customerId={customerId} token={token} />
        </div>
      )}
    </div>
  );
}

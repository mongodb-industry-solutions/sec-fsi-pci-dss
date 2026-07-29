'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, Landmark, Pause, Pencil, Play, Save, Star, Trash2, Users, X } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { useDebugMode } from '../../../../lib/debugMode';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';
import { Breadcrumb, type Crumb } from '../../../../components/Breadcrumb';
import { SensitiveReveal } from '../../../../components/SensitiveReveal';

// Owner self-service detail for one saved card (BIAN SD-88). Shows the surrogate token, expiry
// (QE:none, owner-visible), lifecycle dates and status. The alias/note are the ONLY editable
// attributes; the card itself can be removed (soft-delete). Ownership is enforced server-side.
interface CardDetail {
  paymentCardInstanceReference: string;
  paymentCardReference?: string;
  paymentCardExpirationDate?: string;
  paymentCardMaskedPanDisplay?: string;
  paymentCardNetwork?: string;
  paymentCardStatus?: string;
  paymentCardIsPreferred?: boolean;
  paymentCardAlias?: string;
  paymentCardCustomerNote?: string;
  paymentCardMandateStatus?: string;
  paymentCardIssuanceDateTime?: string;
  recordCreatedDateTime?: string;
  recordUpdatedDateTime?: string;
  cardHolderCount?: number;
  fundingPayoutAccountInstanceReference?: string;
}

interface FundingAccount {
  payoutAccountInstanceReference: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountType: string;
  payoutAccountStatus: string;
  payoutAccountCurrency: string;
  payoutAccountIsDefault: boolean;
}

interface CardTransaction {
  cardTransactionInstanceReference: string;
  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionDateTime: string;
  cardTransactionStatus: string;
  cardTransactionMerchantName: string;
  cardTransactionMaskedPanDisplay: string;
}

function statusClass(status?: string): string {
  switch (status) {
    case 'active':  return 'bg-green-100 text-green-700';
    case 'expired': return 'bg-amber-100 text-amber-700';
    case 'blocked':
    case 'suspended': return 'bg-red-100 text-red-700';
    default:        return 'bg-gray-100 text-gray-500';
  }
}

function fmtDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}


// Staff context propagated to the next page, so it reads the target party and not the caller's own.
function staffCtxQuery(nav: { ctx?: string; customerId?: string; partyRef?: string }): string {
  if (nav.ctx !== 'staff') return '';
  const params = new URLSearchParams({ ctx: 'staff' });
  if (nav.customerId) params.set('customerId', nav.customerId);
  if (nav.partyRef) params.set('partyRef', nav.partyRef);
  return `?${params.toString()}`;
}

export default function CardDetailPage() {
  const params = useParams<{ cardId: string }>();
  const cardId = params?.cardId as string;
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();
  const { debugMode } = useDebugMode();

  const [token, setToken] = useState('');
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [card, setCard] = useState<CardDetail | null>(null);
  const [ready, setReady] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // v27 staff-target mode: an investigator/auditor drilling into a found customer's card. Self
  // behavior is unchanged; staff mode fetches the target's card via customerId from the query and
  // gates mutations to L2 (auditor is read-only). The server re-enforces both.
  const [staffMode, setStaffMode] = useState(false);
  const [staffCanAct, setStaffCanAct] = useState(false);

  // Edit state (alias + note only)
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState(false);
  // Breadcrumb navigation context (non-PII: where we arrived from). Read from the query string.
  const [nav, setNav] = useState<{ from?: string; txnId?: string; ctx?: string; customerId?: string; partyRef?: string }>({});

  // Funding account state
  const [fundingAccount, setFundingAccount] = useState<FundingAccount | null>(null);

  // Transaction list state
  const [txns, setTxns] = useState<CardTransaction[]>([]);
  const [txnsTotal, setTxnsTotal] = useState(0);
  const [txnsPage, setTxnsPage] = useState(1);
  const [txnsStatus, setTxnsStatus] = useState('');
  const [txnsDateFrom, setTxnsDateFrom] = useState('');
  const [txnsDateTo, setTxnsDateTo] = useState('');
  const [txnsLoading, setTxnsLoading] = useState(false);
  const TXNS_LIMIT = 10;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    setNav({
      from: sp.get('from') ?? undefined,
      txnId: sp.get('txnId') ?? undefined,
      ctx: sp.get('ctx') ?? undefined,
      customerId: sp.get('customerId') ?? undefined,
      partyRef: sp.get('partyRef') ?? undefined,
    });
  }, []);

  const loadTxns = useCallback(async (
    t: string,
    cardToken: string,
    page: number,
    status: string,
    dateFrom: string,
    dateTo: string,
  ) => {
    setTxnsLoading(true);
    try {
      const params: Parameters<typeof api.transactions.listAll>[0] = {
        cardToken,
        page,
        limit: 10,
      };
      if (status) params.status = status;
      const res = await api.transactions.listAll(params, t);
      // Filter by date client-side when dateFrom/dateTo are set, since listAll doesn't support them
      let results = res.results as unknown as CardTransaction[];
      if (dateFrom) {
        const from = new Date(dateFrom).getTime();
        results = results.filter((r) => new Date(r.cardTransactionDateTime).getTime() >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo + 'T23:59:59').getTime();
        results = results.filter((r) => new Date(r.cardTransactionDateTime).getTime() <= to);
      }
      setTxns(results);
      setTxnsTotal(res.total);
    } catch {
      setTxns([]);
      setTxnsTotal(0);
    } finally {
      setTxnsLoading(false);
    }
  }, []);

  const load = useCallback(async (t: string, agId: string, fundingPartyRef?: string) => {
    try {
      const c = await api.customer.getCardById(agId, cardId, t) as unknown as CardDetail;
      setCard(c);
      setAlias(c.paymentCardAlias ?? '');
      setNote(c.paymentCardCustomerNote ?? '');
      // Load funding account details (non-blocking). Self: the caller's own partyRef; staff: the
      // target party's partyRef from the query (a staff account read is server-authorized).
      if (c.fundingPayoutAccountInstanceReference) {
        const pRef = fundingPartyRef ?? decodeToken(t)?.partyRef;
        if (pRef) {
          api.accounts.get(pRef, c.fundingPayoutAccountInstanceReference, t)
            .then((a) => setFundingAccount(a as unknown as FundingAccount))
            .catch(() => {});
        }
      }
    } catch {
      setNotFound(true);
    }
  }, [cardId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = getToken() ?? '';
    const role = t ? decodeToken(t)?.role : null;
    const sp = new URLSearchParams(window.location.search);
    const isStaffCtx = sp.get('ctx') === 'staff'
      && (role === 'level2_investigator' || role === 'security_auditor');

    // Self-service is unchanged: only a `customer` (or an authorized staff ctx) may view here.
    if (role !== 'customer' && !isStaffCtx) { router.replace('/system'); return; }
    setToken(t);

    if (isStaffCtx) {
      const cid = sp.get('customerId');
      const pRef = sp.get('partyRef') ?? undefined;
      setStaffMode(true);
      setStaffCanAct(role === 'level2_investigator');
      setAgreementId(cid);
      if (cid) load(t, cid, pRef).finally(() => setReady(true));
      else { setNotFound(true); setReady(true); }
      return;
    }

    api.auth.me(t)
      .then(async (me) => {
        const id = (me.agreement as { customerAgreementInstanceReference?: string } | null)?.customerAgreementInstanceReference ?? null;
        setAgreementId(id);
        if (id) await load(t, id);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setReady(true));
  }, [router, load]);

  // Load transactions whenever the card (and its card token) become available or filters change.
  useEffect(() => {
    if (!token || !card?.paymentCardReference) return;
    loadTxns(token, card.paymentCardReference, txnsPage, txnsStatus, txnsDateFrom, txnsDateTo);
  }, [token, card?.paymentCardReference, txnsPage, txnsStatus, txnsDateFrom, txnsDateTo, loadTxns]);

  async function handleSave() {
    if (!agreementId) return;
    setSaving(true);
    try {
      const updated = await api.customer.updateCard(agreementId, cardId, {
        paymentCardAlias: alias.trim(),
        paymentCardCustomerNote: note.trim(),
      }, token) as unknown as CardDetail;
      setCard((prev) => prev ? { ...prev, ...updated } : prev);
      setEditing(false);
      notify('Card updated.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update card.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!agreementId || !card) return;
    const ok = await confirm({
      title: 'Remove this card?',
      message: `${card.paymentCardMaskedPanDisplay} will be removed from your saved payment methods. This cannot be undone.`,
      confirmLabel: 'Remove card',
      tone: 'danger',
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await api.customer.deleteCard(agreementId, cardId, token);
      notify('Card removed.', 'success');
      router.push(staffMode ? `/system/users/${encodeURIComponent(agreementId)}` : '/system/cards');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to remove card.', 'error');
      setRemoving(false);
    }
  }

  async function handleToggleActive() {
    if (!agreementId || !card) return;
    const deactivating = card.paymentCardStatus === 'active';
    if (deactivating) {
      const ok = await confirm({
        title: 'Deactivate this card?',
        message: 'While deactivated, any payment with this card will be declined by the PSP; even though the card itself remains valid. You can reactivate it at any time.',
        confirmLabel: 'Deactivate',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setToggling(true);
    try {
      const updated = await api.customer.setCardActive(agreementId, cardId, !deactivating, token) as unknown as CardDetail;
      setCard((prev) => prev ? { ...prev, ...updated } : prev);
      notify(deactivating ? 'Card deactivated.' : 'Card reactivated.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to change card status.', 'error');
    } finally {
      setToggling(false);
    }
  }

  function cancelEdit() {
    setAlias(card?.paymentCardAlias ?? '');
    setNote(card?.paymentCardCustomerNote ?? '');
    setEditing(false);
  }

  const cardLabel = card?.paymentCardAlias || card?.paymentCardNetwork
    || (card?.paymentCardMaskedPanDisplay ? `Card ${card.paymentCardMaskedPanDisplay.slice(-4)}` : 'Card');
  const crumbs: Crumb[] = staffMode
    ? [
        { label: 'Home', href: '/system' },
        { label: 'Users', href: '/system/users' },
        { label: 'Customer', href: nav.customerId ? `/system/users/${nav.customerId}` : '/system/users' },
        { label: cardLabel },
      ]
    : nav.from === 'history' && nav.txnId
    ? [
        { label: 'Home', href: '/system' },
        { label: 'Transactions', href: '/system/payment/history' },
        { label: 'Payment', href: `/system/payment/history/${nav.txnId}` },
        { label: cardLabel },
      ]
    : [
        { label: 'Home', href: '/system' },
        { label: 'Payment Methods', href: '/system/cards' },
        { label: cardLabel },
      ];

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={crumbs} />

      {!ready ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : notFound || !card ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          This card could not be found, or it is not one of your saved cards.
        </div>
      ) : (
        <>
          {/* Header card */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-lg bg-[#001E2B] flex items-center justify-center shrink-0">
                  <CreditCard size={22} className="text-[#00ED64]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-bold text-[#001E2B] truncate">
                      {card.paymentCardAlias || card.paymentCardNetwork || 'Card'}
                    </h1>
                    {card.paymentCardIsPreferred && (
                      <span title="Default card" className="inline-flex items-center gap-0.5 text-xs text-amber-500">
                        <Star size={13} className="fill-amber-400 text-amber-400" /> Default
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 font-mono mt-0.5">{card.paymentCardMaskedPanDisplay}{card.paymentCardNetwork ? ` · ${card.paymentCardNetwork}` : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <span className={`text-xs px-2.5 py-1 rounded font-medium ${statusClass(card.paymentCardStatus)}`}>
                  {card.paymentCardStatus}
                </span>
                {card.fundingPayoutAccountInstanceReference && (
                  <Link href={`/system/accounts/${card.fundingPayoutAccountInstanceReference}${staffCtxQuery(nav)}`} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors">
                    <Landmark size={10} />
                    Funded by linked account
                  </Link>
                )}
              </div>
            </div>

            {/* Funding account chip — in header */}
            {card.fundingPayoutAccountInstanceReference && (
              <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 w-fit">
                <Landmark size={11} />
                Linked to a bank account
              </div>
            )}

            {card.paymentCardStatus === 'suspended' && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm text-amber-800">
                <Pause size={15} className="text-amber-600 mt-0.5 shrink-0" />
                <span>This card is <strong>deactivated</strong>. Any payment with it will be declined by the PSP, even though the card itself is still valid. Reactivate it below to use it again.</span>
              </div>
            )}

            {typeof card.cardHolderCount === 'number' && card.cardHolderCount > 1 && (
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-sm text-blue-800">
                <Users size={15} className="text-blue-600 mt-0.5 shrink-0" />
                <span>This card is also on file for <strong>{card.cardHolderCount - 1}</strong> other {card.cardHolderCount - 1 === 1 ? 'person' : 'people'}. If you don&apos;t recognize this, contact support.</span>
              </div>
            )}
          </div>

          {/* Funding Account — BIAN SD-88 cardAccountReference (standalone panel) */}
          {card.fundingPayoutAccountInstanceReference && (
            <div className="bg-white rounded-xl border p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Landmark size={14} className="text-blue-600" />
                </div>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Funding Bank Account</h2>
                <span className="text-xs text-gray-400 font-mono hidden sm:inline">BIAN SD-88 cardAccountReference</span>
              </div>
              {fundingAccount ? (
                <Link
                  href={`/system/accounts/${card.fundingPayoutAccountInstanceReference}${staffCtxQuery(nav)}`}
                  className="flex items-center justify-between group hover:bg-gray-50 -mx-5 px-5 py-3 rounded-b-xl transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[#001E2B]/8 flex items-center justify-center shrink-0 group-hover:bg-[#001E2B] transition-colors">
                      <Landmark size={16} className="text-[#001E2B] group-hover:text-[#00ED64] transition-colors" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800 group-hover:text-[#001E2B]">
                        {fundingAccount.payoutAccountAlias || fundingAccount.payoutAccountBankName || 'Account'}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {fundingAccount.payoutAccountBankName && fundingAccount.payoutAccountAlias && (
                          <span className="text-xs text-gray-400">{fundingAccount.payoutAccountBankName}</span>
                        )}
                        <span className="text-xs text-gray-400 uppercase">{fundingAccount.payoutAccountCurrency}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                          {fundingAccount.payoutAccountType === 'bank_account' ? 'Bank Account' : fundingAccount.payoutAccountType === 'wallet' ? 'Wallet' : 'PSP Ledger'}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${
                          fundingAccount.payoutAccountStatus === 'active' ? 'bg-green-50 text-green-700 border-green-200' :
                          fundingAccount.payoutAccountStatus === 'suspended' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                          'bg-gray-100 text-gray-500 border-gray-200'
                        }`}>
                          {fundingAccount.payoutAccountStatus}
                        </span>
                        {fundingAccount.payoutAccountIsDefault && (
                          <span className="text-xs text-amber-500">★ Primary</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-[#001E2B] font-medium group-hover:underline shrink-0 ml-4">View account →</span>
                </Link>
              ) : (
                <Link
                  href={`/system/accounts/${card.fundingPayoutAccountInstanceReference}${staffCtxQuery(nav)}`}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 -mx-5 px-5 py-3 rounded-b-xl transition-colors"
                >
                  <Landmark size={14} /> View linked account →
                </Link>
              )}
            </div>
          )}

          {/* Card details */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Card details</h2>
            <dl className="divide-y text-sm">
              <DetailRow label="Network" value={card.paymentCardNetwork} />
              <DetailRow label="Masked number" value={card.paymentCardMaskedPanDisplay} mono />
              {/* Owner self-service reveals (self mode only). Step-up MFA would gate these in
                  production; omitted for the demo. Values are ephemeral, on demand and re-hideable. */}
              {!staffMode && agreementId && (
                <>
                  <SensitiveReveal label="Full PAN" masked={card.paymentCardMaskedPanDisplay}
                    hint={debugMode ? 'ephemeral; not stored' : undefined}
                    fetchValue={async () => (await api.customer.revealPan(agreementId, cardId, token)).pan} />
                  <SensitiveReveal label="CVV"
                    hint={debugMode ? 'ephemeral; not stored' : undefined}
                    fetchValue={async () => (await api.customer.revealCvv(agreementId, cardId, token)).cvv} />
                </>
              )}
              <DetailRow label="Expires" value={card.paymentCardExpirationDate} mono
                hint={debugMode ? 'QE:none; owner-visible' : undefined} />
              <DetailRow label="Card token" value={card.paymentCardReference} mono
                hint={debugMode ? 'PAN surrogate; not CHD' : undefined} />
              <DetailRow label="Status" value={card.paymentCardStatus} />
              {card.paymentCardMandateStatus && (
                <DetailRow label="Recurring mandate" value={card.paymentCardMandateStatus} />
              )}
              <DetailRow label="Registered" value={fmtDate(card.recordCreatedDateTime ?? card.paymentCardIssuanceDateTime)} />
              {card.recordUpdatedDateTime && (
                <DetailRow label="Last updated" value={fmtDate(card.recordUpdatedDateTime)} />
              )}
            </dl>
            {debugMode && (
              <p className="text-xs text-gray-400 font-mono pt-1">
                paymentCardInstanceReference: {card.paymentCardInstanceReference}
              </p>
            )}
          </div>

          {/* Editable metadata; the ONLY mutable attributes of a saved card */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nickname &amp; note</h2>
                {debugMode && <span className="text-xs font-mono text-gray-300">paymentCardAlias · paymentCardCustomerNote</span>}
              </div>
              {staffMode ? null : !editing ? (
                <button onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors">
                  <Pencil size={13} /> Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={cancelEdit} disabled={saving}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                    <X size={13} /> Cancel
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#001E2B] text-[#00ED64] hover:opacity-90 disabled:opacity-50 transition-opacity">
                    <Save size={13} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {!editing ? (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Nickname</p>
                  <p className="text-gray-800">{card.paymentCardAlias || <span className="text-gray-400">No nickname set</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Note</p>
                  <p className="text-gray-800 whitespace-pre-wrap">{card.paymentCardCustomerNote || <span className="text-gray-400">No note</span>}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Nickname</label>
                  <input value={alias} onChange={(e) => setAlias(e.target.value.slice(0, 40))} maxLength={40}
                    placeholder="e.g. Personal, Travel, Work"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Note</label>
                  <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 280))} maxLength={280} rows={3}
                    placeholder="A memo to help you recognize this card."
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20" />
                  <p className="text-xs text-gray-400 mt-1">
                    Display label only. Never enter a full card number or security code here.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Activation toggle; only for customer-toggleable states (active ↔ suspended). In staff
              mode only an L2 investigator may deactivate/reactivate (auditor is read-only). */}
          {(!staffMode || staffCanAct) && (card.paymentCardStatus === 'active' || card.paymentCardStatus === 'suspended') && (
            <div className="bg-white rounded-xl border p-5 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {card.paymentCardStatus === 'active' ? 'Deactivate this card' : 'Reactivate this card'}
                </p>
                <p className="text-xs text-gray-400">
                  {card.paymentCardStatus === 'active'
                    ? 'Temporarily block payments. The card stays on file and can be reactivated anytime.'
                    : 'Allow payments with this card again.'}
                </p>
              </div>
              <button onClick={handleToggleActive} disabled={toggling}
                className={`inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border disabled:opacity-50 transition-colors ${
                  card.paymentCardStatus === 'active'
                    ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                    : 'border-green-200 text-green-700 hover:bg-green-50'
                }`}>
                {card.paymentCardStatus === 'active'
                  ? <><Pause size={15} /> {toggling ? 'Deactivating…' : 'Deactivate'}</>
                  : <><Play size={15} /> {toggling ? 'Reactivating…' : 'Reactivate'}</>}
              </button>
            </div>
          )}

          {/* Danger zone. In staff mode only an L2 investigator may remove a card (auditor read-only). */}
          {(!staffMode || staffCanAct) && (
          <div className="bg-white rounded-xl border border-red-100 p-5 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium text-gray-800">Remove this card</p>
              <p className="text-xs text-gray-400">The card is removed from your saved methods; the record is retained for audit.</p>
            </div>
            <button onClick={handleRemove} disabled={removing}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
              <Trash2 size={15} /> {removing ? 'Removing…' : 'Remove card'}
            </button>
          </div>
          )}

          {/* Transaction list — only rendered when this card has a card token to filter by */}
          {card.paymentCardReference && (
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Transactions on this card</h2>

              {/* Filters */}
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Status</label>
                  <select
                    value={txnsStatus}
                    onChange={(e) => { setTxnsStatus(e.target.value); setTxnsPage(1); }}
                    className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20"
                  >
                    <option value="">All statuses</option>
                    <option value="authorized">Authorized</option>
                    <option value="declined">Declined</option>
                    <option value="pending">Pending</option>
                    <option value="reversed">Reversed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">From</label>
                  <input
                    type="date"
                    value={txnsDateFrom}
                    onChange={(e) => { setTxnsDateFrom(e.target.value); setTxnsPage(1); }}
                    className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">To</label>
                  <input
                    type="date"
                    value={txnsDateTo}
                    onChange={(e) => { setTxnsDateTo(e.target.value); setTxnsPage(1); }}
                    className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20"
                  />
                </div>
                {(txnsStatus || txnsDateFrom || txnsDateTo) && (
                  <button
                    onClick={() => { setTxnsStatus(''); setTxnsDateFrom(''); setTxnsDateTo(''); setTxnsPage(1); }}
                    className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              {/* Table */}
              {txnsLoading ? (
                <p className="text-sm text-gray-400 py-4 text-center">Loading transactions…</p>
              ) : txns.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No transactions found for this card.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium text-gray-500 text-xs">Date</th>
                        <th className="pb-2 font-medium text-gray-500 text-xs">Merchant</th>
                        <th className="pb-2 font-medium text-gray-500 text-xs text-right">Amount</th>
                        <th className="pb-2 font-medium text-gray-500 text-xs text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {txns.map((txn) => (
                        <tr key={txn.cardTransactionInstanceReference}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => router.push(staffMode
                            ? `/system/transactions/${encodeURIComponent(txn.cardTransactionInstanceReference)}?ctx=staff&customerId=${encodeURIComponent(agreementId ?? '')}&partyRef=${encodeURIComponent(nav.partyRef ?? '')}`
                            : `/system/payment/history/${txn.cardTransactionInstanceReference}?from=card&cardId=${cardId}`)}>
                          <td className="py-2.5 pr-3 text-gray-700 whitespace-nowrap">{fmtDate(txn.cardTransactionDateTime)}</td>
                          <td className="py-2.5 pr-3 text-gray-800 truncate max-w-[180px]">{txn.cardTransactionMerchantName || '-'}</td>
                          <td className="py-2.5 pr-3 text-gray-800 text-right font-mono whitespace-nowrap">
                            {txn.cardTransactionAmount
                              ? new Intl.NumberFormat(undefined, { style: 'currency', currency: txn.cardTransactionAmount.currency, minimumFractionDigits: 2 }).format(txn.cardTransactionAmount.amount)
                              : '-'}
                          </td>
                          <td className="py-2.5 text-right">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                              txn.cardTransactionStatus === 'authorized' ? 'bg-green-100 text-green-700' :
                              txn.cardTransactionStatus === 'declined'   ? 'bg-red-100 text-red-700' :
                              txn.cardTransactionStatus === 'pending'    ? 'bg-amber-100 text-amber-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {txn.cardTransactionStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {txnsTotal > TXNS_LIMIT && (
                <div className="flex items-center justify-between pt-2 text-xs text-gray-500">
                  <span>{txnsTotal} total</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setTxnsPage((p) => Math.max(1, p - 1))}
                      disabled={txnsPage <= 1}
                      className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                    >
                      Previous
                    </button>
                    <span>Page {txnsPage} of {Math.ceil(txnsTotal / TXNS_LIMIT)}</span>
                    <button
                      onClick={() => setTxnsPage((p) => p + 1)}
                      disabled={txnsPage >= Math.ceil(txnsTotal / TXNS_LIMIT)}
                      className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono, hint }: { label: string; value?: string; mono?: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="flex items-center gap-2 min-w-0">
        {hint && <span className="text-xs text-gray-300 font-mono hidden sm:inline">{hint}</span>}
        <span className={`text-gray-800 text-right truncate ${mono ? 'font-mono' : ''}`}>{value ?? '-'}</span>
      </span>
    </div>
  );
}

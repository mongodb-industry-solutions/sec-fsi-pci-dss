'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, Landmark, ArrowLeft, ArrowRight, Pause, Play, Pencil, Save, X, Trash2, ShieldAlert, Search, Repeat } from 'lucide-react';
import { api, type AdminPayoutAccount, type PartyOwnerResult } from '../../../../../../../lib/api';
import { SensitiveReveal } from '../../../../../../../components/SensitiveReveal';
import { getToken } from '../../../../../../../lib/auth';
import { useDebugMode } from '../../../../../../../lib/debugMode';
import { useConfirm, useNotify } from '../../../../../../../components/ui/ConfirmProvider';
import { Breadcrumb } from '../../../../../../../components/Breadcrumb';
import { RequirePermission } from '../../../../../../../components/RequirePermission';
import { useEffectivePermissions } from '../../../../../../../lib/permissions';

// v29.2 global card-administration DETAIL page (SD-88, built-in card-issuer module). Dedicated page
// (not a modal) so the operations officer sees every display-safe field with room to act.
// PCI DSS Req 3.2/3.3: full PAN and CVV/PIN are NEVER stored or shown; expiry (QE:none) is included
// here on a need-to-know basis. Req 7 (least privilege) + Req 10 (every mutation audited server-side).

const LIST_HREF = '/system/admin/modules/card-issuer?tab=cards';
// 'active' is the only status the backend treats as "on". The activation toggle only supports
// active <-> suspended; every other status (issued, pending_activation, blocked, revoked, expired)
// is not toggleable from the admin surface.
const ACTIVE_STATES = ['active'];
const TOGGLEABLE_STATES = ['active', 'suspended'];

interface FundingAccount {
  payoutAccountInstanceReference: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountCurrency?: string;
  payoutAccountStatus?: string;
  payoutAccountHasIban?: boolean;
}

interface CardDetail {
  paymentCardInstanceReference?: string;
  customerAgreementInstanceReference?: string;
  paymentCardReference?: string;
  paymentCardMaskedPanDisplay?: string;
  paymentCardBin?: string;
  paymentCardLast4?: string;
  paymentCardNetwork?: string;
  paymentCardStatus?: string;
  ownerName?: string | null;
  paymentCardExpirationDate?: string;
  paymentCardIsPreferred?: boolean;
  paymentCardAlias?: string;
  paymentCardCustomerNote?: string;
  paymentCardMandateStatus?: string;
  fundingPayoutAccountInstanceReference?: string;
  fundingAccount?: FundingAccount | null;
  paymentCardIssuanceDateTime?: string;
  recordCreatedDateTime?: string;
  recordUpdatedDateTime?: string;
}

function statusClass(status?: string): string {
  switch (status) {
    case 'active':
    case 'issued': return 'bg-green-100 text-green-700';
    case 'expired': return 'bg-amber-100 text-amber-700';
    case 'blocked':
    case 'suspended': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-500';
  }
}

function fmtDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function CardAdminDetail() {
  const params = useParams<{ cardId: string }>();
  const cardId = params?.cardId as string;
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();
  const { debugMode } = useDebugMode();
  // The page is wrapped in cards:view, but edit/toggle/revoke call cards:manage endpoints. Render a
  // read-only detail for view-only roles (e.g. security_auditor) instead of always-failing actions.
  const { can } = useEffectivePermissions();
  const canManage = can('cards', 'manage');

  const token = getToken() ?? '';
  const [card, setCard] = useState<CardDetail | null>(null);
  const [ready, setReady] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [managedExternally, setManagedExternally] = useState(false);

  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reassigningFunding, setReassigningFunding] = useState(false);

  const load = useCallback(async () => {
    if (!token || !cardId) { setReady(true); return; }
    try {
      const c = await api.modules.cardAdmin.get(cardId, token) as CardDetail;
      setCard(c);
      setAlias(c.paymentCardAlias ?? '');
      setNote(c.paymentCardCustomerNote ?? '');
    } catch (e) {
      if (e instanceof Error && e.message === 'managed_externally') setManagedExternally(true);
      else setNotFound(true);
    } finally {
      setReady(true);
    }
  }, [token, cardId]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.modules.cardAdmin.update(cardId, {
        paymentCardAlias: alias.trim(),
        paymentCardCustomerNote: note.trim(),
      }, token) as CardDetail;
      setCard((prev) => prev ? { ...prev, ...updated } : prev);
      setEditing(false);
      notify('Card updated.', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to update card.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    if (!card) return;
    if (!TOGGLEABLE_STATES.includes(card.paymentCardStatus ?? '')) return;
    const active = !ACTIVE_STATES.includes(card.paymentCardStatus ?? '');
    if (!active) {
      const ok = await confirm({
        title: 'Suspend this card?',
        message: 'While suspended, any payment with this card is declined by the PSP. It can be reactivated at any time.',
        confirmLabel: 'Suspend',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setToggling(true);
    try {
      const updated = await api.modules.cardAdmin.setStatus(cardId, active, token) as CardDetail;
      setCard((prev) => prev ? { ...prev, ...updated } : prev);
      notify(active ? 'Card activated.' : 'Card suspended.', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to change card status.', 'error');
    } finally {
      setToggling(false);
    }
  }

  async function handleRevoke() {
    if (!card) return;
    const ok = await confirm({
      title: 'Revoke this card?',
      message: `${card.paymentCardMaskedPanDisplay ?? 'This card'} will be revoked (soft-delete; the record is retained for audit).`,
      confirmLabel: 'Revoke card',
      tone: 'danger',
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await api.modules.cardAdmin.revoke(cardId, token);
      notify('Card revoked.', 'success');
      router.push(LIST_HREF);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to revoke card.', 'error');
      setRemoving(false);
    }
  }

  function cancelEdit() {
    setAlias(card?.paymentCardAlias ?? '');
    setNote(card?.paymentCardCustomerNote ?? '');
    setEditing(false);
  }

  async function reassignFunding(a: AdminPayoutAccount) {
    if (!card) return;
    const ok = await confirm({
      title: 'Change funding account?',
      message: `This card will be funded by ${a.payoutAccountAlias ?? a.payoutAccountBankName ?? 'the selected account'}. This also reassigns the card owner to the account's party. This is a sensitive change and is audited.`,
      confirmLabel: 'Change funding account',
      tone: 'danger',
    });
    if (!ok) return;
    setReassigningFunding(true);
    try {
      await api.modules.cardAdmin.reassignFunding(cardId, a.payoutAccountInstanceReference, token);
      notify('Funding account changed.', 'success');
      await load();
    } catch (e) {
      if (e instanceof Error && e.message === 'managed_externally') notify('Capability managed by an external provider.', 'error');
      else notify(e instanceof Error ? e.message : 'Failed to change funding account.', 'error');
    } finally {
      setReassigningFunding(false);
    }
  }

  const label = card?.paymentCardAlias || card?.paymentCardNetwork
    || (card?.paymentCardMaskedPanDisplay ? `Card ${card.paymentCardMaskedPanDisplay.slice(-4)}` : 'Card');

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[
        { label: 'Home', href: '/system' },
        { label: 'Modules', href: '/system/admin/modules' },
        { label: 'Card Issuer', href: '/system/admin/modules/card-issuer' },
        { label: 'Cards', href: LIST_HREF },
        { label },
      ]} />

      <Link href={LIST_HREF} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={14} /> Back to cards
      </Link>

      {!ready ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : managedExternally ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3 text-sm text-amber-800">
          <ShieldAlert size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <p>This capability is managed by an external provider; built-in administration is disabled.</p>
        </div>
      ) : notFound || !card ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          This card could not be found.
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-lg bg-[#001E2B] flex items-center justify-center shrink-0">
                  <CreditCard size={22} className="text-[#00ED64]" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-[#001E2B] truncate">{label}</h1>
                  <p className="text-sm text-gray-500 font-mono mt-0.5">{card.paymentCardMaskedPanDisplay}{card.paymentCardNetwork ? ` · ${card.paymentCardNetwork}` : ''}</p>
                </div>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded font-medium ${statusClass(card.paymentCardStatus)}`}>
                {card.paymentCardStatus}
              </span>
            </div>
          </div>

          {/* Card details */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Card details</h2>
            <dl className="divide-y text-sm">
              {/* Cardholder: derived PII from the linked party (need-to-know, audited). */}
              <DetailRow label="Cardholder" value={card.ownerName ?? undefined}
                hint={debugMode ? 'derived PII; need-to-know' : undefined} />
              <DetailRow label="Network" value={card.paymentCardNetwork} />
              <DetailRow label="Masked number" value={card.paymentCardMaskedPanDisplay} mono />
              {card.paymentCardBin && <DetailRow label="BIN" value={card.paymentCardBin} mono />}
              {card.paymentCardLast4 && <DetailRow label="Last 4" value={card.paymentCardLast4} mono />}
              {/* Full PAN (FR-30.16): masked by default; ephemeral reveal on demand (cards:manage). */}
              {canManage && (
                <SensitiveReveal label="Full PAN" masked={card.paymentCardMaskedPanDisplay}
                  hint={debugMode ? 'ephemeral; not stored' : undefined}
                  fetchValue={async () => (await api.modules.cardAdmin.revealPan(cardId, token)).pan} />
              )}
              {/* CVV: never stored; ephemeral reveal on demand (cards:manage). */}
              {canManage && (
                <SensitiveReveal label="CVV"
                  hint={debugMode ? 'ephemeral; not stored' : undefined}
                  fetchValue={async () => (await api.modules.cardAdmin.revealCvv(cardId, token)).cvv} />
              )}
              <DetailRow label="Expires" value={card.paymentCardExpirationDate} mono
                hint={debugMode ? 'QE:none; need-to-know' : undefined} />
              <DetailRow label="Card token" value={card.paymentCardReference} mono
                hint={debugMode ? 'PAN surrogate; not CHD' : undefined} />
              <DetailRow label="Status" value={card.paymentCardStatus} />
              <DetailRow label="Preferred" value={card.paymentCardIsPreferred ? 'Yes' : 'No'} />
              {card.paymentCardMandateStatus && (
                <DetailRow label="Recurring mandate" value={card.paymentCardMandateStatus} />
              )}
              <DetailRow label="Agreement" value={card.customerAgreementInstanceReference} mono />
              {card.fundingPayoutAccountInstanceReference && (
                <DetailRow label="Funding account" value={card.fundingPayoutAccountInstanceReference} mono />
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
            <p className="text-xs text-gray-400 pt-1">Cardholder is derived from the linked party (need-to-know, audited). Full PAN and CVV are never stored. Any reveal is ephemeral (on demand, re-hideable), routed via the card provider and audited server-side (PCI DSS Req 3.2/3.3, Req 10).</p>
          </div>

          {/* Funding account (SD-88 cardAccountReference). IBAN is hidden by default; reveal on demand. */}
          {card.fundingAccount && (
            <div className="bg-white rounded-xl border p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Landmark size={14} className="text-blue-600" />
                  </div>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Funding account</h2>
                </div>
                <Link href={`/system/admin/modules/account-information/accounts/${card.fundingAccount.payoutAccountInstanceReference}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                  View account details <ArrowRight size={13} />
                </Link>
              </div>
              <dl className="divide-y text-sm">
                <DetailRow label="Alias" value={card.fundingAccount.payoutAccountAlias} />
                <DetailRow label="Bank" value={card.fundingAccount.payoutAccountBankName} />
                <DetailRow label="Currency" value={card.fundingAccount.payoutAccountCurrency} mono />
                <DetailRow label="Status" value={card.fundingAccount.payoutAccountStatus} />
                {card.fundingAccount.payoutAccountHasIban ? (
                  <SensitiveReveal label="IBAN"
                    hint={debugMode ? 'QE-encrypted; ephemeral reveal' : undefined}
                    fetchValue={async () => (await api.modules.accountAdmin.revealIban(card.fundingAccount!.payoutAccountInstanceReference, token)).payoutAccountIban} />
                ) : (
                  <DetailRow label="IBAN" value="None" />
                )}
                <DetailRow label="Account" value={card.fundingAccount.payoutAccountInstanceReference} mono />
              </dl>
              <p className="text-xs text-gray-400 pt-1">IBAN is QE-encrypted at rest. Reveal is on demand, need-to-know and audited (GDPR Art. 5/32).</p>
            </div>
          )}

          {/* Change funding account (cards:manage). Also reassigns the owner; confirmed + audited. */}
          {canManage && (
            <div className="bg-white rounded-xl border p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Repeat size={14} className="text-amber-600" />
                </div>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Change funding account</h2>
              </div>
              <p className="text-xs text-gray-400">
                Search an owner, then pick one of their payout accounts. Changing the funding account also reassigns the card owner to that account&apos;s party. The change is confirmed and audited.
              </p>
              <FundingReassignPicker token={token} disabled={reassigningFunding} onPick={reassignFunding} notify={notify} />
            </div>
          )}

          {/* Editable metadata */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Alias &amp; note</h2>
              {!canManage ? null : !editing ? (
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
                  <p className="text-xs text-gray-400 mb-0.5">Alias</p>
                  <p className="text-gray-800">{card.paymentCardAlias || <span className="text-gray-400">No alias set</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Note</p>
                  <p className="text-gray-800 whitespace-pre-wrap">{card.paymentCardCustomerNote || <span className="text-gray-400">No note</span>}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Alias</label>
                  <input value={alias} onChange={(e) => setAlias(e.target.value.slice(0, 40))} maxLength={40}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Note</label>
                  <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 280))} maxLength={280} rows={3}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20" />
                  <p className="text-xs text-gray-400 mt-1">Display label only. Never enter a full card number or security code here.</p>
                </div>
              </div>
            )}
          </div>

          {/* Activation toggle */}
          {canManage && TOGGLEABLE_STATES.includes(card.paymentCardStatus ?? '') && (
            <div className="bg-white rounded-xl border p-5 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {ACTIVE_STATES.includes(card.paymentCardStatus ?? '') ? 'Suspend this card' : 'Activate this card'}
                </p>
                <p className="text-xs text-gray-400">
                  {ACTIVE_STATES.includes(card.paymentCardStatus ?? '')
                    ? 'Temporarily block payments. The card stays on file and can be reactivated anytime.'
                    : 'Allow payments with this card again.'}
                </p>
              </div>
              <button onClick={handleToggle} disabled={toggling}
                className={`inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border disabled:opacity-50 transition-colors ${
                  ACTIVE_STATES.includes(card.paymentCardStatus ?? '')
                    ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                    : 'border-green-200 text-green-700 hover:bg-green-50'
                }`}>
                {ACTIVE_STATES.includes(card.paymentCardStatus ?? '')
                  ? <><Pause size={15} /> {toggling ? 'Suspending…' : 'Suspend'}</>
                  : <><Play size={15} /> {toggling ? 'Activating…' : 'Activate'}</>}
              </button>
            </div>
          )}

          {/* Danger zone */}
          {canManage && (
          <div className="bg-white rounded-xl border border-red-100 p-5 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium text-gray-800">Revoke this card</p>
              <p className="text-xs text-gray-400">The card is revoked (soft-delete); the record is retained for audit.</p>
            </div>
            <button onClick={handleRevoke} disabled={removing}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
              <Trash2 size={15} /> {removing ? 'Revoking…' : 'Revoke card'}
            </button>
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

// Two-step funding picker: search an owner (party) by name, then pick one of their payout accounts.
// Reuses the account-information module search + list endpoints (accountAdmin).
function FundingReassignPicker({ token, onPick, disabled, notify }: {
  token: string;
  onPick: (a: AdminPayoutAccount) => void;
  disabled?: boolean;
  notify: (m: string, t: 'success' | 'error') => void;
}) {
  const [query, setQuery] = useState('');
  const [parties, setParties] = useState<PartyOwnerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [party, setParty] = useState<PartyOwnerResult | null>(null);
  const [accounts, setAccounts] = useState<AdminPayoutAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  useEffect(() => {
    if (party) return;
    const q = query.trim();
    if (q.length < 2) { setParties([]); setSearched(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.modules.accountAdmin.searchParties(q, token);
        if (!cancelled) { setParties(r.results); setSearched(true); }
      } catch (e) {
        if (!cancelled) {
          setParties([]); setSearched(true);
          if (e instanceof Error && e.message === 'managed_externally') notify('Capability managed by an external provider.', 'error');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, token, party, notify]);

  useEffect(() => {
    if (!party) return;
    let cancelled = false;
    setLoadingAccounts(true);
    api.modules.accountAdmin.list({ party: party.partyInstanceReference, limit: 50 }, token)
      .then((r) => { if (!cancelled) setAccounts(r.results); })
      .catch((e) => {
        if (!cancelled) {
          setAccounts([]);
          if (e instanceof Error && e.message === 'managed_externally') notify('Capability managed by an external provider.', 'error');
          else notify(e instanceof Error ? e.message : 'Could not load payout accounts.', 'error');
        }
      })
      .finally(() => { if (!cancelled) setLoadingAccounts(false); });
    return () => { cancelled = true; };
  }, [party, token, notify]);

  if (party) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 truncate">Owner: <span className="text-gray-800 font-medium">{party.ownerName ?? 'Unnamed owner'}</span></span>
          <button type="button" onClick={() => { setParty(null); setAccounts([]); }} className="text-xs text-[#001E2B] hover:underline shrink-0">Change owner</button>
        </div>
        {loadingAccounts ? (
          <p className="text-xs text-gray-400">Loading payout accounts…</p>
        ) : accounts.length === 0 ? (
          <p className="text-xs text-gray-400">This owner has no payout accounts.</p>
        ) : (
          <ul className="border rounded-lg divide-y max-h-48 overflow-y-auto">
            {accounts.map((a) => (
              <li key={a.payoutAccountInstanceReference}>
                <button type="button" onClick={() => onPick(a)} disabled={disabled}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors disabled:opacity-50">
                  <span className="text-gray-800 font-medium">
                    {a.payoutAccountAlias ?? a.payoutAccountBankName ?? 'Payout account'}
                    {a.payoutAccountCurrency ? ` · ${a.payoutAccountCurrency}` : ''}
                  </span>
                  <span className="block text-xs text-gray-400 font-mono truncate">{a.payoutAccountInstanceReference}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled}
          className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm disabled:opacity-50" placeholder="Search owner by name" />
      </div>
      {searching && <p className="text-xs text-gray-400">Searching…</p>}
      {parties.length > 0 && (
        <ul className="border rounded-lg divide-y max-h-48 overflow-y-auto">
          {parties.map((r) => (
            <li key={r.partyInstanceReference}>
              <button type="button" onClick={() => setParty(r)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
                <span className="text-gray-800 font-medium">{r.ownerName ?? 'Unnamed owner'}</span>
                <span className="block text-xs text-gray-400 font-mono truncate">{r.partyInstanceReference}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && !searching && parties.length === 0 && (
        <p className="text-xs text-gray-400">No matching owner.</p>
      )}
    </div>
  );
}

export default function CardAdminDetailPage() {
  return (
    <RequirePermission resource="cards" action="view">
      <CardAdminDetail />
    </RequirePermission>
  );
}

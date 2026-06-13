'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, CreditCard, Pause, Pencil, Play, Save, Star, Trash2, X } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { useDebugMode } from '../../../../lib/debugMode';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';

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
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

  // Edit state (alias + note only)
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async (t: string, agId: string) => {
    try {
      const c = await api.customer.getCardById(agId, cardId, t) as unknown as CardDetail;
      setCard(c);
      setAlias(c.paymentCardAlias ?? '');
      setNote(c.paymentCardCustomerNote ?? '');
    } catch {
      setNotFound(true);
    }
  }, [cardId]);

  useEffect(() => {
    const t = getToken() ?? '';
    const role = t ? decodeToken(t)?.role : null;
    if (role !== 'customer') { router.replace('/system'); return; }
    setToken(t);
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
      router.push('/system/cards');
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
        message: 'While deactivated, any payment with this card will be declined by the PSP — even though the card itself remains valid. You can reactivate it at any time.',
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

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Link href="/system/cards" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#001E2B] transition-colors">
        <ChevronLeft size={15} /> Payment Methods
      </Link>

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
              <span className={`text-xs px-2.5 py-1 rounded font-medium shrink-0 ${statusClass(card.paymentCardStatus)}`}>
                {card.paymentCardStatus}
              </span>
            </div>

            {card.paymentCardStatus === 'suspended' && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm text-amber-800">
                <Pause size={15} className="text-amber-600 mt-0.5 shrink-0" />
                <span>This card is <strong>deactivated</strong>. Any payment with it will be declined by the PSP, even though the card itself is still valid. Reactivate it below to use it again.</span>
              </div>
            )}
          </div>

          {/* Card details */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Card details</h2>
            <dl className="divide-y text-sm">
              <DetailRow label="Network" value={card.paymentCardNetwork} />
              <DetailRow label="Masked number" value={card.paymentCardMaskedPanDisplay} mono />
              <DetailRow label="Expires" value={card.paymentCardExpirationDate} mono
                hint={debugMode ? 'QE:none — owner-visible' : undefined} />
              <DetailRow label="Card token" value={card.paymentCardReference} mono
                hint={debugMode ? 'PAN surrogate — not CHD' : undefined} />
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

          {/* Editable metadata — the ONLY mutable attributes of a saved card */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nickname &amp; note</h2>
                {debugMode && <span className="text-xs font-mono text-gray-300">paymentCardAlias · paymentCardCustomerNote</span>}
              </div>
              {!editing ? (
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

          {/* Activation toggle — only for customer-toggleable states (active ↔ suspended) */}
          {(card.paymentCardStatus === 'active' || card.paymentCardStatus === 'suspended') && (
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

          {/* Danger zone */}
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
        <span className={`text-gray-800 text-right truncate ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
      </span>
    </div>
  );
}

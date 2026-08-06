'use client';
// BIAN SD-66: Payout Account Detail, Customer Account Detail Page (v17 Phase C)
// PCI DSS Req 3.3: IBAN never shown in full. GDPR: account holder data visible to data subject only.
// PCI DSS Req 7: partyRef from JWT must match account's partyInstanceReference (enforced backend).

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Landmark, CreditCard, CheckCircle2, XCircle, Clock, Star, Trash2, Save, X, Lock, Pencil, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Breadcrumb, type Crumb } from '../../../../components/Breadcrumb';
import { Pagination } from '../../../../components/Pagination';
import { RequirePermission } from '../../../../components/RequirePermission';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayoutAccount {
  payoutAccountInstanceReference: string;
  partyInstanceReference: string;
  payoutAccountType: string;
  payoutAccountStatus: string;
  payoutAccountCurrency: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountHolderName?: string;
  payoutAccountBicSwift?: string;
  payoutAccountCorrespondentBic?: string;
  payoutAccountBankAddress?: string;
  payoutAccountIsDefault: boolean;
  payoutAccountPreferredRail: string;
  payoutAccountCountryCode?: string;
  payoutAccountHasIban?: boolean;
  payoutAccountHasRoutingNumber?: boolean;
  payoutAccountBalance?: {
    availableAmount: number;
    pendingAmount: number;
    reservedAmount: number;
    currency: string;
  };
  recordCreatedDateTime: string;
}

interface AccountMovement {
  movementId: string;
  movementType: string;
  direction: 'debit' | 'credit';
  amount: number;
  currency: string;
  description: string;
  counterpartyName?: string;
  counterpartyRef?: string;
  status: string;
  occurredAt: string;
  balanceAfter?: number;
  sourceCollection: string;
  sourceRef: string;
}

const STATUS_CFG: Record<string, { icon: typeof CheckCircle2; cls: string }> = {
  active:    { icon: CheckCircle2, cls: 'bg-green-50 text-green-700 border-green-200' },
  suspended: { icon: Clock,        cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  closed:    { icon: XCircle,      cls: 'bg-gray-100 text-gray-500 border-gray-200' },
};

const TYPE_LABELS: Record<string, string> = {
  bank_account:    'Bank Account',
  wallet:          'Wallet',
  internal_ledger: 'PSP Ledger',
};

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  card_debit:          'Card Debit',
  card_refund:         'Card Refund',
  payout_disbursement: 'Payout',
  balance_credit:      'Credit',
  p2p_sent:            'P2P Sent',
  p2p_received:        'P2P Received',
};

// Movement types whose detail resolves at /system/payment/history/:id
// (card transactions via getById, payment executions via getTransfer). balance_credit
// has no detail page, so those rows are rendered non-clickable.
const LINKABLE_MOVEMENT_TYPES = new Set([
  'card_debit', 'card_refund', 'payout_disbursement', 'p2p_sent', 'p2p_received',
]);

const RAIL_LABELS: Record<string, string> = {
  sepa:            'SEPA',
  ach:             'ACH',
  local_bank:      'Local Bank',
  internal_wallet: 'Internal Wallet',
  internal_ledger: 'Internal Ledger',
};

// Copy-to-clipboard affordance for a bank-detail value (IBAN, BIC, holder name, …).
// Owner-scoped page, so copying the plaintext is safe (same trust boundary as the reveal).
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clear any pending reset on unmount so the timer never fires setState after the component is gone.
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard unavailable, no-op */ }
      }}
      title={copied ? 'Copied' : `Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shrink-0"
    >
      {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { icon: Clock, cls: 'bg-gray-100 text-gray-500 border-gray-200' };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      <Icon size={11} />
      {status}
    </span>
  );
}

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

function fmtDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface LinkedCard {
  paymentCardInstanceReference: string;
  paymentCardMaskedPanDisplay: string;
  paymentCardNetwork: string;
  paymentCardStatus: string;
  paymentCardIsPreferred: boolean;
  paymentCardAlias?: string;
  recordCreatedDateTime: string;
}

const CARD_STATUS_CLS: Record<string, string> = {
  active:    'bg-green-50 text-green-700 border-green-200',
  suspended: 'bg-amber-50 text-amber-700 border-amber-200',
  revoked:   'bg-red-50 text-red-700 border-red-200',
};

const MOVEMENT_LIMIT = 20;

export default function AccountDetailPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params?.accountId as string;
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();

  const [token, setToken] = useState('');
  const [partyRef, setPartyRef] = useState('');
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [ready, setReady] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // v27 staff-target mode: an investigator/auditor inspecting a found customer's account. Read-only
  // (no account mutations); partyRef comes from the query, not the caller's JWT. Server re-enforces.
  const [staffMode, setStaffMode] = useState(false);
  const [staffCustomerId, setStaffCustomerId] = useState<string | null>(null);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [alias, setAlias] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [bankName, setBankName] = useState('');
  const [holderName, setHolderName] = useState('');
  const [bicSwift, setBicSwift] = useState('');
  const [correspondentBic, setCorrespondentBic] = useState('');
  const [bankAddress, setBankAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);

  // Movements state, loaded once in full, then filtered/searched/paginated in-memory
  // (standard pattern, mirrors /system/payment/history). Running balance (balanceAfter)
  // is computed server-side over the complete set, so it stays correct under any filter.
  const [allMovements, setAllMovements] = useState<AccountMovement[]>([]);
  const [movPage, setMovPage] = useState(1);
  const [movPageSize, setMovPageSize] = useState(MOVEMENT_LIMIT);
  const [movDirection, setMovDirection] = useState('');
  const [movType, setMovType] = useState('');
  const [movQInput, setMovQInput] = useState('');
  const [movQ, setMovQ] = useState('');
  const [movLoading, setMovLoading] = useState(false);

  // Linked cards state, full set loaded once, filtered/searched/paginated in-memory
  const [linkedCards, setLinkedCards] = useState<LinkedCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardPage, setCardPage] = useState(1);
  const [cardPageSize, setCardPageSize] = useState(MOVEMENT_LIMIT);
  const [cardStatus, setCardStatus] = useState('');
  const [cardQInput, setCardQInput] = useState('');
  const [cardQ, setCardQ] = useState('');

  // IBAN reveal state
  const [ibanRevealed, setIbanRevealed] = useState(false);
  const [ibanValue, setIbanValue] = useState<string | null>(null);
  const [ibanLoading, setIbanLoading] = useState(false);

  const loadMovements = useCallback(async (t: string, pRef: string, aRef: string) => {
    setMovLoading(true);
    try {
      // Load the full ledger once (backend computes running balance over the complete set),
      // then filter/search/paginate client-side.
      const r = await api.accounts.movements(pRef, aRef, t, { page: 1, limit: 100 });
      setAllMovements(r.movements as unknown as AccountMovement[]);
    } catch {
      // non-blocking
    } finally {
      setMovLoading(false);
    }
  }, []);

  const load = useCallback(async (t: string, pRef: string) => {
    try {
      const a = await api.accounts.get(pRef, accountId, t) as unknown as PayoutAccount;
      setAccount(a);
      setAlias(a.payoutAccountAlias ?? '');
      setIsDefault(a.payoutAccountIsDefault);
      setBankName(a.payoutAccountBankName ?? '');
      setHolderName(a.payoutAccountHolderName ?? '');
      setBicSwift(a.payoutAccountBicSwift ?? '');
      setCorrespondentBic(a.payoutAccountCorrespondentBic ?? '');
      setBankAddress(a.payoutAccountBankAddress ?? '');
      await loadMovements(t, pRef, accountId);
      // Load linked cards (non-blocking, failure hides the section silently)
      setCardsLoading(true);
      api.accounts.cards(pRef, accountId, t)
        .then((r) => setLinkedCards(r.results as unknown as LinkedCard[]))
        .catch(() => setLinkedCards([]))
        .finally(() => setCardsLoading(false));
    } catch {
      setNotFound(true);
    }
  }, [accountId, loadMovements]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = getToken() ?? '';
    const decoded = t ? decodeToken(t) : null;
    const role = decoded?.role;
    const sp = new URLSearchParams(window.location.search);
    // Any non-customer role may drill down; the server enforces accounts:view and the party scope.
    const isStaffCtx = sp.get('ctx') === 'staff' && !!role && role !== 'customer';

    if (isStaffCtx) {
      // Staff read the target party's account (partyRef supplied by the profile drill-down).
      const pRef = sp.get('partyRef') ?? '';
      if (!t || !pRef) { router.replace('/system'); return; }
      setToken(t);
      setPartyRef(pRef);
      setStaffMode(true);
      setStaffCustomerId(sp.get('customerId'));
      load(t, pRef).finally(() => setReady(true));
      return;
    }

    // Self-service is unchanged: partyRef from the caller's JWT.
    const pRef = decoded?.partyRef ?? '';
    if (!t || !pRef) { router.replace('/system'); return; }
    setToken(t);
    setPartyRef(pRef);
    load(t, pRef).finally(() => setReady(true));
  }, [router, load]);

  // Format IBAN in groups of 4: ES9121000418... → ES91 2100 0418 ...
  function fmtIban(iban: string) {
    return iban.replace(/(.{4})/g, '$1 ').trim();
  }

  async function toggleIban() {
    if (ibanRevealed) {
      setIbanRevealed(false);
      return;
    }
    if (ibanValue !== null) {
      setIbanRevealed(true);
      return;
    }
    setIbanLoading(true);
    try {
      const r = await api.accounts.revealIban(partyRef, accountId, token);
      setIbanValue(r.payoutAccountIban);
      setIbanRevealed(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Cannot reveal IBAN.', 'error');
    } finally {
      setIbanLoading(false);
    }
  }

  const BIC_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

  async function handleSave() {
    if (!account) return;
    if (bicSwift && !BIC_RE.test(bicSwift.trim().toUpperCase())) {
      notify('Invalid BIC/SWIFT format, must be 8 or 11 characters (e.g. DEUTDEDB or DEUTDEDBXXX).', 'error');
      return;
    }
    if (correspondentBic && !BIC_RE.test(correspondentBic.trim().toUpperCase())) {
      notify('Invalid correspondent BIC format.', 'error');
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        payoutAccountAlias: alias,
        payoutAccountIsDefault: isDefault,
        payoutAccountBankName: bankName,
        payoutAccountHolderName: holderName,
      };
      if (bicSwift.trim()) patch.payoutAccountBicSwift = bicSwift.trim().toUpperCase();
      if (correspondentBic.trim()) patch.payoutAccountCorrespondentBic = correspondentBic.trim().toUpperCase();
      if (bankAddress.trim()) patch.payoutAccountBankAddress = bankAddress.trim();
      await api.accounts.update(partyRef, accountId, patch, token);
      notify('Account updated.', 'success');
      setAccount((prev) => prev ? {
        ...prev,
        payoutAccountAlias: alias, payoutAccountIsDefault: isDefault,
        payoutAccountBankName: bankName, payoutAccountHolderName: holderName,
        payoutAccountBicSwift: bicSwift.trim().toUpperCase() || undefined,
        payoutAccountCorrespondentBic: correspondentBic.trim().toUpperCase() || undefined,
        payoutAccountBankAddress: bankAddress.trim() || undefined,
      } : prev);
      setEditOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update account.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    if (!account) return;
    setAlias(account.payoutAccountAlias ?? '');
    setIsDefault(account.payoutAccountIsDefault);
    setBankName(account.payoutAccountBankName ?? '');
    setHolderName(account.payoutAccountHolderName ?? '');
    setBicSwift(account.payoutAccountBicSwift ?? '');
    setCorrespondentBic(account.payoutAccountCorrespondentBic ?? '');
    setBankAddress(account.payoutAccountBankAddress ?? '');
    setEditOpen(false);
  }

  async function handleClose() {
    if (!account) return;
    const ok = await confirm({
      title: 'Close this account?',
      message: `${account.payoutAccountAlias || account.payoutAccountBankName || 'This account'} will be closed. This action cannot be undone.`,
      confirmLabel: 'Close account',
      tone: 'danger',
    });
    if (!ok) return;
    setClosing(true);
    try {
      await api.accounts.close(partyRef, accountId, token);
      notify('Account closed.', 'success');
      router.push('/system/accounts');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to close account.', 'error');
      setClosing(false);
    }
  }

  function applyMovSearch() { setMovPage(1); setMovQ(movQInput.trim().toLowerCase()); }
  function clearMovFilters() { setMovDirection(''); setMovType(''); setMovQInput(''); setMovQ(''); setMovPage(1); }
  const movIsFiltering = !!(movDirection || movType || movQ || movQInput);

  // Filter → search → paginate, all in-memory over the full loaded ledger.
  const movFiltered = allMovements.filter((m) => {
    if (movDirection && m.direction !== movDirection) return false;
    if (movType && m.movementType !== movType) return false;
    if (!movQ) return true;
    return (
      (m.description ?? '').toLowerCase().includes(movQ) ||
      (m.counterpartyName ?? '').toLowerCase().includes(movQ) ||
      (m.counterpartyRef ?? '').toLowerCase().includes(movQ) ||
      (MOVEMENT_TYPE_LABELS[m.movementType] ?? m.movementType).toLowerCase().includes(movQ) ||
      m.movementId.toLowerCase().includes(movQ) ||
      String(m.amount).includes(movQ)
    );
  });
  const movTotalPages = Math.max(1, Math.ceil(movFiltered.length / movPageSize));
  const movPaginated = movFiltered.slice((movPage - 1) * movPageSize, movPage * movPageSize);

  function applyCardSearch() { setCardPage(1); setCardQ(cardQInput.trim().toLowerCase()); }
  function clearCardFilters() { setCardStatus(''); setCardQInput(''); setCardQ(''); setCardPage(1); }
  const cardIsFiltering = !!(cardStatus || cardQ || cardQInput);

  const cardFiltered = linkedCards.filter((c) => {
    if (cardStatus && c.paymentCardStatus !== cardStatus) return false;
    if (!cardQ) return true;
    return (
      (c.paymentCardAlias ?? '').toLowerCase().includes(cardQ) ||
      (c.paymentCardMaskedPanDisplay ?? '').toLowerCase().includes(cardQ) ||
      (c.paymentCardNetwork ?? '').toLowerCase().includes(cardQ) ||
      (c.paymentCardStatus ?? '').toLowerCase().includes(cardQ) ||
      c.paymentCardInstanceReference.toLowerCase().includes(cardQ)
    );
  });
  const cardTotalPages = Math.max(1, Math.ceil(cardFiltered.length / cardPageSize));
  const cardPaginated = cardFiltered.slice((cardPage - 1) * cardPageSize, cardPage * cardPageSize);
  const cardStatusKeys = Array.from(new Set(linkedCards.map((c) => c.paymentCardStatus)));

  const accountLabel = account?.payoutAccountAlias || account?.payoutAccountBankName || 'Account';
  const crumbs: Crumb[] = staffMode
    ? [
        { label: 'Home', href: '/system' },
        { label: 'Users', href: '/system/users' },
        { label: 'Customer', href: staffCustomerId ? `/system/users/${staffCustomerId}` : '/system/users' },
        { label: accountLabel },
      ]
    : [
        { label: 'Home', href: '/system' },
        { label: 'Accounts', href: '/system/accounts' },
        { label: accountLabel },
      ];

  const dirty =
    alias !== (account?.payoutAccountAlias ?? '') ||
    isDefault !== (account?.payoutAccountIsDefault ?? false) ||
    bankName !== (account?.payoutAccountBankName ?? '') ||
    holderName !== (account?.payoutAccountHolderName ?? '') ||
    bicSwift !== (account?.payoutAccountBicSwift ?? '') ||
    correspondentBic !== (account?.payoutAccountCorrespondentBic ?? '') ||
    bankAddress !== (account?.payoutAccountBankAddress ?? '');

  return (
    <RequirePermission resource="accounts" action="view">
      <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
        {ready && <Breadcrumb items={crumbs} />}

        {!ready ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : notFound || !account ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
            This account could not be found or you do not have access to it.
            <Link href="/system/accounts" className="ml-2 underline">Back to accounts</Link>
          </div>
        ) : (
          <>
            {/* Account header */}
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-lg bg-[#001E2B] flex items-center justify-center shrink-0">
                    <Landmark size={22} className="text-[#00ED64]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-lg font-bold text-[#001E2B] truncate">{accountLabel}</h1>
                      {account.payoutAccountIsDefault && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-amber-500">
                          <Star size={12} className="fill-amber-400 text-amber-400" /> Default
                        </span>
                      )}
                    </div>
                    {account.payoutAccountBankName && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {/* PCI Req 3.3: display bank name only, never full IBAN */}
                        {account.payoutAccountBankName}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200 font-medium">
                    {TYPE_LABELS[account.payoutAccountType] ?? account.payoutAccountType}
                  </span>
                  <StatusBadge status={account.payoutAccountStatus} />
                </div>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm pt-2 border-t">
                <div>
                  <dt className="text-xs text-gray-500">Currency</dt>
                  <dd className="font-medium text-gray-800">{account.payoutAccountCurrency}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Rail</dt>
                  <dd className="font-medium text-gray-800">{RAIL_LABELS[account.payoutAccountPreferredRail] ?? account.payoutAccountPreferredRail}</dd>
                </div>
                {account.payoutAccountCountryCode && (
                  <div>
                    <dt className="text-xs text-gray-500">Country</dt>
                    <dd className="font-medium text-gray-800">{account.payoutAccountCountryCode}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-gray-500">Registered</dt>
                  <dd className="font-medium text-gray-800">{fmtDate(account.recordCreatedDateTime)}</dd>
                </div>
              </dl>
            </div>

            {/* Balance panel */}
            {account.payoutAccountBalance && (
              <div className="bg-white rounded-xl border p-5 space-y-3">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">PSP Internal Ledger Balance</h2>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Available', amount: account.payoutAccountBalance.availableAmount, cls: 'text-green-700' },
                    { label: 'Pending',   amount: account.payoutAccountBalance.pendingAmount,   cls: 'text-amber-700' },
                    { label: 'Reserved',  amount: account.payoutAccountBalance.reservedAmount,  cls: 'text-gray-600' },
                  ].map(({ label, amount, cls }) => (
                    <div key={label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className={`text-base font-bold ${cls}`}>{fmtAmount(amount, account.payoutAccountBalance!.currency)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Non-bank accounts (PSP internal ledger, wallet) have no external routing details
                (IBAN/BIC/holder) by design, show an explanatory note instead of an empty bank card. */}
            {account.payoutAccountStatus !== 'closed' && account.payoutAccountType !== 'bank_account' && (
              <div className="bg-white rounded-xl border p-5">
                <div className="flex items-start gap-2 text-sm text-gray-500">
                  <Landmark size={14} className="text-gray-400 mt-0.5 shrink-0" />
                  <span>
                    {account.payoutAccountType === 'internal_ledger'
                      ? 'This is a PSP internal ledger, an in-house balance account with no external bank routing (no IBAN, BIC, or holder details).'
                      : 'This is a wallet balance, it has no external bank routing details (no IBAN or BIC).'}
                  </span>
                </div>
              </div>
            )}

            {/* Bank details + Edit section, only for external bank accounts */}
            {account.payoutAccountStatus !== 'closed' && account.payoutAccountType === 'bank_account' && (
              <div className="bg-white rounded-xl border p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Bank details</h2>
                  {staffMode ? null : !editOpen ? (
                    <button
                      onClick={() => setEditOpen(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={cancelEdit} disabled={saving}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                        <X size={12} /> Cancel
                      </button>
                      <button onClick={handleSave} disabled={saving || !dirty}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#001E2B] text-[#00ED64] hover:opacity-90 disabled:opacity-50 transition-opacity">
                        <Save size={12} /> {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>

                {!editOpen ? (
                  /* Read-only view */
                  <dl className="divide-y text-sm">
                    {[
                      { label: 'Holder name', value: account.payoutAccountHolderName },
                      { label: 'Bank name', value: account.payoutAccountBankName },
                      { label: 'BIC / SWIFT', value: account.payoutAccountBicSwift, mono: true },
                      { label: 'Corr. bank BIC', value: account.payoutAccountCorrespondentBic, mono: true },
                      { label: 'Bank address', value: account.payoutAccountBankAddress },
                      { label: 'Nickname', value: account.payoutAccountAlias },
                    ].filter(f => f.value).map(({ label, value, mono }) => (
                      <div key={label} className="flex justify-between items-center py-2.5 gap-4">
                        <span className="text-gray-500 shrink-0">{label}</span>
                        <div className="flex items-center gap-1 min-w-0">
                          <span className={`text-gray-800 text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
                          <CopyButton value={value as string} label={label} />
                        </div>
                      </div>
                    ))}
                    {/* IBAN, QE-encrypted; reveal on demand for owner / L2 / auditor */}
                    {account.payoutAccountHasIban && (
                      <div className="flex justify-between items-center py-2.5 gap-4">
                        <span className="text-gray-500 shrink-0 flex items-center gap-1">
                          <Lock size={11} className="text-gray-400" /> IBAN
                        </span>
                        <div className="flex items-center gap-2">
                          {ibanRevealed && ibanValue ? (
                            <span className="font-mono text-sm text-gray-800 tracking-wider">{fmtIban(ibanValue)}</span>
                          ) : (
                            <span className="font-mono text-sm text-gray-400 tracking-widest select-none">
                              •••• •••• •••• •••• ••••
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={toggleIban}
                            disabled={ibanLoading}
                            title={ibanRevealed ? 'Hide IBAN' : 'Reveal IBAN (PCI DSS Req 3.3)'}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                          >
                            {ibanLoading ? (
                              <span className="text-xs">…</span>
                            ) : ibanRevealed ? (
                              <EyeOff size={14} />
                            ) : (
                              <Eye size={14} />
                            )}
                          </button>
                          {/* Copy the raw (unformatted) IBAN, only once revealed */}
                          {ibanRevealed && ibanValue && <CopyButton value={ibanValue} label="IBAN" />}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <input type="checkbox" checked={account.payoutAccountIsDefault} readOnly className="w-4 h-4 accent-[#00ED64]" />
                      <span className="text-sm text-gray-600">Primary account</span>
                    </div>
                  </dl>
                ) : (
                  /* Edit form */
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Holder name <span className="text-xs text-gray-400">(max 140)</span></label>
                        <input
                          type="text"
                          value={holderName}
                          onChange={(e) => setHolderName(e.target.value.slice(0, 140))}
                          maxLength={140}
                          placeholder="Full legal name"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Bank name <span className="text-xs text-gray-400">(max 100)</span></label>
                        <input
                          type="text"
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value.slice(0, 100))}
                          maxLength={100}
                          placeholder="e.g. Deutsche Bank"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">BIC / SWIFT <span className="text-xs text-gray-400">ISO 9362 · 8 or 11 chars</span></label>
                        <input
                          type="text"
                          value={bicSwift}
                          onChange={(e) => setBicSwift(e.target.value.slice(0, 11))}
                          maxLength={11}
                          placeholder="e.g. DEUTDEDB"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                        />
                        {bicSwift && bicSwift.length >= 8 && BIC_RE.test(bicSwift.toUpperCase()) && (
                          <p className="flex items-center gap-1 text-xs text-green-600 mt-1"><CheckCircle2 size={11} /> Valid</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Correspondent BIC <span className="text-xs text-gray-400">optional</span></label>
                        <input
                          type="text"
                          value={correspondentBic}
                          onChange={(e) => setCorrespondentBic(e.target.value.slice(0, 11))}
                          maxLength={11}
                          placeholder="e.g. CHASUS33"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Bank address <span className="text-xs text-gray-400">(max 200)</span></label>
                      <input
                        type="text"
                        value={bankAddress}
                        onChange={(e) => setBankAddress(e.target.value.slice(0, 200))}
                        maxLength={200}
                        placeholder="e.g. Taunusanlage 12, 60325 Frankfurt, Germany"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Nickname</label>
                      <input
                        type="text"
                        value={alias}
                        onChange={(e) => setAlias(e.target.value.slice(0, 60))}
                        maxLength={60}
                        placeholder="e.g. Main savings"
                        className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isDefault}
                        onChange={(e) => setIsDefault(e.target.checked)}
                        className="w-4 h-4 accent-[#00ED64]"
                      />
                      <span className="text-sm text-gray-700">Set as primary account</span>
                    </label>
                    {/* IBAN immutability notice */}
                    <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
                      <Lock size={13} className="mt-0.5 shrink-0" />
                      <span>
                        <strong>IBAN is immutable</strong>: it uniquely identifies the account. Use the eye icon in the read-only view to reveal it. To correct an IBAN, close this account and register a new one.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Movements */}
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Account Movements</h2>

              {/* Movement filters + search (standard pattern) */}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={movQInput}
                  onChange={(e) => setMovQInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyMovSearch(); }}
                  placeholder="Search by description, counterparty, id…"
                  className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none"
                />
                <select
                  value={movDirection}
                  onChange={(e) => { setMovDirection(e.target.value); setMovPage(1); }}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none"
                >
                  <option value="">All directions</option>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
                <select
                  value={movType}
                  onChange={(e) => { setMovType(e.target.value); setMovPage(1); }}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none"
                >
                  <option value="">All types</option>
                  <option value="card_debit">Card Debit</option>
                  <option value="card_refund">Card Refund</option>
                  <option value="payout_disbursement">Payout</option>
                  <option value="balance_credit">Balance Credit</option>
                  <option value="p2p_sent">P2P Sent</option>
                  <option value="p2p_received">P2P Received</option>
                </select>
                <button
                  onClick={applyMovSearch}
                  className="px-3 py-1.5 rounded-lg bg-[#001E2B] text-[#00ED64] text-xs font-semibold"
                >
                  Search
                </button>
                {movIsFiltering && (
                  <button
                    onClick={clearMovFilters}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-2 py-1.5"
                  >
                    <X size={11} /> Clear
                  </button>
                )}
              </div>

              {movLoading ? (
                <div className="text-sm text-gray-400 py-4 text-center">Loading movements…</div>
              ) : allMovements.length === 0 ? (
                <div className="text-sm text-gray-400 py-4 text-center">No movements yet for this account.</div>
              ) : movFiltered.length === 0 ? (
                <div className="text-sm text-gray-400 py-4 text-center">No movements match your filters.</div>
              ) : (
                <div className="divide-y">
                  {movPaginated.map((m) => {
                    // Movement detail resolves at a self-service route, so it is non-linkable in
                    // staff-target mode (staff account view stays read-only within the profile flow).
                    const linkable = !staffMode && LINKABLE_MOVEMENT_TYPES.has(m.movementType);
                    const inner = (
                      <>
                        <div className="flex items-start gap-3 min-w-0">
                          <span className={`mt-0.5 inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${
                            m.direction === 'credit'
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}>
                            {m.direction === 'credit' ? '+' : '-'}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                {MOVEMENT_TYPE_LABELS[m.movementType] ?? m.movementType}
                              </span>
                              {m.counterpartyName && (
                                <span className="text-gray-700 truncate">{m.counterpartyName}</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">{m.description}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{fmtDate(m.occurredAt)}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <div className={`font-medium tabular-nums ${m.direction === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
                              {m.direction === 'credit' ? '+' : '-'}{fmtAmount(m.amount, m.currency)}
                            </div>
                            {m.balanceAfter !== undefined && (
                              <div className="text-xs text-gray-400 tabular-nums mt-0.5">
                                Balance {fmtAmount(m.balanceAfter, m.currency)}
                              </div>
                            )}
                          </div>
                          {linkable && (
                            <span className="text-gray-300 group-hover:text-[#001E2B] transition-colors text-lg leading-none">›</span>
                          )}
                        </div>
                      </>
                    );
                    return linkable ? (
                      <Link
                        key={m.movementId}
                        href={`/system/payment/history/${m.movementId}`}
                        className="group py-3 flex items-start justify-between gap-3 text-sm -mx-5 px-5 hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div key={m.movementId} className="py-3 flex items-start justify-between gap-3 text-sm">
                        {inner}
                      </div>
                    );
                  })}
                </div>
              )}

              {movFiltered.length > 0 && (
                <Pagination
                  page={movPage}
                  totalPages={movTotalPages}
                  total={movFiltered.length}
                  limit={movPageSize}
                  onPageChange={setMovPage}
                  onLimitChange={(n) => { setMovPageSize(n); setMovPage(1); }}
                  limitOptions={[10, 20, 50]}
                  noun="movements"
                  variant="light"
                />
              )}
            </div>

            {/* Linked payment cards (BIAN SD-88 cardAccountReference) */}
            <div className="bg-white rounded-xl border p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CreditCard size={14} className="text-gray-400" />
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Linked Payment Cards</h2>
              </div>

              {/* Card filters + search (standard pattern) */}
              {!cardsLoading && linkedCards.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={cardQInput}
                    onChange={(e) => setCardQInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyCardSearch(); }}
                    placeholder="Search by alias, PAN, network, id…"
                    className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none"
                  />
                  <select
                    value={cardStatus}
                    onChange={(e) => { setCardStatus(e.target.value); setCardPage(1); }}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none"
                  >
                    <option value="">All statuses</option>
                    {cardStatusKeys.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                  <button
                    onClick={applyCardSearch}
                    className="px-3 py-1.5 rounded-lg bg-[#001E2B] text-[#00ED64] text-xs font-semibold"
                  >
                    Search
                  </button>
                  {cardIsFiltering && (
                    <button
                      onClick={clearCardFilters}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-2 py-1.5"
                    >
                      <X size={11} /> Clear
                    </button>
                  )}
                </div>
              )}

              {cardsLoading ? (
                <p className="text-sm text-gray-400 py-2">Loading cards…</p>
              ) : linkedCards.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">No payment cards linked to this account.</p>
              ) : cardFiltered.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">No cards match your filters.</p>
              ) : (
                <div className="divide-y">
                  {cardPaginated.map((c) => (
                    <Link
                      key={c.paymentCardInstanceReference}
                      href={`/system/cards/${c.paymentCardInstanceReference}${staffMode ? `?ctx=staff&customerId=${encodeURIComponent(staffCustomerId ?? '')}&partyRef=${encodeURIComponent(partyRef)}` : ''}`}
                      className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-5 px-5 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <CreditCard size={16} className="text-gray-400 shrink-0" />
                        <div>
                          <div className="text-sm font-medium text-gray-800 group-hover:text-[#001E2B]">
                            {c.paymentCardAlias || c.paymentCardMaskedPanDisplay}
                          </div>
                          {c.paymentCardAlias && (
                            <div className="text-xs text-gray-400 font-mono">{c.paymentCardMaskedPanDisplay}</div>
                          )}
                        </div>
                        {c.paymentCardIsPreferred && (
                          <Star size={12} className="text-amber-400 fill-amber-400 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-400 uppercase">{c.paymentCardNetwork}</span>
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${CARD_STATUS_CLS[c.paymentCardStatus] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                          {c.paymentCardStatus}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {cardFiltered.length > 0 && (
                <Pagination
                  page={cardPage}
                  totalPages={cardTotalPages}
                  total={cardFiltered.length}
                  limit={cardPageSize}
                  onPageChange={setCardPage}
                  onLimitChange={(n) => { setCardPageSize(n); setCardPage(1); }}
                  limitOptions={[10, 20, 50]}
                  noun="cards"
                  variant="light"
                />
              )}
            </div>

            {/* Danger zone. Hidden in staff-target mode (staff account view is strictly read-only). */}
            {!staffMode && account.payoutAccountStatus !== 'closed' && (
              <div className="bg-white rounded-xl border border-red-200 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Trash2 size={14} className="text-red-500" />
                  <h2 className="font-semibold text-gray-800 text-sm">Danger zone</h2>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Close this account</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Closes the account permanently. No payout will be sent to a closed account.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={closing}
                    className="shrink-0 border border-red-300 text-red-600 hover:bg-red-50 font-medium px-4 py-2 rounded-lg transition-colors text-sm disabled:opacity-50"
                  >
                    {closing ? 'Closing…' : 'Close account'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </RequirePermission>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  UserCheck, ArrowLeft, Mail, Phone, Check, Edit3, X, AlertTriangle, SendHorizonal, Landmark, HandCoins,
} from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { RequestMoneyModal } from '../../../../components/RequestMoneyModal';
import { useDebugMode } from '../../../../lib/debugMode';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';

interface BeneficiaryDetail {
  counterpartyArrangementReference: string;
  ownerPartyReference: string;
  counterpartyPartyReference: string;
  counterpartyLabel: string;
  counterpartyLookupType: 'phone' | 'email';
  counterpartyLookupHint: string;
  counterpartyArrangementStatus: 'active' | 'removed';
  bianServiceDomain: string;
  bianControlRecordType: string;
  recordCreatedDateTime: string;
  recordUpdatedDateTime: string;
  schemaVersion: number;
}

interface PayoutAccountOption {
  payoutAccountInstanceReference: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountCurrency: string;
  payoutAccountIsDefault: boolean;
  payoutAccountBalance?: { availableAmount: number };
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtAmount(n: number, currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n);
}

// ── Send Money Modal ──────────────────────────────────────────────────────────
interface SendMoneyModalProps {
  beneficiary: BeneficiaryDetail;
  ownerPartyRef: string;
  token: string;
  onClose: () => void;
}

function SendMoneyModal({ beneficiary, ownerPartyRef, token, onClose }: SendMoneyModalProps) {
  const [accounts, setAccounts] = useState<PayoutAccountOption[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [fromAccountRef, setFromAccountRef] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ ref: string; amount: number; currency: string } | null>(null);

  useEffect(() => {
    if (!ownerPartyRef || !token) return;
    api.accounts.list(ownerPartyRef, token, { status: 'active' })
      .then(r => {
        const accts = r.results as unknown as PayoutAccountOption[];
        setAccounts(accts);
        setAccountsLoaded(true);
        const primary = accts.find(a => a.payoutAccountIsDefault) ?? accts[0];
        if (primary) setFromAccountRef(primary.payoutAccountInstanceReference);
      })
      .catch(() => setAccountsLoaded(true));
  }, [ownerPartyRef, token]);

  function handleAccountChange(ref: string) {
    setFromAccountRef(ref);
  }

  async function handleSend() {
    const parsedAmount = parseFloat(amount);
    if (!fromAccountRef || isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Select an account and enter a valid amount.'); return;
    }
    setSending(true); setError('');
    try {
      const res = await api.beneficiaries.transfer(
        ownerPartyRef,
        beneficiary.counterpartyArrangementReference,
        { fromAccountRef, amount: parsedAmount, note: note.trim() || undefined },
        token,
      );
      setSuccess({ ref: res.transferReference, amount: parsedAmount, currency: res.currency });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed.');
    }
    setSending(false);
  }

  const selectedAccount = accounts.find(a => a.payoutAccountInstanceReference === fromAccountRef);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <SendHorizonal size={18} className="text-[#001E2B]" />
            <div>
              <h3 className="font-semibold text-gray-900">Send money</h3>
              <p className="text-xs text-gray-500">to <span className="font-medium text-gray-700">{beneficiary.counterpartyLabel}</span></p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check size={24} className="text-green-600" />
              </div>
              <p className="font-semibold text-gray-900">{fmtAmount(success.amount, success.currency)} sent</p>
              <p className="text-sm text-gray-500 mt-1">to {beneficiary.counterpartyLabel}</p>
              <p className="text-xs font-mono text-gray-400 mt-2">Ref: {success.ref.slice(0, 8)}…</p>
            </div>
            <button type="button" onClick={onClose}
              className="w-full py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {/* Source account */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">From account</label>
                {!accountsLoaded ? (
                  <div className="text-xs text-gray-400">Loading accounts…</div>
                ) : accounts.length === 0 ? (
                  <div className="text-xs text-amber-600">No active payout accounts found.</div>
                ) : (
                  <select value={fromAccountRef} onChange={e => handleAccountChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                    {accounts.map(a => (
                      <option key={a.payoutAccountInstanceReference} value={a.payoutAccountInstanceReference}>
                        {a.payoutAccountIsDefault ? '★ ' : ''}{a.payoutAccountAlias || a.payoutAccountBankName || 'Account'} · {a.payoutAccountCurrency}
                      </option>
                    ))}
                  </select>
                )}
                {selectedAccount?.payoutAccountBalance && (
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <Landmark size={11} />
                    Available: <span className="font-medium text-gray-600">{fmtAmount(selectedAccount.payoutAccountBalance.availableAmount, selectedAccount.payoutAccountCurrency)}</span>
                  </p>
                )}
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
                <div className="flex gap-2">
                  <input
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                  />
                  <span className="flex items-center px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-600">
                    {selectedAccount?.payoutAccountCurrency ?? '—'}
                  </span>
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Note <span className="text-gray-400">(optional)</span></label>
                <input value={note} onChange={e => setNote(e.target.value)} maxLength={140}
                  placeholder="e.g. Dinner split, rent contribution…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              </div>
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

            <p className="text-xs text-gray-400">
              The transfer is processed immediately. Funds are credited to the recipient's default account.
            </p>

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleSend} disabled={sending || accounts.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#001E2B] hover:bg-[#001E2B]/80 text-white rounded-lg transition-colors disabled:opacity-50">
                <SendHorizonal size={14} />
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Detail Page ───────────────────────────────────────────────────────────────
export default function BeneficiaryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { debugMode } = useDebugMode();
  const beneficiaryId = params?.beneficiaryId as string;

  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  const [ownPartyRef, setOwnPartyRef] = useState('');
  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (t) { const u = decodeToken(t); setRole(u?.role ?? ''); setOwnPartyRef(u?.partyRef ?? ''); }
  }, []);

  const isCustomer = role === 'customer';
  const canWrite = role === 'customer' || role === 'level2_investigator' || role === 'security_auditor';

  const [record, setRecord] = useState<BeneficiaryDetail | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!token || !beneficiaryId) return;
    api.beneficiaries.get(beneficiaryId, token)
      .then(setRecord)
      .catch(err => setLoadError(err instanceof Error ? err.message : 'Failed to load.'));
  }, [token, beneficiaryId]);

  // Label edit
  const [editLabel, setEditLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const [labelSaving, setLabelSaving] = useState(false);
  const [labelError, setLabelError] = useState('');
  const [labelSaved, setLabelSaved] = useState(false);

  function openEdit() { setLabelValue(record?.counterpartyLabel ?? ''); setLabelError(''); setLabelSaved(false); setEditLabel(true); }

  async function saveLabel() {
    if (!record || !labelValue.trim()) { setLabelError('Label cannot be empty.'); return; }
    setLabelSaving(true); setLabelError('');
    try {
      await api.beneficiaries.updateLabel(record.ownerPartyReference, record.counterpartyArrangementReference, labelValue.trim(), token);
      setRecord(prev => prev ? { ...prev, counterpartyLabel: labelValue.trim() } : prev);
      setLabelSaved(true); setEditLabel(false);
    } catch (err) { setLabelError(err instanceof Error ? err.message : 'Failed to save.'); }
    setLabelSaving(false);
  }

  // Send money modal
  const [showSend, setShowSend] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  // Auto-open when navigated from the list page Send quick-action button (?action=send)
  useEffect(() => {
    if (record && searchParams?.get('action') === 'send') setShowSend(true);
  }, [record, searchParams]);

  if (loadError) return (
    <div className="w-full px-5 sm:px-8 py-6">
      <button type="button" onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-5 transition-colors">
        <ArrowLeft size={14} /> Back
      </button>
      <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
        <AlertTriangle size={16} /> {loadError}
      </div>
    </div>
  );

  if (!record) return <div className="w-full px-5 sm:px-8 py-6 text-sm text-gray-400">Loading…</div>;

  const isActive = record.counterpartyArrangementStatus === 'active';
  const isOwn = isCustomer && record.ownerPartyReference === ownPartyRef;
  const canSend = isOwn && isActive;

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <button type="button" onClick={() => router.push('/system/beneficiaries')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={14} /> {isCustomer ? 'My contacts' : 'Beneficiaries'}
      </button>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <SectionHeader
            icon={UserCheck}
            title={record.counterpartyLabel}
            description={isCustomer ? 'Saved contact — tap Send to transfer money instantly.' : 'Saved contact registered for transfers and payments.'}
            debugInfo={`counterpartyArrangementReference: ${record.counterpartyArrangementReference} · schemaVersion: ${record.schemaVersion}`}
          />
        </div>
        {canSend && (
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setShowSend(true)}
              className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors">
              <SendHorizonal size={15} /> Send money
            </button>
            <button type="button" onClick={() => setShowRequest(true)}
              className="flex items-center gap-2 border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] px-5 py-2.5 rounded-xl text-sm font-medium transition-colors">
              <HandCoins size={15} /> Request money
            </button>
          </div>
        )}
      </div>

      {!isActive && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle size={15} className="shrink-0" />
          This contact has been removed and is no longer active. Records are retained for audit compliance.
        </div>
      )}

      {/* Alias card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-gray-800 text-sm">Alias</h2>
            <p className="text-xs text-gray-500 mt-0.5">Your personal label for this contact.</p>
          </div>
          {canWrite && isActive && !editLabel && (
            <button type="button" onClick={openEdit}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors">
              <Edit3 size={12} /> Edit
            </button>
          )}
        </div>

        {editLabel ? (
          <div className="space-y-3">
            <input value={labelValue} onChange={e => setLabelValue(e.target.value)} maxLength={80}
              placeholder="e.g. Mom, Landlord, Business Partner" autoFocus
              onKeyDown={e => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditLabel(false); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{80 - labelValue.length} chars remaining</span>
              <div className="flex items-center gap-2">
                {labelError && <span className="text-xs text-red-600">{labelError}</span>}
                <button type="button" onClick={() => setEditLabel(false)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors">
                  <X size={11} /> Cancel
                </button>
                <button type="button" onClick={saveLabel} disabled={labelSaving || !labelValue.trim()}
                  className="flex items-center gap-1 text-xs font-medium bg-[#001E2B] hover:bg-[#001E2B]/80 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50">
                  {labelSaving ? 'Saving…' : <><Check size={11} /> Save</>}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-2xl font-semibold text-gray-900">{record.counterpartyLabel}</span>
            {labelSaved && <span className="inline-flex items-center gap-1 text-xs text-green-600"><Check size={12} /> Saved</span>}
          </div>
        )}
      </div>

      {/* Contact details */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 text-sm mb-4">Contact details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Contact type</dt>
            <dd className="flex items-center gap-1.5 font-medium text-gray-800">
              {record.counterpartyLookupType === 'email'
                ? <><Mail size={13} className="text-blue-400" /> Email</>
                : <><Phone size={13} className="text-green-400" /> Phone</>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Masked identifier</dt>
            <dd className="font-mono text-sm text-gray-800">{record.counterpartyLookupHint}</dd>
            <dd className="text-[10px] text-gray-400 mt-0.5">Contact details are stored securely and never shown in full.</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Status</dt>
            <dd>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>{record.counterpartyArrangementStatus}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Added</dt>
            <dd className="text-gray-700">{fmtDateTime(record.recordCreatedDateTime)}</dd>
          </div>
          {/* Show internal refs to staff only */}
          {!isCustomer && (
            <>
              <div>
                <dt className="text-xs text-gray-500 mb-0.5">Owner party reference</dt>
                <dd className="font-mono text-xs text-gray-700 break-all">{record.ownerPartyReference}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 mb-0.5">Counterparty party reference</dt>
                <dd className="font-mono text-xs text-gray-700 break-all">{record.counterpartyPartyReference}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-gray-500 mb-0.5">Arrangement reference</dt>
                <dd className="font-mono text-xs text-gray-700 break-all">{record.counterpartyArrangementReference}</dd>
              </div>
            </>
          )}
        </dl>
      </div>

      {/* BIAN metadata (debug) */}
      {debugMode && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-3">BIAN metadata</h2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
            <div><dt className="text-gray-500">Service Domain</dt><dd className="font-medium text-gray-700">{record.bianServiceDomain}</dd></div>
            <div><dt className="text-gray-500">Control Record Type</dt><dd className="font-medium text-gray-700">{record.bianControlRecordType}</dd></div>
            <div><dt className="text-gray-500">Schema Version</dt><dd className="font-medium text-gray-700">{record.schemaVersion}</dd></div>
          </dl>
        </div>
      )}

      {showSend && record && (
        <SendMoneyModal
          beneficiary={record}
          ownerPartyRef={ownPartyRef}
          token={token}
          onClose={() => setShowSend(false)}
        />
      )}

      {showRequest && record && (
        <RequestMoneyModal
          beneficiary={record}
          token={token}
          onClose={() => setShowRequest(false)}
        />
      )}
    </div>
  );
}

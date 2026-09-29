'use client';
// v28 RTP detail view, rendered inside /system/payment/history/[txnId] when the id is a Request to Pay.
// Mirrors the P2P/payout detail layout (same margins, panels, Sender/Recipient sections) and adds a
// Security Review section (linked fraud case, if any). When the request is still pending the PAYER
// approval, the payer can approve/reject here (NOT from the transfer hub). Real authenticated endpoints.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X, Info, ArrowDownLeft, ArrowUpRight, ArrowLeft, ExternalLink } from 'lucide-react';
import { api, RtpRequestDTO } from '../lib/api';
import { formatAmount } from '../lib/money';

const PENDING = ['created', 'validated', 'presented', 'delivered', 'viewed'];

function fmt(n: number, ccy: string) {
  return formatAmount(n, ccy);
}

const STATUS_COLOR: Record<string, string> = {
  payment_settled: 'bg-emerald-100 text-emerald-800',
  accepted: 'bg-blue-100 text-blue-800',
  payment_initiated: 'bg-blue-100 text-blue-800',
  payment_processing: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-600',
  payment_failed: 'bg-red-100 text-red-800',
};

export function RtpDetailView({ request, token, partyRef, role, onChanged }: {
  request: RtpRequestDTO;
  token: string;
  partyRef?: string;
  role?: string;
  onChanged?: () => void;
}) {
  const [req, setReq] = useState<RtpRequestDTO>(request);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [accounts, setAccounts] = useState<Array<{ payoutAccountInstanceReference: string; payoutAccountAlias?: string; payoutAccountBankName?: string; payoutAccountCurrency: string; payoutAccountIsDefault?: boolean; payoutAccountBalance?: { availableAmount: number } }>>([]);
  const [fundingRef, setFundingRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { setReq(request); }, [request]);

  const staffRole = !!role && role !== 'customer';
  const isPayerPending = !!partyRef && req.payerPartyReference === partyRef && PENDING.includes(req.status);

  // Payer (while pending): load their active payout accounts so they can pick which one to pay FROM
  // (default preselected, changeable before confirming). This shows where the debit will land upfront.
  useEffect(() => {
    if (!token || !partyRef || !isPayerPending) return;
    api.accounts.list(partyRef, token, { status: 'active' })
      .then((r) => {
        const accts = (r.results ?? []) as unknown as typeof accounts;
        setAccounts(accts);
        const def = accts.find((a) => a.payoutAccountIsDefault) ?? accts[0];
        if (def) setFundingRef(def.payoutAccountInstanceReference);
      })
      .catch(() => setAccounts([]));
  }, [token, partyRef, isPayerPending]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timeline: the per-request event trail (created → presented → accepted → initiated → settled…),
  // so both parties see WHEN it was created, approved by the payer, and completed.
  useEffect(() => {
    if (!token) return;
    api.rtp.events(req.paymentRequestInstanceReference, token).then((r) => setEvents(r.events ?? [])).catch(() => setEvents([]));
  }, [token, req.paymentRequestInstanceReference, req.status]);

  const sc = req.securityCase ?? null;

  const pending = PENDING.includes(req.status);
  const isPayer = !!partyRef && req.payerPartyReference === partyRef;
  const isPayee = !!partyRef && req.requesterPartyReference === partyRef;
  // Money direction from the viewer's perspective: payer pays (−), payee receives (+), staff neutral.
  const direction: 'sent' | 'received' | 'neutral' = isPayer ? 'sent' : isPayee ? 'received' : 'neutral';

  async function approve() {
    setBusy(true); setMsg(null);
    try {
      const res = await api.rtp.accept(req.paymentRequestInstanceReference, { fundingAccountRef: fundingRef || undefined }, token, `rtp-accept-${req.paymentRequestInstanceReference}`);
      setMsg(res.status === 'accepted' ? 'Approved: payment on the way.': (res.reason ?? 'Could not approve.'));
      const fresh = await api.rtp.getById(req.paymentRequestInstanceReference, token).catch(() => null);
      if (fresh) setReq(fresh);
      onChanged?.();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Approval failed.'); }
    finally { setBusy(false); }
  }

  async function reject() {
    setBusy(true); setMsg(null);
    try {
      await api.rtp.reject(req.paymentRequestInstanceReference, token);
      const fresh = await api.rtp.getById(req.paymentRequestInstanceReference, token).catch(() => null);
      if (fresh) setReq(fresh);
      onChanged?.();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Reject failed.'); }
    finally { setBusy(false); }
  }

  const statusChip = pending ? (isPayer ? 'Pending your approval' : 'Awaiting payer approval') : req.status.replace(/_/g, ' ');

  return (
    <>
      <Link href="/system/payment/history" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline mb-4">
        <ArrowLeft size={14} /> Back to transactions
      </Link>

      {/* Header + Sender/Recipient (mirrors the P2P detail card) */}
      <div className="bg-white rounded-xl border p-5 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Request to Pay</h1>
            <p className="text-xs text-gray-500 mt-0.5">The recipient requested this payment; the payer approves to pay. Money moves only after approval.</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium ${direction === 'sent' ? 'bg-red-50 text-red-700 border border-red-200' : direction === 'received' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                {direction === 'sent' ? <><ArrowUpRight size={13} /> Outgoing · you pay</> : direction === 'received' ? <><ArrowDownLeft size={13} /> Incoming · you receive</> : 'Request to Pay'}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${pending ? 'bg-amber-100 text-amber-800' : STATUS_COLOR[req.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {statusChip}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{req.recordCreatedDateTime ? new Date(req.recordCreatedDateTime).toLocaleString(): '—'}</p>
            {req.purpose && <p className="text-sm text-gray-600 mt-1">{req.purpose}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className={`text-2xl font-bold ${direction === 'sent' ? 'text-red-600' : direction === 'received' ? 'text-green-700' : 'text-gray-900'}`}>
              {direction === 'sent' ? '−' : direction === 'received' ? '+' : ''}{fmt(req.amount, req.currency)}
            </p>
          </div>
        </div>

        {/* Sender / Recipient: perspective-aware privacy:
            - Payer view: sees the requester's NAME (authorized on request) + their own funding account.
            - Payee view: sees only the payer label THEY provided (beneficiary/alias) + their own receiving account.
            - Staff (L1/L2/auditor): full refs + accounts for investigation. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm border-t pt-4">
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
            <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">Sender (payer)</div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              {staffRole ? (
                <>
                  <dt className="text-gray-500">Party</dt>
                  <dd className="font-mono text-xs text-gray-800 break-all">{req.payerPartyReference ?? '—'}</dd>
                  <dt className="text-gray-500">Funding account</dt>
                  <dd className="font-mono text-xs text-gray-800 break-all">
                    {req.payerFundingAccountReference
                      ? <Link href={`/system/accounts/${req.payerFundingAccountReference}`} className="text-blue-600 hover:underline">{req.payerFundingAccountReference} <ExternalLink size={11} className="inline" /></Link>
                      : '—'}
                  </dd>
                </>
              ) : isPayer ? (
                <>
                  <dt className="text-gray-500">You</dt>
                  <dd className="text-gray-800">You are the payer</dd>
                  {isPayerPending ? (
                    // Pending: choose which account to pay FROM (default preselected, changeable).
                    <>
                      <dt className="text-gray-500">Pay from</dt>
                      <dd>
                        {accounts.length === 0 ? (
                          <span className="text-xs text-amber-600">No active account to pay from.</span>
                        ) : (
                          <select value={fundingRef} onChange={(e) => setFundingRef(e.target.value)}
                            className="block w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white">
                            {accounts.map((a) => (
                              <option key={a.payoutAccountInstanceReference} value={a.payoutAccountInstanceReference}>
                                {(a.payoutAccountAlias ?? a.payoutAccountBankName ?? 'Account')}{a.payoutAccountIsDefault ? ' (default)' : ''}
                                {a.payoutAccountBalance ? ` · ${fmt(a.payoutAccountBalance.availableAmount, a.payoutAccountCurrency)}` : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        <span className="block text-[11px] text-gray-400 mt-0.5">This account will be debited when you approve.</span>
                      </dd>
                    </>
                  ) : req.payerFundingAccountReference && (<>
                    <dt className="text-gray-500">Funding account</dt>
                    <dd className="font-mono text-xs text-gray-800 break-all">
                      <Link href={`/system/accounts/${req.payerFundingAccountReference}`} className="text-blue-600 hover:underline">{req.payerFundingAccountReference} <ExternalLink size={11} className="inline" /></Link>
                    </dd>
                  </>)}
                </>
              ) : (
                // Payee view: before approval only the label the payee chose (their own data); once the
                // payer has approved/paid, their real name is disclosed (SEPA/PSD2 debtor-name-to-creditor).
                <>
                  <dt className="text-gray-500">Payer</dt>
                  <dd className="text-gray-800">{req.payerName ?? req.payerAlias ?? 'The payer you selected'}</dd>
                  {req.payerCounterpartyReference && (<>
                    <dt className="text-gray-500">Beneficiary</dt>
                    <dd>
                      <Link href={`/system/beneficiaries/${req.payerCounterpartyReference}`} className="text-blue-600 hover:underline break-all">
                        View beneficiary <ExternalLink size={11} className="inline" />
                      </Link>
                    </dd>
                  </>)}
                  {!req.payerName && (
                    <dd className="col-span-2 text-xs text-gray-400 mt-0.5">Full payer details are shared once they approve the payment.</dd>
                  )}
                </>
              )}
            </dl>
          </div>

          <div className="bg-green-50 rounded-lg p-3 border border-green-100">
            <div className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Recipient (payee) · requested this payment</div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              {/* Requester name: authorized to the payer (requesting is the consent). */}
              <dt className="text-gray-500">Name</dt>
              <dd className="text-gray-800">{req.payeeName ?? (isPayee ? 'You': '—')}</dd>
              {/* Destination account: bank + masked IBAN so the PAYER sees where the money goes. */}
              {req.payeeAccountDisplay?.bankName && (<>
                <dt className="text-gray-500">Destination bank</dt>
                <dd className="text-gray-800">{req.payeeAccountDisplay.bankName}</dd>
              </>)}
              {req.payeeAccountDisplay?.maskedIban && (<>
                <dt className="text-gray-500">Destination IBAN</dt>
                <dd className="font-mono text-xs text-gray-800">{req.payeeAccountDisplay.maskedIban}</dd>
              </>)}
              {/* Full internal account reference only for the owner (payee) and staff. */}
              {(staffRole || isPayee) && (<>
                <dt className="text-gray-500">Receiving account</dt>
                <dd className="font-mono text-xs text-gray-800 break-all">
                  <Link href={`/system/accounts/${req.payeeReceivingAccountReference}`} className="text-blue-600 hover:underline">{req.payeeReceivingAccountReference} <ExternalLink size={11} className="inline" /></Link>
                </dd>
              </>)}
              {staffRole && (<>
                <dt className="text-gray-500">Party</dt>
                <dd className="font-mono text-xs text-gray-800 break-all">{req.requesterPartyReference}</dd>
              </>)}
            </dl>
          </div>
        </div>

        {/* Identifiers: visible to BOTH parties (and staff) for support / investigations.
            Request ID = the Request-to-Pay intent (what you approve). Transfer ID = the actual money
            movement created after approval. They are deliberately distinct records. */}
        <div className="border-t pt-4 mt-4 text-sm space-y-2">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500 flex items-center gap-1"><Info size={12} className="text-gray-400" /> Request ID</span>
              <span className="font-mono text-xs text-gray-700 break-all">{req.paymentRequestInstanceReference}</span>
            </div>
            <p className="text-[11px] text-gray-400">The payment request (the intent you approve). Use it for support about the request itself.</p>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500 flex items-center gap-1"><Info size={12} className="text-gray-400" /> Transfer / execution ID</span>
              {req.linkedPaymentExecutionReference
                ? <Link href={`/system/payment/history/${req.linkedPaymentExecutionReference}`} className="font-mono text-xs text-blue-600 hover:underline break-all">{req.linkedPaymentExecutionReference} <ExternalLink size={11} className="inline" /></Link>
                : <span className="font-mono text-xs text-gray-400">Not created yet</span>}
            </div>
            <p className="text-[11px] text-gray-400">The actual money movement created after approval. Use it for support about the funds/settlement.</p>
          </div>
        </div>
      </div>

      {/* Timeline: created / approved by payer / completed (both parties). */}
      {events.length > 0 && (
        <div className="bg-white rounded-xl border p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Timeline</h2>
          <ol className="space-y-1.5">
            {events.map((e, i) => (
              <li key={String(e.eventId ?? i)} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#00684A] shrink-0" />
                <div className="flex-1 flex items-center justify-between gap-2">
                  <span className="text-gray-700">{String(e.summary ?? (e.action as string ?? '').replace(/^rtp\./, '').replace(/\./g, ' '))}</span>
                  <span className="text-xs text-gray-400">{e.eventDateTime ? new Date(String(e.eventDateTime)).toLocaleString() : ''}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Security Review: BOTH parties see the PSP/L1/L2 outcome + notes on their funds (transparency).
          Staff additionally get a link into the full investigation case. */}
      <div className="bg-white rounded-xl border p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Security Review</h2>
        {sc ? (
          <div className="text-sm space-y-2">
            <p className="text-gray-700">This request was reviewed by the security team.</p>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
              <dt className="text-gray-500">Case</dt><dd className="text-gray-800">{sc.caseReference ?? '—'}</dd>
              <dt className="text-gray-500">Status</dt><dd className="text-gray-800 capitalize">{(sc.caseStatus ?? '').replace(/_/g, ' ') || '—'}</dd>
              {sc.caseSeverity && (<><dt className="text-gray-500">Severity</dt><dd className="text-gray-800 uppercase">{sc.caseSeverity}</dd></>)}
              {sc.resolutionOutcome && (<><dt className="text-gray-500">Resolution</dt><dd className="text-gray-800 capitalize">{sc.resolutionOutcome.replace(/_/g, ' ')}</dd></>)}
            </dl>
            {sc.notes.filter((n) => !n.isRetracted).map((n) => (
              <div key={n.noteId} className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">
                <span className="font-medium capitalize">{n.performedByRole.replace(/_/g, ' ')}:</span> {n.noteText}
              </div>
            ))}
            {staffRole && sc.caseInstanceReference && (
              <Link href={`/system/investigation/${sc.caseInstanceReference}`} className="text-blue-600 hover:underline">Open investigation case <ExternalLink size={11} className="inline" /></Link>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No security review on this request. Screening (FDS/HRP/AML + VoP) runs at approval; both parties are notified if it is held for review.</p>
        )}
      </div>

      {/* Approve / reject: payer only, while pending */}
      {pending && isPayer && (
        <div className="bg-white rounded-xl border p-5 mb-4">
          {msg && <div className="mb-3 rounded bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">{msg}</div>}
          <div className="flex items-center gap-2">
            <button disabled={busy || accounts.length === 0} onClick={approve}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#001E2B] hover:bg-[#001E2B]/80 text-white px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50">
              <Check size={15} /> Approve &amp; pay
            </button>
            <button disabled={busy} onClick={reject}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
              <X size={15} /> Reject
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">Approving runs funds check + FDS/HRP/AML + VoP, then creates the linked payment from the account selected above.</p>
        </div>
      )}
      {pending && isPayee && (
        <div className="bg-white rounded-xl border p-5 mb-4 text-sm text-gray-500">Waiting for the payer to approve this request.</div>
      )}
    </>
  );
}

export default RtpDetailView;

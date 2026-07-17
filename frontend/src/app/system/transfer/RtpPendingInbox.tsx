'use client';
// v28 RTP pending-approval inbox: the payer's "requests awaiting your approval", shown directly in
// the transfers section (single approval surface, no separate silo). Approve runs funds check +
// screening + creates the linked P2P transfer (backend). If the payer has no active account, approve
// is disabled with an explanation. Also lists the payer's viewed/settled history for context.
import { useCallback, useEffect, useState } from 'react';
import { HandCoins, Check, X, RefreshCw } from 'lucide-react';
import { api, RtpRequestDTO } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { fmtAmount, useAccountsAndBeneficiaries } from './_shared';

const PENDING = ['presented', 'delivered', 'viewed'];

export function RtpPendingInbox() {
  const [token, setToken] = useState('');
  const [partyRef, setPartyRef] = useState('');
  const [pending, setPending] = useState<RtpRequestDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (t) setPartyRef(decodeToken(t)?.partyRef ?? '');
  }, []);

  const { accounts, fromAccountRef, setFromAccountRef } = useAccountsAndBeneficiaries(partyRef, token);

  const load = useCallback(() => {
    if (!token) return;
    api.rtp.list({ box: 'inbox' }, token)
      .then(r => setPending((r.results ?? []).filter(x => PENDING.includes(x.status))))
      .catch(() => { /* ignore */ })
      .finally(() => setLoaded(true));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const approve = async (ref: string) => {
    setBusy(ref); setMsg(null);
    try {
      const res = await api.rtp.accept(ref, { fundingAccountRef: fromAccountRef || undefined }, token, `rtp-accept-${ref}`);
      setMsg(res.status === 'accepted' ? 'Approved — payment on the way.' : (res.reason ?? 'Request could not be approved.'));
      load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Approval failed.'); }
    finally { setBusy(null); }
  };

  const reject = async (ref: string) => {
    setBusy(ref); setMsg(null);
    try { await api.rtp.reject(ref, token); load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Reject failed.'); }
    finally { setBusy(null); }
  };

  if (!loaded) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <HandCoins size={18} className="text-[#001E2B]" />
        <h3 className="font-semibold text-gray-900 text-sm">Requests awaiting your approval</h3>
        {pending.length > 0 && <span className="ml-1 rounded-full bg-amber-100 text-amber-800 text-xs px-2 py-0.5">{pending.length}</span>}
        <button onClick={load} className="ml-auto text-gray-400 hover:text-gray-600" title="Refresh"><RefreshCw size={15} /></button>
      </div>

      {msg && <div className="mb-3 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700">{msg}</div>}

      {pending.length === 0 ? (
        <p className="text-xs text-gray-500">No pending requests. You are all caught up.</p>
      ) : (
        <div className="space-y-2">
          {accounts.length > 0 && (
            <label className="block text-xs text-gray-600">
              Funding account
              <select value={fromAccountRef} onChange={e => setFromAccountRef(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                {accounts.map(a => (
                  <option key={a.payoutAccountInstanceReference} value={a.payoutAccountInstanceReference}>
                    {(a.payoutAccountAlias ?? a.payoutAccountBankName ?? 'Account')} · {fmtAmount(a.payoutAccountBalance?.availableAmount ?? 0, a.payoutAccountCurrency)}{a.payoutAccountIsDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {pending.map(r => (
            <div key={r.paymentRequestInstanceReference} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{r.payeeName ?? 'A payee'} · {fmtAmount(r.amount, r.currency)}</p>
                <p className="text-xs text-gray-500 truncate">{r.purpose ?? 'Payment request'} · {r.status}</p>
              </div>
              <button disabled={busy !== null || accounts.length === 0} onClick={() => approve(r.paymentRequestInstanceReference)}
                className="inline-flex items-center gap-1 rounded-md bg-[#00ED64] px-2.5 py-1.5 text-xs font-semibold text-[#001E2B] disabled:opacity-50">
                <Check size={14} /> Approve
              </button>
              <button disabled={busy !== null} onClick={() => reject(r.paymentRequestInstanceReference)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50">
                <X size={14} /> Reject
              </button>
            </div>
          ))}
          {accounts.length === 0 && <p className="text-xs text-red-600">You need an active payout account to approve requests.</p>}
        </div>
      )}
    </div>
  );
}

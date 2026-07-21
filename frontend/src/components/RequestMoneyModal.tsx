'use client';
// v28 Shared "Request money" (RTP) modal. Request money FROM a beneficiary: the beneficiary becomes
// the PAYER (payerPartyReference = counterpartyPartyReference); the current user is the payee/requester.
// The request is presented (lands in the payer's approval inbox) and a shared QR is offered. No funds
// move until the payer approves in-app. Reused by the beneficiaries list and the beneficiary detail page.
import { useState } from 'react';
import { HandCoins, X, Check } from 'lucide-react';
import { api, type QrRepresentationDTO } from '../lib/api';
import { QrRepresentation } from './QrRepresentation';

function fmtAmount(n: number, currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n);
}

export interface RequestMoneyModalProps {
  beneficiary: { counterpartyLabel: string; counterpartyPartyReference: string; counterpartyArrangementReference?: string };
  token: string;
  onClose: () => void;
}

export function RequestMoneyModal({ beneficiary, token, onClose }: RequestMoneyModalProps) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ ref: string; amount: number; currency: string; qr?: QrRepresentationDTO } | null>(null);

  async function handleRequest() {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { setError('Enter a valid amount.'); return; }
    setBusy(true); setError('');
    try {
      const req = await api.rtp.create({
        amount: parsed, currency, purpose: purpose.trim() || undefined,
        payerPartyReference: beneficiary.counterpartyPartyReference,
        // The payer display the PAYEE will see is the beneficiary label THEY chose (their own data),
        // since the payer hasn't consented to share basic data until they approve.
        payerAlias: beneficiary.counterpartyLabel,
        // Link back to the requester's own beneficiary (SD-54), so the payee's detail can open it.
        payerCounterpartyReference: beneficiary.counterpartyArrangementReference,
      }, token, `rtp-ben-${Date.now()}`);
      try { await api.rtp.present(req.paymentRequestInstanceReference, token); } catch { /* still created */ }
      let qr: QrRepresentationDTO | undefined;
      try { qr = await api.rtp.qr(req.paymentRequestInstanceReference, token); } catch { /* optional */ }
      setSuccess({ ref: req.paymentRequestInstanceReference, amount: parsed, currency, qr });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the request.');
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div role="dialog" aria-modal="true" aria-label="Request money" className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <HandCoins size={18} className="text-[#001E2B]" />
            <div>
              <h3 className="font-semibold text-gray-900">Request money</h3>
              <p className="text-xs text-gray-500">from <span className="font-medium text-gray-700">{beneficiary.counterpartyLabel}</span></p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="text-center py-2">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check size={24} className="text-green-600" />
              </div>
              <p className="font-semibold text-gray-900">Requested {fmtAmount(success.amount, success.currency)}</p>
              <p className="text-sm text-gray-500 mt-1">from {beneficiary.counterpartyLabel} — awaiting their approval</p>
              <p className="text-xs font-mono text-gray-400 mt-2">Ref: {success.ref.slice(0, 8)}…</p>
            </div>
            {success.qr && <QrRepresentation encodedPayload={success.qr.encodedPayload} payloadFormat={success.qr.payloadFormat} label="Let them scan to approve" />}
            <button type="button" onClick={onClose}
              className="w-full py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
                <div className="flex gap-2">
                  <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0.01" step="0.01" placeholder="0.00"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
                  <select value={currency} onChange={e => setCurrency(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 font-medium text-gray-600">
                    <option>EUR</option><option>USD</option><option>GBP</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Purpose <span className="text-gray-400">(optional)</span></label>
                <input value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={140} placeholder="e.g. Dinner split, shared rent…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              </div>
            </div>
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <p className="text-xs text-gray-400">The request is sent to {beneficiary.counterpartyLabel} for in-app approval. No funds move until they approve.</p>
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button type="button" onClick={handleRequest} disabled={busy}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#001E2B] hover:bg-[#001E2B]/80 text-white rounded-lg transition-colors disabled:opacity-50">
                <HandCoins size={14} />{busy ? 'Requesting…' : 'Request'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default RequestMoneyModal;

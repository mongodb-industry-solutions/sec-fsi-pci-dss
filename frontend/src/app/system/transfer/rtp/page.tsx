'use client';
// v28 Request to Pay: payee creates a request money (a transfer that needs the payer's approval).
// On create we present it to the payer (lands in their approval inbox + notification) and offer a
// shared QR so the payer can scan instead of receiving in-app. Requires the payee to have an active
// payout account (create guard on the backend; surfaced here).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HandCoins, ArrowLeft } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../components/Breadcrumb';
import { QrRepresentation } from '../../../../components/QrRepresentation';
import { api, RtpRequestDTO, QrRepresentationDTO } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';

interface Beneficiary {
  counterpartyArrangementReference: string;
  counterpartyLabel: string;
  counterpartyPartyReference: string;
  counterpartyArrangementStatus?: string;
}

export default function RtpCreatePage() {
  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [purpose, setPurpose] = useState('');
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [beneficiaryRef, setBeneficiaryRef] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<RtpRequestDTO | null>(null);
  const [qr, setQr] = useState<QrRepresentationDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) return;
    const u = decodeToken(t);
    setRole(u?.role ?? '');
    // Load the requester's beneficiaries so they can pick WHO to request money from (simplifies the flow).
    if (u?.partyRef) {
      api.beneficiaries.list(t, { ownerRef: u.partyRef })
        .then((r) => {
          const list = ((r.results ?? []) as unknown as Beneficiary[]).filter((b) => b.counterpartyArrangementStatus !== 'removed');
          setBeneficiaries(list);
          if (list.length > 0) setBeneficiaryRef(list[0].counterpartyArrangementReference);
        })
        .catch(() => { /* none */ });
    }
  }, []);

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      const amt = parseFloat(amount);
      if (!(amt > 0)) throw new Error('Enter an amount greater than zero.');
      const ben = beneficiaries.find((b) => b.counterpartyArrangementReference === beneficiaryRef);
      if (!ben) throw new Error('Select a beneficiary to request money from.');
      const req = await api.rtp.create({
        amount: amt, currency, purpose: purpose || undefined,
        payerPartyReference: ben.counterpartyPartyReference,
        payerCounterpartyReference: ben.counterpartyArrangementReference,
        payerAlias: ben.counterpartyLabel,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      }, token, `rtp-create-${Date.now()}`);
      // Present so it reaches the payer's approval inbox, then offer a QR.
      try { await api.rtp.present(req.paymentRequestInstanceReference, token); } catch { /* still created */ }
      setCreated(req);
      try { setQr(await api.rtp.qr(req.paymentRequestInstanceReference, token)); } catch { /* optional */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the request.');
    } finally { setBusy(false); }
  };

  if (role && role !== 'customer') {
    return <div className="w-full px-5 sm:px-8 py-6"><div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">Access denied. Customers only.</div></div>;
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Transfer', href: '/system/transfer' }, { label: 'Request to Pay' }]} />
      <SectionHeader icon={HandCoins} title="Request to Pay" description="Request money; the payer approves in-app to pay you" />

      {error && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!created ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-xs font-medium text-gray-700">Amount
              <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00"
                className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </label>
            <label className="block text-xs font-medium text-gray-700">Currency
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                <option>EUR</option><option>USD</option><option>GBP</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-700">Purpose
              <input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. Dinner split"
                className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </label>
            <label className="block text-xs font-medium text-gray-700">Request from (beneficiary)
              {beneficiaries.length === 0 ? (
                <div className="mt-1 text-xs text-amber-600">
                  No beneficiaries yet. <Link href="/system/beneficiaries" className="text-blue-600 hover:underline">Add one</Link> to request money.
                </div>
              ) : (
                <select value={beneficiaryRef} onChange={e => setBeneficiaryRef(e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                  {beneficiaries.map((b) => (
                    <option key={b.counterpartyArrangementReference} value={b.counterpartyArrangementReference}>{b.counterpartyLabel}</option>
                  ))}
                </select>
              )}
            </label>
            <label className="block text-xs font-medium text-gray-700 md:col-span-2">Expires at <span className="text-gray-400">(optional)</span>
              <input value={expiresAt} onChange={e => setExpiresAt(e.target.value)} type="datetime-local"
                className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </label>
          </div>
          <div className="flex justify-end">
            <button disabled={busy || !beneficiaryRef} onClick={submit}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors disabled:opacity-50">
              <HandCoins size={14} />{busy ? 'Creating…' : 'Create request'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <p className="text-sm text-gray-800">Request created and sent to the payer for approval.</p>
          <p className="text-xs text-gray-500">Reference: <code>{created.paymentRequestInstanceReference}</code> · status <b>{created.status}</b></p>
          {qr && <div className="max-w-md"><QrRepresentation encodedPayload={qr.encodedPayload} payloadFormat={qr.payloadFormat} label="Let the payer scan to approve" /></div>}
          <Link href="/system/transfer" className="inline-flex items-center gap-1 text-sm text-[#001E2B] hover:underline"><ArrowLeft size={14} /> Back to transfers</Link>
        </div>
      )}
    </div>
  );
}

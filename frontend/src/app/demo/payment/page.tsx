'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { getToken } from '../../../lib/auth';
import { FraudAlert } from '../../../components/FraudAlert';
import Link from 'next/link';

export default function DemoPaymentPage() {
  const router = useRouter();
  const token = getToken() ?? '';
  const [step, setStep] = useState<1|2|3>(1);
  const [maskedCard, setMaskedCard] = useState('');
  const [amount, setAmount] = useState('850.00');
  const [merchant, setMerchant] = useState('TechGadgets Ltd.');
  const [mcc, setMcc] = useState('5734');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txnId: string; fraudCaseCreated: boolean; caseId?: string } | null>(null);
  const cardToken = `tok_${Math.random().toString(36).slice(2, 10)}`;

  function handleCardInput(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g,'').slice(0,16);
    if (digits.length <= 12) {
      setMaskedCard(digits.replace(/(.{4})/g,'****-').replace(/-$/,''));
    } else {
      setMaskedCard(`****-****-****-${digits.slice(-4)}`);
    }
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const res = await api.transactions.create({
        cardToken,
        accountReference: `ACC-DEMO-${Date.now().toString(36).toUpperCase()}`,
        amount: parseFloat(amount),
        currency: 'USD',
        cardTransactionMerchantName: merchant,
        cardTransactionMerchantCategoryCode: mcc,
        cardTransactionChannel: 'online',
        cardTransactionMaskedPanDisplay: maskedCard || '****-****-****-0000',
        gatewayPayload: { source: 'app-mode' },
      }, token);
      setResult({ txnId: res.cardTransactionInstanceReference, fraudCaseCreated: res.fraudCaseCreated, caseId: res.fraudDiagnosisInstanceReference });
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex justify-between">
        <span className="font-bold text-[#00ED64]">🏦 LeafyBank Demo</span>
        <Link href="/demo/payment/history" className="text-sm text-gray-400 hover:text-white">← My Transactions</Link>
      </header>
      <main className="max-w-md mx-auto p-6">
        <h1 className="text-xl font-bold mb-6">💳 New Payment — Step {step} of 3</h1>
        {step === 1 && (
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Card Number</label>
              <input type="text" onChange={handleCardInput} placeholder="Enter card number" className="w-full border rounded-lg px-3 py-2 font-mono" />
              {maskedCard && <div className="mt-1 font-mono text-sm bg-gray-50 rounded px-3 py-2">{maskedCard}</div>}
              <p className="text-xs text-gray-500 mt-1">Masked immediately — raw PAN never stored</p>
            </div>
            <div><label className="block text-sm font-medium mb-1">Amount ($)</label>
              <input value={amount} onChange={e=>setAmount(e.target.value)} className="w-full border rounded-lg px-3 py-2" /></div>
            <div><label className="block text-sm font-medium mb-1">Merchant</label>
              <input value={merchant} onChange={e=>setMerchant(e.target.value)} className="w-full border rounded-lg px-3 py-2" /></div>
            <div><label className="block text-sm font-medium mb-1">MCC</label>
              <input value={mcc} onChange={e=>setMcc(e.target.value)} className="w-full border rounded-lg px-3 py-2" /></div>
            <button onClick={()=>setStep(2)} className="w-full bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold">Next →</button>
          </div>
        )}
        {step === 2 && (
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
              🔒 PII fields encrypted before leaving your browser
            </div>
            <div className="text-sm space-y-2">
              <div className="flex justify-between"><span>Amount:</span><strong>${amount}</strong></div>
              <div className="flex justify-between"><span>Merchant:</span><strong>{merchant}</strong></div>
              <div className="flex justify-between"><span>Card token:</span><code className="text-xs">{cardToken}</code></div>
              <div className="flex justify-between text-gray-500 text-xs"><span>Card token is a surrogate — not CHD under PCI DSS v4.0</span></div>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button onClick={()=>setStep(1)} className="flex-1 border rounded-lg py-2.5 text-gray-700">← Back</button>
              <button onClick={handleConfirm} disabled={submitting} className="flex-1 bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold disabled:opacity-50">
                {submitting ? 'Processing…' : 'Confirm →'}
              </button>
            </div>
          </div>
        )}
        {step === 3 && result && (
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="font-bold text-green-700">✅ Payment Confirmed</h2>
            <p className="text-sm font-mono">{result.txnId.slice(0,20)}…</p>
            {result.fraudCaseCreated && result.caseId && (
              <FraudAlert caseId={result.caseId} severity="high" caseRef={`FD-${result.caseId.slice(-6).toUpperCase()}`} investigationPath="/demo/investigation" />
            )}
            <button onClick={()=>router.push('/demo/payment/history')} className="w-full border rounded-lg py-2.5 text-gray-700 hover:bg-gray-50">View My Transactions</button>
          </div>
        )}
      </main>
    </div>
  );
}

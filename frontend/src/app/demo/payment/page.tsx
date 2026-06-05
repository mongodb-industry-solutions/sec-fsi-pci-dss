'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { ROLE_LABELS } from '../../../lib/constants';
import { FraudAlert } from '../../../components/FraudAlert';
import Link from 'next/link';

interface CardPreset {
  label: string;
  lastFour: string;
  network: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
}

const CARD_PRESETS: CardPreset[] = [
  { label: 'Visa Demo 4291', lastFour: '4291', network: 'VISA' },
  { label: 'Mastercard Demo 8734', lastFour: '8734', network: 'MASTERCARD' },
  { label: 'Amex Demo 0052', lastFour: '0052', network: 'AMEX' },
];

const MERCHANT_PRESETS = [
  { label: 'TechGadgets Ltd.', mcc: '5734', note: 'Electronics (low risk)' },
  { label: 'Casino Royale', mcc: '7995', note: 'Gambling (high risk - triggers fraud alert)' },
  { label: 'Metro Supermarket', mcc: '5411', note: 'Grocery (low risk)' },
  { label: 'Night Club XL', mcc: '5813', note: 'Drinking establishment (high risk)' },
];

const AMOUNT_PRESETS = ['120.00', '499.00', '850.00', '1250.00'];

const CHANNEL_OPTIONS = [
  { value: 'online', label: 'Online (e-commerce)' },
  { value: 'pos', label: 'Point of Sale (POS terminal)' },
  { value: 'contactless', label: 'Contactless (NFC/tap)' },
  { value: 'atm', label: 'ATM withdrawal' },
];

const INITIATION_OPTIONS = [
  { value: 'customerInitiated', label: 'Customer Initiated (CIT)' },
  { value: 'merchantInitiated', label: 'Merchant Initiated (MIT)' },
];

export default function DemoPaymentPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [user, setUser] = useState<ReturnType<typeof decodeToken>>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    setUser(t ? decodeToken(t) : null);
  }, []);
  const [maskedCard, setMaskedCard] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<CardPreset | null>(null);
  const [amount, setAmount] = useState('850.00');
  const [merchant, setMerchant] = useState('TechGadgets Ltd.');
  const [mcc, setMcc] = useState('5734');
  const [channel, setChannel] = useState('online');
  const [initiationType, setInitiationType] = useState('customerInitiated');
  const [paymentReference, setPaymentReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [result, setResult] = useState<{ txnId: string; fraudCaseCreated: boolean; caseId?: string; maskedPan: string } | null>(null);

  const cardToken = `tok_${Math.random().toString(36).slice(2, 10)}`;

  function handleCardInput(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip any existing mask characters to get raw digits
    const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 16);
    setSelectedPreset(null);
    if (digits.length === 0) {
      setMaskedCard('');
    } else if (digits.length <= 12) {
      setMaskedCard(digits.replace(/(.{4})/g, '$1-').replace(/-$/, ''));
    } else {
      setMaskedCard(`****-****-****-${digits.slice(-4)}`);
    }
  }

  function selectPreset(preset: CardPreset) {
    setSelectedPreset(preset);
    setMaskedCard(`****-****-****-${preset.lastFour}`);
  }

  function selectMerchantPreset(m: typeof MERCHANT_PRESETS[0]) {
    setMerchant(m.label);
    setMcc(m.mcc);
  }

  const selectedMerchantPreset = MERCHANT_PRESETS.find((m) => m.mcc === mcc && m.label === merchant);

  async function handleConfirm() {
    if (!maskedCard) {
      setError('Please enter or select a card number.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.transactions.create({
        cardToken,
        accountReference: `ACC-DEMO-${Date.now().toString(36).toUpperCase()}`,
        amount: parseFloat(amount),
        currency: 'USD',
        cardTransactionMerchantName: merchant,
        cardTransactionMerchantCategoryCode: mcc,
        cardTransactionChannel: channel,
        cardTransactionInitiationType: initiationType,
        cardTransactionMaskedPanDisplay: maskedCard,
        gatewayPayload: { source: 'app-mode', paymentReference: paymentReference || undefined },
      }, token);

      const txnId = res.cardTransactionInstanceReference;
      // Persist scoped by user sub so each user only sees their own transactions
      const payload = decodeToken(token);
      const storageKey = payload?.sub ? `demo_transactions_${payload.sub}` : 'demo_transactions_guest';
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as object[];
      stored.unshift({
        txnId,
        amount: parseFloat(amount),
        currency: 'USD',
        merchant,
        mcc,
        channel,
        maskedPan: maskedCard,
        status: res.fraudCaseCreated ? 'under_review' : 'authorized',
        fraudCaseCreated: res.fraudCaseCreated,
        caseId: res.fraudDiagnosisInstanceReference,
        createdAt: new Date().toISOString(),
        paymentReference: paymentReference || null,
      });
      localStorage.setItem(storageKey, JSON.stringify(stored.slice(0, 50)));

      setResult({
        txnId,
        fraudCaseCreated: res.fraudCaseCreated,
        caseId: res.fraudDiagnosisInstanceReference,
        maskedPan: maskedCard,
      });
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const amountNum = parseFloat(amount) || 0;
  const isFraudRisk = amountNum > 500 || ['7995', '5813', '5812', '6011'].includes(mcc);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex justify-between items-center">
        <span className="font-bold text-[#00ED64]">🏦 Payment Gateway</span>
        <div className="flex items-center gap-3 text-sm">
          {user && (
            <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">
              {user.name} · {ROLE_LABELS[user.role] ?? user.role}
            </span>
          )}
          <button
            onClick={() => setDebugMode((v) => !v)}
            title="Toggle debug mode"
            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors ${debugMode ? 'bg-[#00ED64] text-[#001E2B] border-[#00ED64]' : 'text-gray-400 border-white/20 hover:border-white/40'}`}
          >
            <span className="hidden sm:inline">{debugMode ? 'Debug ON' : 'Debug'}</span>
          </button>
          <Link href="/demo/payment/history" className="text-gray-400 hover:text-white">My Transactions</Link>
        </div>
      </header>

      <main className="max-w-md mx-auto p-6">
        <h1 className="text-xl font-bold mb-6">New Payment - Step {step} of 3</h1>

        {/* STEP 1: Card and payment details */}
        {step === 1 && (
          <div className="bg-white rounded-xl border p-5 space-y-4">
            {/* Card presets */}
            <div>
              <label className="block text-sm font-medium mb-2">Card</label>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {CARD_PRESETS.map((p) => (
                  <button
                    key={p.lastFour}
                    onClick={() => selectPreset(p)}
                    className={`text-xs rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      selectedPreset?.lastFour === p.lastFour
                        ? 'border-[#001E2B] bg-[#001E2B] text-white'
                        : 'hover:border-gray-400'
                    }`}
                  >
                    <div className="font-semibold">{p.network}</div>
                    <div className={`font-mono ${selectedPreset?.lastFour === p.lastFour ? 'text-gray-300' : 'text-gray-400'}`}>...{p.lastFour}</div>
                  </button>
                ))}
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={maskedCard}
                  onChange={handleCardInput}
                  placeholder="Select a card above or enter number"
                  maxLength={19}
                  className="w-full border rounded-lg px-3 py-2 font-mono text-sm pr-20"
                />
                {selectedPreset && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">
                    {selectedPreset.network}
                  </span>
                )}
              </div>
            </div>

            {/* Amount presets */}
            <div>
              <label className="block text-sm font-medium mb-2">Amount (USD)</label>
              <div className="flex gap-2 mb-2 flex-wrap">
                {AMOUNT_PRESETS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAmount(a)}
                    className={`text-xs rounded border px-2 py-1 transition-colors ${amount === a ? 'bg-[#001E2B] text-white border-[#001E2B]' : 'hover:border-gray-400'}`}
                  >
                    ${a}
                  </button>
                ))}
              </div>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="w-full border rounded-lg px-3 py-2"
              />
              {debugMode && isFraudRisk && (
                <p className="text-xs text-amber-600 mt-1">
                  {amountNum > 500 ? 'Amount exceeds $500 - fraud review will be triggered.' : 'High-risk merchant category - fraud review will be triggered.'}
                </p>
              )}
            </div>

            {/* Merchant presets */}
            <div>
              <label className="block text-sm font-medium mb-2">Merchant</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                {MERCHANT_PRESETS.map((m) => (
                  <button
                    key={m.mcc}
                    onClick={() => selectMerchantPreset(m)}
                    className={`text-xs rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      selectedMerchantPreset?.mcc === m.mcc
                        ? 'border-[#001E2B] bg-[#001E2B] text-white'
                        : 'hover:border-gray-400'
                    }`}
                  >
                    <div className="font-semibold truncate">{m.label}</div>
                    <div className={`text-xs mt-0.5 ${selectedMerchantPreset?.mcc === m.mcc ? 'text-gray-300' : 'text-gray-400'}`}>{m.note}</div>
                  </button>
                ))}
              </div>
              <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Merchant name" className="w-full border rounded-lg px-3 py-2 mb-1" />
              <input value={mcc} onChange={(e) => setMcc(e.target.value)} placeholder="MCC code" className="w-full border rounded-lg px-3 py-2 font-mono text-sm" />
            </div>

            <div className="flex gap-3 pt-1">
              <Link
                href="/demo/payment/history"
                className="flex-1 text-center border rounded-lg py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </Link>
              <button
                onClick={() => { if (!maskedCard) { setError('Please select or enter a card.'); return; } setError(null); setStep(2); }}
                className="flex-1 bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold text-sm"
              >
                Review Payment
              </button>
            </div>
            {error && <p className="text-red-600 text-sm text-center">{error}</p>}
          </div>
        )}

        {/* STEP 2: Review with BIAN fields */}
        {step === 2 && (
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">Review Payment Details</h2>

            {/* BIAN-aligned payment summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Amount:</span>
                <strong className="text-gray-900">${parseFloat(amount).toFixed(2)} USD</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Merchant:</span>
                <span className="font-medium">{merchant}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Merchant Category:</span>
                <span className="font-mono text-xs">MCC {mcc}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Card:</span>
                <span className="font-mono">{maskedCard}</span>
              </div>

              {/* BIAN fields: channel + initiation type */}
              <div className="border-t pt-2 mt-2">
                <label className="block text-xs text-gray-500 mb-1">Payment Channel (BIAN: cardTransactionChannel)</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm">
                  {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Initiation Type (BIAN: cardTransactionInitiationType)</label>
                <select value={initiationType} onChange={(e) => setInitiationType(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm">
                  {INITIATION_OPTIONS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Payment Reference (optional)</label>
                <input
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="e.g. Invoice INV-2026-0042"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            {/* Debug-only technical info */}
            {debugMode && (
              <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-lg p-3 space-y-1.5 text-xs">
                <p className="font-semibold text-[#001E2B]">Debug - Technical details</p>
                <p className="text-green-700">Fields encrypted before leaving browser (QE client-side)</p>
                <p className="text-gray-600">Card token: <code>{cardToken}</code></p>
                <p className="text-gray-600">Card token is a surrogate for the PAN, not CHD under PCI DSS v4.0</p>
                <p className="text-gray-600">
                  {isFraudRisk
                    ? 'Fraud trigger: this transaction will auto-create a fraudDiagnosisCase (SD-83)'
                    : 'No fraud trigger expected for this transaction'}
                </p>
              </div>
            )}

            {debugMode && isFraudRisk && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                This transaction will be flagged for fraud review based on the amount or merchant category.
              </div>
            )}

            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 border rounded-lg py-2.5 text-gray-700">Back</button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="flex-1 bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold disabled:opacity-50"
              >
                {submitting ? 'Processing...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Confirmation */}
        {step === 3 && result && (
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <h2 className="font-bold text-green-700">Payment Confirmed</h2>
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Amount:</span>
                <strong>${parseFloat(amount).toFixed(2)} USD</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Merchant:</span>
                <span>{merchant}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Card:</span>
                <span className="font-mono">{result.maskedPan}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Status:</span>
                <span className={result.fraudCaseCreated ? 'text-amber-700 font-medium' : 'text-green-700 font-medium'}>
                  {result.fraudCaseCreated ? 'Under review' : 'Authorized'}
                </span>
              </div>
            </div>

            {result.fraudCaseCreated && result.caseId && (
              <FraudAlert
                caseId={result.caseId}
                severity="high"
                caseRef={`FD-${result.caseId.slice(-6).toUpperCase()}`}
                investigationPath="/demo/investigation"
              />
            )}

            {debugMode && (
              <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-lg p-3 text-xs">
                <p className="font-semibold text-[#001E2B] mb-1">Debug - Transaction reference</p>
                <p className="font-mono text-gray-600">Txn ID: {result.txnId}</p>
                {result.fraudCaseCreated && <p className="text-amber-700">fraudDiagnosisCase created (BIAN SD-83)</p>}
              </div>
            )}

            <button
              onClick={() => router.push('/demo/payment/history')}
              className="w-full border rounded-lg py-2.5 text-gray-700 hover:bg-gray-50"
            >
              View My Transactions
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

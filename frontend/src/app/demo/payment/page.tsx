// cspell:ignore BIAN
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { useDebugMode } from '../../../lib/debugMode';
import { FraudAlert } from '../../../components/FraudAlert';
import { Tooltip } from '../../../components/Tooltip';
import Link from 'next/link';

interface CardPreset {
  label: string;
  lastFour: string;
  network: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
}

const CARD_PRESETS: CardPreset[] = [
  { label: 'Visa Demo 4291',       lastFour: '4291', network: 'VISA' },
  { label: 'Mastercard Demo 8734', lastFour: '8734', network: 'MASTERCARD' },
  { label: 'Amex Demo 0052',       lastFour: '0052', network: 'AMEX' },
];

const MERCHANT_PRESETS = [
  { label: 'TechGadgets Ltd.',  mcc: '5734', note: 'Electronics', risk: 'low' },
  { label: 'Casino Royale',     mcc: '7995', note: 'Gambling',    risk: 'high' },
  { label: 'Metro Supermarket', mcc: '5411', note: 'Grocery',     risk: 'low' },
  { label: 'Night Club XL',     mcc: '5813', note: 'Nightlife',   risk: 'high' },
];

const AMOUNT_PRESETS = ['120.00', '499.00', '850.00', '1250.00'];

const CHANNEL_OPTIONS = [
  { value: 'online',      label: 'Online',      sub: 'e-commerce' },
  { value: 'pos',         label: 'POS',         sub: 'in-store terminal' },
  { value: 'contactless', label: 'Contactless', sub: 'NFC / tap' },
  { value: 'atm',         label: 'ATM',         sub: 'cash withdrawal' },
];

const INITIATION_OPTIONS = [
  { value: 'customerInitiated', label: 'Customer (CIT)', sub: 'standard checkout' },
  { value: 'merchantInitiated', label: 'Merchant (MIT)', sub: 'subscription / recurring' },
];

const NARRATIVE_PRESETS = [
  'Online purchase via checkout flow',
  'In-store payment, card present',
  'Recurring subscription charge',
  'One-time purchase, manually reviewed',
];

function descriptorPresets(merchantName: string): string[] {
  const upper = merchantName.toUpperCase();
  const slug  = upper.replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return [...new Set([
    upper.slice(0, 22),
    `${slug}*ONLINE`.slice(0, 22),
    `SQ*${slug}`.slice(0, 22),
  ])];
}

export default function DemoPaymentPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [step, setStep] = useState<1 | 2 | 3>(1);

  useEffect(() => { setToken(getToken() ?? ''); }, []);

  const [selectedPreset, setSelectedPreset] = useState<CardPreset | null>(CARD_PRESETS[0]);
  const [maskedCard, setMaskedCard]         = useState(`****-****-****-${CARD_PRESETS[0].lastFour}`);
  const [amount, setAmount]                 = useState('850.00');
  const [merchant, setMerchant]             = useState('TechGadgets Ltd.');
  const [mcc, setMcc]                       = useState('5734');
  const [channel, setChannel]               = useState('online');
  const [initiationType, setInitiationType] = useState('customerInitiated');
  const [paymentReference, setPaymentReference] = useState('');
  const [txDescription, setTxDescription]   = useState(() => descriptorPresets('TechGadgets Ltd.')[0]);
  const [txNarrative, setTxNarrative]       = useState(NARRATIVE_PRESETS[0]);
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const { debugMode }                       = useDebugMode();
  const [result, setResult] = useState<{
    txnId: string; fraudCaseCreated: boolean; caseId?: string; maskedPan: string
  } | null>(null);

  // stable token per render so it matches what gets submitted
  const [cardToken] = useState(() => `tok_${Math.random().toString(36).slice(2, 10)}`);

  function handleCardInput(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 16);
    setSelectedPreset(null);
    if      (digits.length === 0)   setMaskedCard('');
    else if (digits.length <= 12)   setMaskedCard(digits.replace(/(.{4})/g, '$1-').replace(/-$/, ''));
    else                            setMaskedCard(`****-****-****-${digits.slice(-4)}`);
  }

  function selectPreset(p: CardPreset) {
    setSelectedPreset(p);
    setMaskedCard(`****-****-****-${p.lastFour}`);
  }

  function selectMerchantPreset(m: typeof MERCHANT_PRESETS[0]) {
    setMerchant(m.label);
    setMcc(m.mcc);
    setTxDescription(m.label.toUpperCase().slice(0, 22));
  }

  const selectedMerchantPreset = MERCHANT_PRESETS.find(m => m.mcc === mcc && m.label === merchant);

  async function handleConfirm() {
    if (!maskedCard) { setError('Please enter or select a card number.'); return; }
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
        cardTransactionType: 'purchase',
        cardTransactionDescription: (txDescription.trim() || merchant.toUpperCase()).slice(0, 22),
        cardTransactionNarrative: txNarrative.trim() || undefined,
        gatewayPayload: { source: 'app-mode', paymentReference: paymentReference || undefined },
      }, token);

      const txnId   = res.cardTransactionInstanceReference;
      const payload = decodeToken(token);
      const key     = payload?.sub ? `demo_transactions_${payload.sub}` : 'demo_transactions_guest';
      const stored  = JSON.parse(localStorage.getItem(key) ?? '[]') as object[];
      stored.unshift({
        txnId, cardToken, amount: parseFloat(amount), currency: 'USD',
        merchant, mcc, channel, initiationType,
        cardTransactionType: 'purchase',
        maskedPan: maskedCard, network: selectedPreset?.network ?? null,
        status: res.fraudCaseCreated ? 'under_review' : 'authorized',
        fraudCaseCreated: res.fraudCaseCreated,
        caseId: res.fraudDiagnosisInstanceReference,
        createdAt: new Date().toISOString(),
        paymentReference: paymentReference || null,
      });
      localStorage.setItem(key, JSON.stringify(stored.slice(0, 50)));

      setResult({ txnId, fraudCaseCreated: res.fraudCaseCreated, caseId: res.fraudDiagnosisInstanceReference, maskedPan: maskedCard });
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const amountNum  = parseFloat(amount) || 0;
  const isFraudRisk = amountNum > 500 || ['7995', '5813', '5812', '6011'].includes(mcc);
  const descPresets = descriptorPresets(merchant);

  // -- Step indicator ----------------------------------------------------------
  const STEPS = ['Card & amount', 'Review & describe', 'Confirmed'];

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6">

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                step === s ? 'bg-[#001E2B] text-[#00ED64]' :
                step > s  ? 'bg-green-500 text-white' :
                            'bg-gray-200 text-gray-400'
              }`}>
                {step > s ? '✓' : s}
              </div>
              <span className={`text-sm hidden sm:inline ${step === s ? 'font-semibold text-gray-800' : 'text-gray-400'}`}>
                {STEPS[s - 1]}
              </span>
              {s < 3 && <div className={`h-px w-6 sm:w-10 shrink-0 ${step > s ? 'bg-green-400' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {/* -- STEP 1 --------------------------------------------------------─ */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Card + amount */}
              <div className="bg-white rounded-xl border p-5 space-y-5">
                <h2 className="font-semibold text-gray-800">Card</h2>

                <div className="grid grid-cols-3 gap-2">
                  {CARD_PRESETS.map((p) => (
                    <button key={p.lastFour} onClick={() => selectPreset(p)}
                      className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                        selectedPreset?.lastFour === p.lastFour
                          ? 'border-[#001E2B] bg-[#001E2B] text-white'
                          : 'hover:border-gray-400'
                      }`}>
                      <div className="text-xs font-bold">{p.network}</div>
                      <div className={`font-mono text-xs mt-0.5 ${selectedPreset?.lastFour === p.lastFour ? 'text-gray-300' : 'text-gray-400'}`}>
                        ...{p.lastFour}
                      </div>
                    </button>
                  ))}
                </div>

                <input type="text" inputMode="numeric" value={maskedCard} onChange={handleCardInput}
                  placeholder="Or enter card number manually"
                  maxLength={19}
                  className="w-full border rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Amount (USD)</label>
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {AMOUNT_PRESETS.map((a) => (
                      <button key={a} onClick={() => setAmount(a)}
                        className={`text-sm rounded-lg border px-3 py-1.5 transition-colors ${
                          amount === a ? 'bg-[#001E2B] text-white border-[#001E2B]' : 'hover:border-gray-400 text-gray-700'
                        }`}>
                        ${a}
                      </button>
                    ))}
                  </div>
                  <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />
                  {isFraudRisk && debugMode && (
                    <p className="text-xs text-amber-600 mt-1.5">
                      {amountNum > 500
                        ? 'Amount above $500 will trigger a fraud review case.'
                        : 'High-risk merchant category will trigger a fraud review case.'}
                    </p>
                  )}
                </div>
              </div>

              {/* Merchant */}
              <div className="bg-white rounded-xl border p-5 space-y-4">
                <h2 className="font-semibold text-gray-800">Merchant</h2>

                <div className="grid grid-cols-2 gap-2">
                  {MERCHANT_PRESETS.map((m) => (
                    <button key={m.mcc} onClick={() => selectMerchantPreset(m)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        selectedMerchantPreset?.mcc === m.mcc
                          ? 'border-[#001E2B] bg-[#001E2B] text-white'
                          : 'hover:border-gray-400'
                      }`}>
                      <div className="text-xs font-semibold truncate">{m.label}</div>
                      <div className={`text-xs mt-0.5 flex items-center gap-1 ${selectedMerchantPreset?.mcc === m.mcc ? 'text-gray-300' : m.risk === 'high' ? 'text-amber-500' : 'text-gray-400'}`}>
                        {m.risk === 'high' && '⚠ '}{m.note}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <input value={merchant} onChange={(e) => setMerchant(e.target.value)}
                    placeholder="Merchant name"
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />
                  <input value={mcc} onChange={(e) => setMcc(e.target.value)}
                    placeholder="MCC code"
                    className="w-full border rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />
                </div>
              </div>
            </div>

            {/* Action row - global, outside panels, same pattern as Step 2 */}
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3">
              <Link href="/demo/payment/history"
                className="flex-1 sm:flex-none sm:w-32 border rounded-lg py-2.5 text-sm text-center text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </Link>
              <button
                onClick={() => { if (!maskedCard) { setError('Please select or enter a card.'); return; } setError(null); setStep(2); }}
                className="flex-1 bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity">
                Next
              </button>
            </div>
          </div>
        )}

        {/* -- STEP 2 --------------------------------------------------------─ */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* LEFT: Summary + Transaction Settings */}
              <div className="space-y-4">

                {/* Payment summary */}
                <div className="bg-white rounded-xl border p-5">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Payment Summary</h2>
                  <div className="divide-y text-sm">
                    <div className="flex justify-between items-center py-2">
                      <span className="text-gray-500">Amount</span>
                      <strong className="text-xl text-gray-900">${parseFloat(amount).toFixed(2)} USD</strong>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-gray-500">Merchant</span>
                      <span className="font-medium text-right max-w-[55%]">{merchant}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-gray-500">Card</span>
                      <span className="font-mono">{maskedCard}{selectedPreset ? ` (${selectedPreset.network})` : ''}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-gray-500">Category</span>
                      <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">MCC {mcc}</span>
                    </div>
                  </div>
                  {isFraudRisk && debugMode && (
                    <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                      <span className="shrink-0 mt-0.5">⚠</span>
                      <span>This transaction will trigger an automatic fraud review case.</span>
                    </div>
                  )}
                </div>

                {/* Transaction settings */}
                <div className="bg-white rounded-xl border p-5 space-y-4">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Transaction Settings</h2>

                  {/* Channel */}
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                      Channel
                      <Tooltip text="The payment channel used. POS or Contactless simulate in-person payments; these affect fraud scoring and the investigation workflow." />
                      {debugMode && <code className="text-gray-300 text-xs font-mono">cardTransactionChannel</code>}
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {CHANNEL_OPTIONS.map((c) => (
                        <button key={c.value} onClick={() => setChannel(c.value)}
                          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                            channel === c.value
                              ? 'border-[#001E2B] bg-[#001E2B] text-white'
                              : 'hover:border-gray-400 text-gray-700'
                          }`}>
                          <div className="text-xs font-semibold">{c.label}</div>
                          <div className={`text-xs mt-0.5 ${channel === c.value ? 'text-gray-300' : 'text-gray-400'}`}>{c.sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Initiation */}
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                      Initiation
                      <Tooltip text="CIT (Customer Initiated) is a standard one-time purchase. MIT (Merchant Initiated) covers subscriptions and recurring charges where the customer is not actively present." />
                      {debugMode && <code className="text-gray-300 text-xs font-mono">cardTransactionInitiationType</code>}
                    </label>
                    <div className="flex gap-1.5">
                      {INITIATION_OPTIONS.map((i) => (
                        <button key={i.value} onClick={() => setInitiationType(i.value)}
                          className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                            initiationType === i.value
                              ? 'border-[#001E2B] bg-[#001E2B] text-white'
                              : 'hover:border-gray-400 text-gray-700'
                          }`}>
                          <div className="text-xs font-semibold">{i.label}</div>
                          <div className={`text-xs mt-0.5 ${initiationType === i.value ? 'text-gray-300' : 'text-gray-400'}`}>{i.sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Reference */}
                  <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                      Reference
                      <span className="text-gray-400 text-xs font-normal">(optional)</span>
                      <Tooltip text="Optional invoice or order number stored alongside the transaction for reconciliation." />
                    </label>
                    <input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="e.g. INV-2026-0042"
                      className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />
                  </div>
                </div>
              </div>

              {/* RIGHT: Transaction Description */}
              <div className="bg-white rounded-xl border p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Transaction Description</h2>
                  {debugMode && <span className="text-xs font-mono text-gray-300">SD-254</span>}
                </div>

                {/* Transaction type: read-only */}
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                    Type
                    <Tooltip text="Transaction classification per BIAN SD-254. Purchase is fixed for card checkout. Other values such as refund, cash_advance, balance_transfer, fee, and adjustment are set by backend workflows." />
                    {debugMode && <code className="text-gray-300 text-xs font-mono">cardTransactionType</code>}
                  </span>
                  <span className="text-xs font-medium bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full">
                    Purchase
                  </span>
                </div>

                {/* Statement descriptor */}
                <div>
                  <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                    Statement Descriptor
                    <Tooltip text="Short text visible on the cardholder's bank statement. Maximum 22 characters. Choose a preset or type your own." />
                    {debugMode && <code className="text-gray-300 text-xs font-mono">cardTransactionDescription</code>}
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {descPresets.map((d) => (
                      <button key={d} onClick={() => setTxDescription(d)}
                        className={`text-xs border rounded px-2 py-1 font-mono transition-colors ${
                          txDescription === d
                            ? 'border-[#001E2B] bg-[#001E2B] text-white'
                            : 'border-gray-200 text-gray-500 hover:border-gray-400'
                        }`}>
                        {d}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <input
                      value={txDescription}
                      onChange={(e) => setTxDescription(e.target.value.slice(0, 22))}
                      placeholder={merchant.toUpperCase().slice(0, 22)}
                      maxLength={22}
                      className="w-full border rounded-lg px-3 py-2.5 text-sm font-mono pr-16 focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30"
                    />
                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono select-none ${
                      txDescription.length > 18 ? 'text-amber-500' : 'text-gray-400'
                    }`}>
                      {txDescription.length}/22
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Appears on the cardholder&apos;s bank statement.</p>
                </div>

                {/* Investigation narrative */}
                <div>
                  <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                    Investigation Narrative
                    <span className="text-gray-400 text-xs font-normal">(optional)</span>
                    <Tooltip text="Extended context visible only to L1 and L2 fraud investigators. Not shown on the cardholder's bank statement. Useful for seeding realistic investigation scenarios." />
                    {debugMode && <code className="text-gray-300 text-xs font-mono">cardTransactionNarrative</code>}
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {NARRATIVE_PRESETS.map((n) => (
                      <button key={n} onClick={() => setTxNarrative(n)}
                        className={`text-xs border rounded px-2 py-1 transition-colors ${
                          txNarrative === n
                            ? 'border-[#001E2B] bg-[#001E2B] text-white'
                            : 'border-gray-200 text-gray-500 hover:border-gray-400'
                        }`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <input
                    value={txNarrative}
                    onChange={(e) => setTxNarrative(e.target.value)}
                    placeholder="e.g. Online purchase via checkout, ref ORD-2026-0042"
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30"
                  />
                  <p className="text-xs text-gray-400 mt-1">Visible to fraud investigators, not to the cardholder.</p>
                </div>

                {/* Debug panel */}
                {debugMode && (
                  <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-lg p-3 text-xs space-y-1.5">
                    <p className="font-semibold text-[#001E2B]">Debug: Technical details</p>
                    <p className="text-green-700">Fields encrypted client-side before leaving the browser (QE)</p>
                    <p className="text-gray-600">Card token: <code className="bg-white border px-1 rounded">{cardToken}</code></p>
                    <p className="text-gray-500">Token is a PAN surrogate, not CHD under PCI DSS v4.0</p>
                    <p className={isFraudRisk ? 'text-amber-700' : 'text-gray-500'}>
                      {isFraudRisk
                        ? 'Fraud trigger active: will auto-create fraudDiagnosisCase (SD-83)'
                        : 'No fraud trigger expected for this transaction'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Action row */}
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setStep(1)}
                className="flex-1 sm:flex-none sm:w-32 border rounded-lg py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                Back
              </button>
              <button onClick={handleConfirm} disabled={submitting}
                className="flex-1 bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">
                {submitting ? 'Processing...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        )}

        {/* -- STEP 3 --------------------------------------------------------─ */}
        {step === 3 && result && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-lg shrink-0">✓</div>
                <div>
                  <h2 className="font-bold text-green-700 text-lg">Payment Confirmed</h2>
                  <p className="text-xs text-gray-400">Transaction recorded securely in MongoDB Atlas</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 divide-y text-sm">
                <div className="flex justify-between py-1.5">
                  <span className="text-gray-500">Amount</span>
                  <strong>${parseFloat(amount).toFixed(2)} USD</strong>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-gray-500">Merchant</span>
                  <span>{merchant}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-gray-500">Card</span>
                  <span className="font-mono">{result.maskedPan}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-gray-500">Status</span>
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
                <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-lg p-3 text-xs space-y-1">
                  <p className="font-semibold text-[#001E2B]">Debug: Transaction reference</p>
                  <p className="font-mono text-gray-600">Txn ID: {result.txnId}</p>
                  {result.fraudCaseCreated && <p className="text-amber-700">fraudDiagnosisCase created (SD-83)</p>}
                </div>
              )}
            </div>

            <button onClick={() => router.push('/demo/payment/history')}
              className="w-full border rounded-lg py-2.5 text-sm text-gray-700 hover:bg-gray-50 bg-white">
              View My Transactions
            </button>
          </div>
        )}

      </main>
    </div>
  );
}

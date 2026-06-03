'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { FraudAlert } from '../../../components/FraudAlert';
import { EncryptionBadge } from '../../../components/EncryptionBadge';

type Step = 1 | 2 | 3;

interface FormData {
  cardNumber: string;
  cardholderName: string;
  expiry: string;
  email: string;
  phone: string;
  amount: string;
  merchantName: string;
  merchantCategoryCode: string;
}

const DEFAULTS: FormData = {
  cardNumber: '',
  cardholderName: 'Luis Fernandez',
  expiry: '12/28',
  email: 'luis.fernandez@leafybank.demo',
  phone: '+44 7700 900123',
  amount: '850.00',
  merchantName: 'TechGadgets Ltd.',
  merchantCategoryCode: '5734',
};

function maskCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  if (digits.length <= 12) return digits.replace(/(.{4})/g, '****-').replace(/-$/, '');
  const last4 = digits.slice(-4);
  return `****-****-****-${last4}`;
}

function generateToken(): string {
  return `tok_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function simulateCipher(seed: string): string {
  const bytes = Array.from(seed.slice(0, 8)).map((c) =>
    c.charCodeAt(0).toString(16).padStart(2, '0')
  );
  return `\\x${bytes.slice(0, 4).join('\\x')}...`;
}

export default function PaymentPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>(DEFAULTS);
  const [maskedCard, setMaskedCard] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    txnId: string;
    fraudCaseCreated: boolean;
    caseId?: string;
    caseRef?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardToken = generateToken();

  function handleCardInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 16);
    setMaskedCard(maskCardNumber(raw));
    // Raw PAN is never stored in state; we only keep the token
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.transactions.create({
        cardToken,
        accountReference: `ACC-${Date.now().toString(36).toUpperCase()}`,
        amount: parseFloat(form.amount),
        currency: 'USD',
        cardTransactionMerchantName: form.merchantName,
        cardTransactionMerchantCategoryCode: form.merchantCategoryCode,
        cardTransactionChannel: 'online',
        cardTransactionMaskedPanDisplay: maskedCard || '****-****-****-1234',
        gatewayPayload: { source: 'simulator', timestamp: new Date().toISOString() },
      }, '');

      setResult({
        txnId: res.cardTransactionInstanceReference,
        fraudCaseCreated: res.fraudCaseCreated,
        caseId: res.fraudDiagnosisInstanceReference,
        caseRef: res.fraudDiagnosisInstanceReference
          ? `FD-SIM-${res.fraudDiagnosisInstanceReference.slice(-6).toUpperCase()}`
          : undefined,
      });
      setStep(3);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-6">
        {([1, 2, 3] as Step[]).map((s) => (
          <div key={s} className="flex items-center gap-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                step === s
                  ? 'bg-[#001E2B] text-[#00ED64] border-2 border-[#00ED64]'
                  : step > s
                  ? 'bg-[#00ED64] text-[#001E2B]'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {s}
            </div>
            {s < 3 && <div className={`h-px w-8 ${step > s ? 'bg-[#00ED64]' : 'bg-gray-300'}`} />}
          </div>
        ))}
        <span className="text-sm text-gray-500 ml-2">
          Step {step} of 3:{' '}
          {step === 1 ? 'Card Details' : step === 2 ? 'Review' : 'Confirmation'}
        </span>
      </div>

      {/* Step 1: Card Details */}
      {step === 1 && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="text-xl font-bold">💳 New Payment</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Card Number
            </label>
            <input
              type="text"
              placeholder="Enter card number"
              onChange={handleCardInput}
              className="w-full border rounded-lg px-3 py-2 font-mono"
              maxLength={19}
            />
            {maskedCard && (
              <div className="mt-1 font-mono text-gray-700 bg-gray-50 rounded px-3 py-2">
                {maskedCard}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Masked immediately — raw PAN never stored
            </p>
          </div>
          {(['cardholderName', 'expiry'] as const).map((field) => (
            <div key={field}>
              <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">
                {field.replace(/([A-Z])/g, ' $1')}
              </label>
              <input
                type="text"
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
          ))}
          <div className="border-t pt-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase">Payment Details</p>
            {(['email', 'phone', 'amount', 'merchantName', 'merchantCategoryCode'] as const).map(
              (field) => (
                <div key={field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">
                    {field.replace(/([A-Z])/g, ' $1')}
                  </label>
                  <input
                    type="text"
                    value={form[field]}
                    onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              )
            )}
          </div>
          <button
            onClick={() => setStep(2)}
            className="w-full bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
          >
            Next: Review →
          </button>
        </div>
      )}

      {/* Step 2: Review (Encryption Explainer) */}
      {step === 2 && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="text-xl font-bold">🔐 Review Payment</h2>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 font-medium">
            🔒 PII fields encrypted before leaving your browser
          </div>
          <div className="rounded-lg border overflow-hidden text-sm">
            <div className="bg-gray-50 px-4 py-2 grid grid-cols-2 font-semibold text-gray-600 text-xs uppercase">
              <span>Field</span>
              <span>Sent to Atlas</span>
            </div>
            {[
              { label: '🔒 Email', value: form.email, type: 'qe-equality' as const, cipher: simulateCipher(form.email) },
              { label: '🔒 Phone', value: form.phone, type: 'qe-equality' as const, cipher: simulateCipher(form.phone) },
              { label: '🔒 Account Ref', value: 'auto-generated', type: 'qe-equality' as const, cipher: simulateCipher('ACC-') },
              { label: 'Card token', value: cardToken, type: 'plaintext' as const, cipher: cardToken },
              { label: 'Amount', value: `$${form.amount}`, type: 'plaintext' as const, cipher: form.amount },
              { label: 'Merchant', value: form.merchantName, type: 'plaintext' as const, cipher: form.merchantName },
            ].map(({ label, type, cipher }) => (
              <div key={label} className="px-4 py-2.5 grid grid-cols-2 border-t items-center">
                <div>
                  <EncryptionBadge label={label} type={type} />
                </div>
                <div className={`font-mono text-xs truncate ${type !== 'plaintext' ? 'text-yellow-700' : 'text-gray-600'}`}>
                  {type !== 'plaintext' ? cipher : cipher}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            PII fields are encrypted at origin. The card token is a surrogate — not cardholder
            data. Your KMS key controls decryption. MongoDB has zero access.
          </p>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 border rounded-lg py-2.5 text-gray-700 hover:bg-gray-50"
            >
              ← Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors disabled:opacity-50"
            >
              {submitting ? 'Processing…' : 'Confirm Payment →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirmation + Fraud Alert */}
      {step === 3 && result && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h2 className="text-xl font-bold">✅ Payment Confirmed</h2>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-1 text-sm">
            <p>
              <strong>Transaction:</strong>{' '}
              <span className="font-mono">{result.txnId.slice(0, 16)}…</span>
            </p>
            <p>
              <strong>Amount:</strong> ${form.amount} · {form.merchantName}
            </p>
            <p>
              <strong>Card:</strong> {maskedCard || '****-****-****-1234'}
            </p>
            <p>
              <strong>Time:</strong> {new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
            </p>
          </div>

          {result.fraudCaseCreated && result.caseId && (
            <FraudAlert
              caseId={result.caseId}
              severity="high"
              caseRef={result.caseRef ?? 'FD-SIM-XXXXXX'}
              investigationPath="/simulator/investigation"
            />
          )}

          {!result.fraudCaseCreated && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
              ✅ No fraud risk detected for this transaction.
            </div>
          )}

          <button
            onClick={() => {
              setStep(1);
              setForm(DEFAULTS);
              setMaskedCard('');
              setResult(null);
            }}
            className="w-full border rounded-lg py-2.5 text-gray-700 hover:bg-gray-50"
          >
            ← New Payment
          </button>
        </div>
      )}
    </div>
  );
}

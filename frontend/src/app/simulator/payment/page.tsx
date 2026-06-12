'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Merchant } from '../../../lib/api';
import { FraudAlert } from '../../../components/FraudAlert';
import { EncryptionBadge } from '../../../components/EncryptionBadge';
import { Tooltip } from '../../../components/Tooltip';
import { StepExplainer } from '../../../components/StepExplainer';
import { RedirectionPaymentFlow } from '../../../components/simulator/RedirectionPaymentFlow';
import { PaymentLinkFlow } from '../../../components/simulator/PaymentLinkFlow';
import type { PaymentMethodId, SimulatorScenario } from '../../../types/simulator';
import simulatorConfig from '../../../config/simulator.json';

type Step = 1 | 2 | 3;

interface FormData {
  cardholderName: string;
  expiry: string;
  email: string;
  phone: string;
  amount: string;
  merchantName: string;
  merchantCategoryCode: string;
}

// Default card number for demo (masked immediately on mount)
const DEMO_CARD_NUMBER = simulatorConfig.defaultCard;

// Test card presets for demo selection
const TEST_CARDS = simulatorConfig.testCards;

const DEFAULTS: FormData = {
  cardholderName: 'Luis Fernandez',
  expiry: '12/28',
  email: 'luis.fernandez@back.es',
  phone: '+44 7700 900123',
  amount: '850.00',
  merchantName: 'TechGadgets Ltd.',
  merchantCategoryCode: '5734',
};

// Preset amount options for quick selection
const AMOUNT_PRESETS = simulatorConfig.amountPresets;

// Fallback merchant list when DB is unavailable
const FALLBACK_MERCHANTS: Merchant[] = simulatorConfig.fallbackMerchants;

function maskCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  const last4 = digits.slice(-4).padStart(4, '*');
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

// -- Merchant combobox --------------------------------------------------------
function MerchantCombobox({
  value,
  mcc,
  merchants,
  onChange,
}: {
  value: string;
  mcc: string;
  merchants: Merchant[];
  onChange: (name: string, mcc: string) => void;
}) {
  const [custom, setCustom] = useState(false);

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === '__custom__') {
      setCustom(true);
      onChange(value, mcc);
    } else {
      const m = merchants.find((x) => x.name === e.target.value);
      if (m) onChange(m.name, m.mcc);
    }
  }

  if (custom) {
    return (
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value, mcc)}
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
          placeholder="Merchant name"
        />
        <button
          type="button"
          onClick={() => setCustom(false)}
          className="text-xs text-blue-600 underline whitespace-nowrap"
        >
          Use list
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={handleSelect}
      className="w-full border rounded-lg px-3 py-2 text-sm"
    >
      {merchants.map((m, idx) => (
        <option key={`${m.name}-${m.mcc}-${idx}`} value={m.name}>
          {m.name} (MCC {m.mcc})
        </option>
      ))}
      <option value="__custom__">✏ Enter custom merchant…</option>
    </select>
  );
}

// -- Amount selector ----------------------------------------------------------
function AmountSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(!AMOUNT_PRESETS.includes(value));

  if (custom) {
    return (
      <div className="flex gap-2 items-center">
        <span className="text-gray-500 text-sm">$</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
          placeholder="0.00"
        />
        <button
          type="button"
          onClick={() => setCustom(false)}
          className="text-xs text-blue-600 underline whitespace-nowrap"
        >
          Use presets
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {AMOUNT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
              value === preset
                ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]'
                : 'bg-white text-gray-700 border-gray-300 hover:border-[#001E2B]'
            }`}
          >
            ${preset}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom(true)}
          className="px-3 py-1 rounded-full text-sm border border-dashed border-gray-400 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          ✏ Custom
        </button>
      </div>
      <p className="text-xs text-amber-700">
        ⚠ Amounts above ${simulatorConfig.fraudAmountThreshold} trigger automatic fraud case creation.
      </p>
    </div>
  );
}

// -- Card selector ------------------------------------------------------------─
function CardSelector({
  maskedCard,
  onCardChange,
}: {
  maskedCard: string;
  onCardChange: (raw: string) => void;
}) {
  const [custom, setCustom] = useState(false);

  function handlePreset(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === '__custom__') {
      setCustom(true);
    } else if (e.target.value) {
      onCardChange(e.target.value);
    }
  }

  if (custom) {
    return (
      <div className="space-y-1">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Enter card number"
            onChange={(e) => onCardChange(e.target.value.replace(/\D/g, '').slice(0, 16))}
            className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm"
            maxLength={19}
          />
          <button
            type="button"
            onClick={() => setCustom(false)}
            className="text-xs text-blue-600 underline whitespace-nowrap"
          >
            Use presets
          </button>
        </div>
        {maskedCard && (
          <div className="font-mono text-gray-700 bg-gray-50 rounded px-3 py-2 flex items-center gap-2 text-sm">
            <span className="text-[#00ED64]">🔒</span> {maskedCard}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <select
        onChange={handlePreset}
        defaultValue=""
        className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
      >
        <option value="" disabled>Select a test card or enter custom…</option>
        {TEST_CARDS.map((c) => (
          <option key={c.number} value={c.number}>{c.label}</option>
        ))}
        <option value="__custom__">✏ Enter custom card number…</option>
      </select>
      {maskedCard && (
        <div className="font-mono text-gray-700 bg-gray-50 rounded px-3 py-2 flex items-center gap-2 text-sm">
          <span className="text-[#00ED64]">🔒</span> {maskedCard}
        </div>
      )}
      <p className="text-xs text-gray-500">
        Masked immediately. Raw PAN never stored. Leave blank to use the pre-filled demo card.
      </p>
    </div>
  );
}

// -- Validation ----------------------------------------------------------------
interface ValidationErrors {
  cardNumber?: string;
  email?: string;
  phone?: string;
  amount?: string;
  merchantName?: string;
}

function validateStep1(form: FormData, maskedCard: string): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!maskedCard) errors.cardNumber = 'Enter a card number to continue.';
  if (!form.email.includes('@')) errors.email = 'Enter a valid email address.';
  if (!form.phone.trim()) errors.phone = 'Phone number is required.';
  const amt = parseFloat(form.amount);
  if (!form.amount || isNaN(amt) || amt <= 0) errors.amount = 'Enter a valid amount greater than $0.';
  if (!form.merchantName.trim()) errors.merchantName = 'Merchant name is required.';
  return errors;
}

// -- Main component ------------------------------------------------------------
export default function PaymentPage() {
  const router = useRouter();
  const [simMethod, setSimMethod] = useState<PaymentMethodId | null>(null);
  const [simScenario, setSimScenario] = useState<SimulatorScenario | null>(null);
  const [methodReady, setMethodReady] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>(DEFAULTS);
  const [maskedCard, setMaskedCard] = useState<string>(maskCardNumber(DEMO_CARD_NUMBER));
  const [merchants, setMerchants] = useState<Merchant[]>(FALLBACK_MERCHANTS);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    txnId: string;
    fraudCaseCreated: boolean;
    caseId?: string;
    caseRef?: string;
    cardToken: string;
  } | null>(null);
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const cardTokenRef = useRef<string>(generateToken());

  // Read sim_method + sim_scenario from sessionStorage on mount
  useEffect(() => {
    const method = (sessionStorage.getItem('sim_method') as PaymentMethodId) ?? null;
    const scenarioId = sessionStorage.getItem('sim_scenario');
    setSimMethod(method);

    if (scenarioId) {
      const found = (simulatorConfig.scenarios as SimulatorScenario[]).find(s => s.id === scenarioId) ?? null;
      setSimScenario(found);
      if (found && method === 'api-card') {
        // Pre-fill form from scenario
        setForm({
          cardholderName: found.prefill.cardholderName,
          expiry: '12/28',
          email: found.prefill.email,
          phone: found.prefill.phone,
          amount: String(found.prefill.amount),
          merchantName: found.prefill.merchantName,
          merchantCategoryCode: found.prefill.merchantCategoryCode,
        });
      }
    }

    if (!method) {
      // No method selected; guard: redirect to landing
      router.replace('/simulator');
      return;
    }
    setMethodReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore step 3 from sessionStorage (existing api-card flow)
  useEffect(() => {
    if (simMethod !== 'api-card' || !methodReady) return;
    try {
      const saved = sessionStorage.getItem('sim_payment_step3');
      if (saved) {
        const parsed = JSON.parse(saved);
        const { savedResult, savedForm, savedMasked } = parsed._restore ?? parsed;
        cardTokenRef.current = savedResult.cardToken || cardTokenRef.current;
        setResult(savedResult);
        setForm(savedForm);
        setMaskedCard(savedMasked);
        setStep(3);
        setReturning(true);
        return;
      }
    } catch {
      sessionStorage.removeItem('sim_payment_step3');
    }

    api.transactions.merchants()
      .then((res) => {
        if (res.merchants.length > 0) {
          setMerchants(res.merchants);
          if (!simScenario) {
            const defaultMerchant = res.merchants.find((m) => m.name === DEFAULTS.merchantName)
              ?? res.merchants[0];
            setForm((f) => ({
              ...f,
              merchantName: defaultMerchant.name,
              merchantCategoryCode: defaultMerchant.mcc,
            }));
          }
        }
      })
      .catch(() => {/* keep fallback list */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simMethod, methodReady]);

  // ── Route to non-api-card flows ──────────────────────────────────────────
  if (!methodReady) {
    return (
      <div className="max-w-xl mx-auto text-center py-16 text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  if (simMethod === 'redirection') {
    const scenario = simScenario ?? (simulatorConfig.scenarios[0] as SimulatorScenario);
    return (
      <RedirectionPaymentFlow
        scenario={scenario}
      />
    );
  }

  if (simMethod === 'payment-link') {
    const scenario = simScenario ?? (simulatorConfig.scenarios[0] as SimulatorScenario);
    return (
      <PaymentLinkFlow
        scenario={scenario}
      />
    );
  }

  // ── API Card flow (default) ───────────────────────────────────────────────

  function handleMerchantChange(name: string, mcc: string) {
    setForm((f) => ({ ...f, merchantName: name, merchantCategoryCode: mcc }));
  }

  function handleNext() {
    const errors = validateStep1(form, maskedCard);
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors({});
    setError(null);
    setStep(2);
  }

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.transactions.create({
        cardToken: cardTokenRef.current,
        accountReference: form.email,
        amount: parseFloat(form.amount),
        currency: simulatorConfig.defaultCurrency,
        cardTransactionMerchantName: form.merchantName,
        cardTransactionMerchantCategoryCode: form.merchantCategoryCode,
        cardTransactionChannel: 'online',
        cardTransactionMaskedPanDisplay: maskedCard || '****-****-****-1234',
        cardTransactionType: 'purchase',
        cardTransactionDescription: form.merchantName.toUpperCase().slice(0, 22),
        // Acquiring-side link: the API-card flow charges the simulator merchant,
        // so the payment also surfaces in that merchant's received-payments view.
        merchantAgreementInstanceReference: simulatorConfig.merchantId,
        gatewayPayload: { source: 'simulator', timestamp: new Date().toISOString() },
      });

      const newResult = {
        txnId: res.cardTransactionInstanceReference,
        fraudCaseCreated: res.fraudCaseCreated,
        caseId: res.fraudDiagnosisInstanceReference,
        caseRef: res.fraudDiagnosisInstanceReference
          ? `FD-SIM-${res.fraudDiagnosisInstanceReference.slice(-6).toUpperCase()}`
          : undefined,
        cardToken: cardTokenRef.current,
      };
      try {
        sessionStorage.setItem('sim_payment_step3', JSON.stringify({
          cardTransactionInstanceReference: newResult.txnId,
          caseId: newResult.caseId ?? null,
          email: form.email,
          amount: parseFloat(form.amount),
          currency: simulatorConfig.defaultCurrency,
          merchantName: form.merchantName,
          method: 'api-card',
          customerName: simScenario?.persona ?? form.cardholderName,
          _restore: { savedResult: newResult, savedForm: form, savedMasked: maskedCard },
        }));
      } catch { /* ignore storage errors */ }
      setResult(newResult);
      setStep(3);
      // Transaction is persisted server-side; application-mode history reads it
      // from the real API (GET /api/v1/transactions/all), no local mirror needed.
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('fetch')) {
        setError('Cannot reach the backend server. Make sure the API is running on the configured port and try again.');
      } else {
        setError(msg || 'An unexpected error occurred while processing the payment.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    try { sessionStorage.removeItem('sim_payment_step3'); } catch { /* ignore */ }
    sessionStorage.removeItem('sim_method');
    sessionStorage.removeItem('sim_scenario');
    sessionStorage.removeItem('sim_step');
    setStep(1);
    setForm(DEFAULTS);
    setMaskedCard(maskCardNumber(DEMO_CARD_NUMBER));
    setResult(null);
    setReturning(false);
    setError(null);
    setValidationErrors({});
    cardTokenRef.current = generateToken();
    router.push('/simulator');
  }

  // -- Step indicator ----------------------------------------------------------
  const stepLabels = ['Card Details', 'Review & Encrypt', 'Confirmation'];

  return (
    <div className="max-w-xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-6">
        {([1, 2, 3] as Step[]).map((s) => (
          <div key={s} className="flex items-center gap-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s
                  ? 'bg-[#001E2B] text-[#00ED64] border-2 border-[#00ED64]'
                  : step > s
                  ? 'bg-[#00ED64] text-[#001E2B]'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {step > s ? '✓' : s}
            </div>
            {s < 3 && <div className={`h-px w-8 transition-colors ${step > s ? 'bg-[#00ED64]' : 'bg-gray-300'}`} />}
          </div>
        ))}
        <span className="text-sm text-gray-500 ml-2">
          Step {step} of 3: <strong>{stepLabels[step - 1]}</strong>
        </span>
      </div>

      {/* -- STEP 1: Card Details --------------------------------------------─ */}
      {step === 1 && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">💳 New Payment</h2>
            <StepExplainer title="Step 1: Card Details">
              <p>
                The customer enters their card details. The raw PAN (Primary Account Number) is
                masked immediately in the browser; it never enters component state or network traffic.
              </p>
              <p>
                A <strong>card token</strong> (surrogate reference) is generated locally and sent to
                the backend instead of the PAN. Under PCI DSS v4.0 a token is not Cardholder Data
                and can be stored in plaintext.
              </p>
              <p>
                PII fields (email, phone) will be encrypted with{' '}
                <strong>MongoDB Queryable Encryption</strong> before leaving the browser in Step 2.
              </p>
            </StepExplainer>
          </div>

          {/* Card number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Card Number
              <Tooltip text="Select a test card or enter a custom PAN. The raw PAN is masked immediately on input and is never stored in component state or sent to the server. A secure token is generated instead." />
            </label>
            <CardSelector
              maskedCard={maskedCard}
              onCardChange={(raw) => setMaskedCard(maskCardNumber(raw))}
            />
            {validationErrors.cardNumber && (
              <p className="text-xs text-red-600 mt-0.5">{validationErrors.cardNumber}</p>
            )}
          </div>

          {/* Cardholder name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cardholder Name
              <Tooltip text="Name as it appears on the card. Stored as plaintext, not classified as Cardholder Data under PCI DSS v4.0 when stored without a PAN." />
            </label>
            <input
              type="text"
              value={form.cardholderName}
              onChange={(e) => setForm((f) => ({ ...f, cardholderName: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          {/* Expiry */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expiry Date
              <Tooltip text="Card expiration date (MM/YY). Stored in the paymentCard collection with QE:none encryption: protected at rest, not searchable." />
            </label>
            <input
              type="text"
              value={form.expiry}
              onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 font-mono"
              placeholder="MM/YY"
            />
          </div>

          <div className="border-t pt-4 space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment Details</p>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
                <Tooltip text="Customer email address (QE:equality field). Encrypted with Queryable Encryption before being sent to Atlas. MongoDB stores only ciphertext and can still perform exact-match queries without seeing the plaintext." />
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => { setForm((f) => ({ ...f, email: e.target.value })); setValidationErrors((v) => ({ ...v, email: undefined })); }}
                className={`w-full border rounded-lg px-3 py-2 ${validationErrors.email ? 'border-red-400' : ''}`}
              />
              {validationErrors.email && (
                <p className="text-xs text-red-600 mt-0.5">{validationErrors.email}</p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mobile Phone
                <Tooltip text="Customer mobile number (QE:equality field). Encrypted at origin with Queryable Encryption. L1 Analysts can search by phone without Atlas seeing the plaintext number." />
              </label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => { setForm((f) => ({ ...f, phone: e.target.value })); setValidationErrors((v) => ({ ...v, phone: undefined })); }}
                className={`w-full border rounded-lg px-3 py-2 ${validationErrors.phone ? 'border-red-400' : ''}`}
              />
              {validationErrors.phone && (
                <p className="text-xs text-red-600 mt-0.5">{validationErrors.phone}</p>
              )}
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount (USD)
                <Tooltip text={`Transaction amount. Stored as plaintext in cardTransactionAmount. Amounts above $${simulatorConfig.fraudAmountThreshold} automatically trigger fraud case creation (configurable via FRAUD_AMOUNT_THRESHOLD env var). Selecting $850 will trigger a fraud alert.`} />
              </label>
              <AmountSelector value={form.amount} onChange={(v) => { setForm((f) => ({ ...f, amount: v })); setValidationErrors((v2) => ({ ...v2, amount: undefined })); }} />
              {validationErrors.amount && (
                <p className="text-xs text-red-600 mt-0.5">{validationErrors.amount}</p>
              )}
            </div>

            {/* Merchant Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Merchant Name
                <Tooltip text="Name of the business processing the payment. Stored as plaintext in cardTransactionMerchantName. Selecting a merchant also sets its ISO 18245 MCC code. Certain MCC codes (5812 restaurants, 6011 ATM, 7995 gambling) are high-risk and trigger fraud cases." />
              </label>
              <MerchantCombobox
                value={form.merchantName}
                mcc={form.merchantCategoryCode}
                merchants={merchants}
                onChange={handleMerchantChange}
              />
              {validationErrors.merchantName && (
                <p className="text-xs text-red-600 mt-0.5">{validationErrors.merchantName}</p>
              )}
            </div>

            {/* MCC (read-only display) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Merchant Category Code (MCC)
                <Tooltip text="ISO 18245 four-digit code classifying the merchant's business type. Set automatically when you select a merchant. High-risk codes (5812, 6011, 7995) trigger automatic fraud case creation regardless of transaction amount." />
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={form.merchantCategoryCode}
                  onChange={(e) => setForm((f) => ({ ...f, merchantCategoryCode: e.target.value }))}
                  className="w-28 border rounded-lg px-3 py-2 font-mono text-sm"
                  maxLength={4}
                />
                {['5812', '6011', '7995'].includes(form.merchantCategoryCode) && (
                  <span className="text-xs text-red-600 font-medium">⚠ High-risk MCC: fraud case will be created</span>
                )}
              </div>
            </div>
          </div>

          {/* Validation summary */}
          {Object.keys(validationErrors).length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              Please fix the highlighted fields before continuing.
            </div>
          )}

          <button
            onClick={handleNext}
            className="w-full bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
          >
            Next: Review & Encrypt →
          </button>
          <button onClick={handleReset} className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors py-1">
            ← Cancel and change scenario
          </button>
        </div>
      )}

      {/* -- STEP 2: Review (Encryption Explainer) --------------------------─ */}
      {step === 2 && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">🔐 Review & Encryption</h2>
            <StepExplainer title="Step 2: Review and Encryption">
              <p>
                Before the data is sent to MongoDB Atlas, the client-side MongoDB driver applies
                <strong> Queryable Encryption (QE)</strong> to PII fields.
              </p>
              <p>
                The table below shows what each field looks like <em>as stored in Atlas</em>.
                Fields marked 🔒 are encrypted ciphertext. Atlas never sees the plaintext values.
              </p>
              <p>
                Decryption happens only in the application process, using keys stored in your KMS
                (AWS KMS or local key provider). <strong>MongoDB has zero access to the keys.</strong>
              </p>
            </StepExplainer>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 font-medium">
            🔒 PII fields will be encrypted before leaving your browser
          </div>

          <div className="rounded-lg border overflow-hidden text-sm">
            <div className="bg-gray-50 px-4 py-2 grid grid-cols-2 font-semibold text-gray-600 text-xs uppercase tracking-wide">
              <span>
                Field
                <Tooltip text="Name of the field being sent to MongoDB Atlas." />
              </span>
              <span>
                Sent to Atlas
                <Tooltip text="Value as stored in Atlas. Encrypted fields show simulated ciphertext (🔒). Plaintext fields show the actual value." />
              </span>
            </div>
            {[
              {
                label: '🔒 Email',
                value: form.email,
                type: 'qe-equality' as const,
                cipher: simulateCipher(form.email),
                tooltip: 'QE:equality: encrypted at origin, searchable by exact match. Atlas stores only ciphertext.',
              },
              {
                label: '🔒 Phone',
                value: form.phone,
                type: 'qe-equality' as const,
                cipher: simulateCipher(form.phone),
                tooltip: 'QE:equality: encrypted at origin, searchable by exact match. Atlas stores only ciphertext.',
              },
              {
                label: '🔒 Account Ref',
                value: 'auto-generated',
                type: 'qe-equality' as const,
                cipher: simulateCipher('ACC-'),
                tooltip: 'QE:equality: a unique account reference generated server-side, stored encrypted, searchable by exact match.',
              },
              {
                label: 'Card Token',
                value: cardTokenRef.current,
                type: 'plaintext' as const,
                cipher: cardTokenRef.current,
                tooltip: 'Plain surrogate token (not the PAN). Under PCI DSS v4.0, a token is not Cardholder Data and may be stored in plaintext with a standard index.',
              },
              {
                label: 'Masked PAN',
                value: maskedCard,
                type: 'plaintext' as const,
                cipher: maskedCard,
                tooltip: 'Last-4 display only (****-****-****-XXXX). PCI DSS permits storing the last four digits in plaintext.',
              },
              {
                label: 'Amount',
                value: `$${form.amount}`,
                type: 'plaintext' as const,
                cipher: form.amount,
                tooltip: 'Transaction amount stored as plaintext. Not considered Cardholder Data under PCI DSS.',
              },
              {
                label: 'Merchant',
                value: form.merchantName,
                type: 'plaintext' as const,
                cipher: form.merchantName,
                tooltip: 'Merchant display name stored as plaintext. Not Cardholder Data.',
              },
              {
                label: 'MCC',
                value: form.merchantCategoryCode,
                type: 'plaintext' as const,
                cipher: form.merchantCategoryCode,
                tooltip: 'ISO 18245 Merchant Category Code stored as plaintext. Used for fraud risk evaluation.',
              },
            ].map(({ label, type, cipher, tooltip }) => (
              <div key={label} className="px-4 py-2.5 grid grid-cols-2 border-t items-center">
                <div className="flex items-center">
                  <EncryptionBadge label={label} type={type} />
                  <Tooltip text={tooltip} />
                </div>
                <div className={`font-mono text-xs truncate ${type !== 'plaintext' ? 'text-yellow-700' : 'text-gray-600'}`}>
                  {cipher}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500">
            PII fields are encrypted at origin. The card token is a surrogate, not cardholder data.
            Your KMS key controls decryption. MongoDB has zero access.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              <strong>Error:</strong> {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setStep(1); setError(null); }}
              className="flex-1 border rounded-lg py-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
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

      {/* -- STEP 3: Confirmation + Fraud Alert ------------------------------ */}
      {step === 3 && result && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          {returning && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-amber-800 font-medium">Simulation completed. Reset to run a new one.</span>
              <button
                onClick={handleReset}
                className="px-4 py-1.5 bg-[#001E2B] text-[#00ED64] rounded-lg text-sm font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
              >
                Restart Simulation
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">✅ Payment Confirmed</h2>
            <StepExplainer title="Step 3: Confirmation">
              <p>
                The transaction has been written to MongoDB Atlas. The QE-encrypted fields are stored
                as opaque ciphertext; no plaintext PII ever reaches the database server.
              </p>
              <p>
                If the amount exceeded <strong>${simulatorConfig.fraudAmountThreshold}</strong> or the MCC is high-risk, a
                <strong> FraudDiagnosisCase</strong> (BIAN SD-83) was automatically opened and you
                will be redirected to the Investigation Dashboard.
              </p>
              <p>
                In the Investigation Dashboard, analysts can search for this transaction by encrypted
                email or phone. Atlas runs the equality query without decrypting the stored values.
              </p>
            </StepExplainer>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Transaction ID</span>
              <span className="font-mono text-xs text-gray-800">
                {result.txnId.slice(0, 16)}…
                <Tooltip text="UUID of the cardTransaction document (BIAN SD-254 Control Record). Use this to fetch the transaction via GET /api/v1/transactions/:id." />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Amount</span>
              <span className="font-semibold">
                ${form.amount}
                <Tooltip text="Plaintext amount stored in cardTransactionAmount.amount. Not considered Cardholder Data under PCI DSS." />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Merchant</span>
              <span>
                {form.merchantName}
                <Tooltip text="Plaintext merchant name stored in cardTransactionMerchantName." />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Card</span>
              <span className="font-mono">
                {maskedCard || '****-****-****-1234'}
                <Tooltip text="Masked PAN (last 4 digits only). PCI DSS permits displaying this. The raw PAN was never stored." />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Token</span>
              <span className="font-mono text-xs">
                {result.cardToken}
                <Tooltip text="Card surrogate token generated client-side. This is what is stored in paymentCardReference, not the PAN." />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Time</span>
              <span className="text-xs">{new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC</span>
            </div>
          </div>

          {result.fraudCaseCreated && result.caseId && (
            <FraudAlert
              caseId={result.caseId}
              severity="high"
              caseRef={result.caseRef ?? 'FD-SIM-XXXXXX'}
              investigationPath="/simulator/investigation"
              noAutoRedirect={returning}
            />
          )}

          {!result.fraudCaseCreated && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
              ✅ No fraud risk detected for this transaction.
              <Tooltip text="No fraud case was created because the amount was below $500 and the MCC was not in the high-risk list (5812, 6011, 7995). Try $850 with MCC 5734 to trigger a fraud alert." />
            </div>
          )}

          <button
            onClick={handleReset}
            className="w-full border rounded-lg py-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ← New Payment
          </button>
        </div>
      )}
    </div>
  );
}

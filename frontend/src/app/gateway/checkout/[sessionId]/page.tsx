'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { Lock, CreditCard, CheckCircle, XCircle, Clock } from 'lucide-react';

type SessionData = Awaited<ReturnType<typeof api.checkout.getSession>>;
type PageState = 'loading' | 'ready' | 'paying' | 'success' | 'expired' | 'completed' | 'error';

// ---------------------------------------------------------------------------
// Registry of supported GET prefill params.
// To add a new field: declare the param name here and wire its setter in
// applyPrefillParams below. The simulator (or any other caller) just appends
// ?<param>=<value> to the checkout URL.
// ---------------------------------------------------------------------------
const PREFILL_PARAM_NAMES = ['name', 'card', 'expiry', 'email', 'savecard'] as const;
type PrefillParam = typeof PREFILL_PARAM_NAMES[number];

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Inner component: uses useSearchParams (requires Suspense boundary above)
// ---------------------------------------------------------------------------
function CheckoutPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<SessionData | null>(null);
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Form state
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');
  const [cardholderEmail, setCardholderEmail] = useState('');
  const [saveCard, setSaveCard] = useState(false);
  const [cvv, setCvv] = useState('');
  const [cvvTouched, setCvvTouched] = useState(false);
  const cvvValid = /^\d{3,4}$/.test(cvv);

  // Apply GET params to form fields. Add more params here as the payment form grows.
  const applyPrefillParams = useCallback((sp: ReturnType<typeof useSearchParams>) => {
    const get = (p: PrefillParam) => sp.get(p);

    const name = get('name');
    const card = get('card');
    const expiry = get('expiry');
    const email = get('email');
    const savecardParam = get('savecard');

    if (name) setCardholderName(name);
    if (card) setCardNumber(card.replace(/(\d{4})(?=\d)/g, '$1 ').trim());
    if (email) setCardholderEmail(email);
    if (savecardParam === 'true') setSaveCard(true);
    if (expiry) {
      const sep = expiry.includes('/') ? '/' : expiry.length === 4 ? '' : null;
      if (sep === '/') {
        const [mm, yy] = expiry.split('/');
        setExpiryMonth(mm ?? '');
        setExpiryYear(yy?.slice(-2) ?? '');
      } else if (sep === '') {
        setExpiryMonth(expiry.slice(0, 2));
        setExpiryYear(expiry.slice(2, 4));
      }
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const data = await api.checkout.getSession(sessionId);
      setSession(data);
      if (data.checkoutSessionStatus === 'expired') setState('expired');
      else if (data.checkoutSessionStatus === 'completed') setState('completed');
      else if (data.checkoutSessionStatus === 'cancelled') setState('expired');
      else {
        setState('ready');
        // Apply URL prefill params once session is confirmed active
        applyPrefillParams(searchParams);
        // Initialise countdown
        const expiresAtMs = new Date(data.checkoutSessionExpiresAt).getTime();
        setSecondsLeft(Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)));
      }
    } catch {
      setState('error');
      setError('Session not found or expired.');
    }
  }, [sessionId, searchParams, applyPrefillParams]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Live countdown: ticks every second, auto-expires when it hits zero
  useEffect(() => {
    if (secondsLeft === null || state !== 'ready') return;
    if (secondsLeft <= 0) {
      setState('expired');
      return;
    }
    const iv = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(iv);
          setState('expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [secondsLeft === null || secondsLeft <= 0 ? secondsLeft : 'ticking', state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (!cvvValid) { setCvvTouched(true); setError('Enter a valid CVV (3 or 4 digits).'); return; }
    setState('paying');
    setError('');

    const digits = cardNumber.replace(/\s/g, '');
    const lastFour = digits.slice(-4);
    const cardToken = `tok_${Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}${lastFour}`;

    try {
      const result = await api.checkout.pay(sessionId, {
        cardToken,
        cardholderName,
        cardExpiryMonth: expiryMonth.padStart(2, '0'),
        cardExpiryYear: `20${expiryYear}`,
        cardholderEmail: cardholderEmail || undefined,
        saveCard: saveCard || undefined,
      });
      if (result.success) {
        setState('success');
        setTimeout(() => {
          if (result.redirectUrl) router.push(result.redirectUrl);
        }, 2000);
      }
    } catch (err) {
      setState('ready');
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
    }
  }

  const formatAmount = (amount: number, currency: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

  // ── Static states ──────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Loading payment details...</div>
      </div>
    );
  }

  if (state === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <XCircle className="mx-auto mb-3 text-red-500" size={48} />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Session Expired</h2>
          <p className="text-sm text-gray-500">This payment session has expired or been cancelled. Please return to the merchant and try again.</p>
        </div>
      </div>
    );
  }

  if (state === 'completed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <CheckCircle className="mx-auto mb-3 text-green-500" size={48} />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Already Paid</h2>
          <p className="text-sm text-gray-500">This session has already been completed successfully.</p>
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <CheckCircle className="mx-auto mb-3 text-green-500" size={48} />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Payment Successful</h2>
          <p className="text-sm text-gray-500 mb-2">Redirecting you back to the merchant...</p>
          <div className="text-xs text-gray-400">Powered by MongoDB PSP</div>
        </div>
      </div>
    );
  }

  if (state === 'error' || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <XCircle className="mx-auto mb-3 text-red-500" size={48} />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Session Not Found</h2>
          <p className="text-sm text-gray-500">{error || 'Invalid or expired checkout session.'}</p>
        </div>
      </div>
    );
  }

  // ── Countdown display ─────────────────────────────────────────────────────
  const urgent = secondsLeft !== null && secondsLeft < 120;
  const countdownLabel = secondsLeft !== null
    ? `Session expires in ${formatCountdown(secondsLeft)}`
    : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-[#001E2B] text-white px-4 py-3 flex items-center gap-2">
        <Lock size={16} className="text-[#00ED64]" />
        <span className="font-semibold text-sm">Secure Payment</span>
        <span className="ml-auto text-xs text-gray-400">Powered by MongoDB Gateway</span>
      </header>

      <main className="flex-1 flex items-start justify-center py-8 px-4">
        <div className="w-full max-w-md space-y-4">
          {/* Order summary */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Payment to</div>
            <div className="font-semibold text-gray-800 text-lg">{session.merchantName}</div>
            <div className="text-gray-500 text-sm mt-1">{session.checkoutSessionDescription}</div>
            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
              <span className="text-gray-500 text-sm">Total</span>
              <span className="text-2xl font-bold text-gray-900">
                {formatAmount(session.checkoutSessionAmount, session.checkoutSessionCurrency)}
              </span>
            </div>
            {countdownLabel && (
              <div className={`mt-2 flex items-center gap-1.5 text-xs font-medium tabular-nums transition-colors ${urgent ? 'text-red-600' : 'text-amber-600'}`}>
                <Clock size={12} className={urgent ? 'animate-pulse' : ''} />
                {countdownLabel}
                {urgent && (
                  <span className="ml-auto bg-red-50 border border-red-200 text-red-600 rounded px-1.5 py-0.5 text-[10px]">
                    Expiring soon
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Card form */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard size={18} className="text-gray-600" />
              <span className="font-medium text-gray-700">Card Details</span>
              {cardholderName && (
                <span className="ml-auto text-xs text-[#00ED64] bg-[#001E2B] rounded px-2 py-0.5">
                  Pre-filled
                </span>
              )}
            </div>

            <form onSubmit={handlePay} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cardholder Name</label>
                <input
                  required
                  type="text"
                  value={cardholderName}
                  onChange={(e) => setCardholderName(e.target.value)}
                  placeholder="Name on card"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Card Number</label>
                <input
                  required
                  type="text"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value.replace(/[^\d\s]/g, '').slice(0, 19))}
                  placeholder="0000 0000 0000 0000"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]"
                  inputMode="numeric"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Expiry (MM / YY)</label>
                  <div className="flex gap-2">
                    <input
                      required
                      type="text"
                      value={expiryMonth}
                      onChange={(e) => setExpiryMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      placeholder="MM"
                      maxLength={2}
                      className="w-1/2 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]"
                    />
                    <input
                      required
                      type="text"
                      value={expiryYear}
                      onChange={(e) => setExpiryYear(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      placeholder="YY"
                      maxLength={2}
                      className="w-1/2 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">CVV</label>
                  <input
                    required
                    type="text"
                    inputMode="numeric"
                    value={cvv}
                    onChange={(e) => { setCvv(e.target.value.replace(/\D/g, '').slice(0, 4)); }}
                    onBlur={() => setCvvTouched(true)}
                    placeholder="•••"
                    maxLength={4}
                    aria-invalid={cvvTouched && !cvvValid}
                    className={`w-full border rounded-lg px-3 py-2 text-sm text-center font-mono focus:outline-none focus:ring-2 ${
                      cvvTouched && !cvvValid
                        ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
                        : 'border-gray-300 focus:ring-[#00ED64]/40 focus:border-[#00ED64]'
                    }`}
                  />
                  {cvvTouched && !cvvValid ? (
                    <p className="text-xs text-red-600 mt-0.5">Enter the 3 or 4 digit code.</p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">Validated locally, never stored (PCI DSS Req 3.2).</p>
                  )}
                </div>
              </div>

              {cardholderEmail && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveCard}
                    onChange={(e) => setSaveCard(e.target.checked)}
                    className="accent-[#00ED64] w-4 h-4"
                  />
                  <span className="text-xs text-gray-600">Save this card for future payments</span>
                </label>
              )}

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={state === 'paying' || !cvvValid}
                className="w-full bg-[#00ED64] hover:bg-[#00c94f] text-[#001E2B] font-semibold py-3 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {state === 'paying' ? 'Processing...' : `Pay ${formatAmount(session.checkoutSessionAmount, session.checkoutSessionCurrency)}`}
              </button>
            </form>
          </div>

          <div className="text-center">
            <a
              href={session.checkoutSessionCancelUrl}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Cancel and return to merchant
            </a>
          </div>

          <div className="text-center text-xs text-gray-400 flex items-center justify-center gap-1">
            <Lock size={11} />
            Card data is tokenized in your browser. The merchant never receives your card details.
          </div>
        </div>
      </main>
    </div>
  );
}

// Suspense boundary required by Next.js App Router for useSearchParams in pages
export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Loading payment details...</div>
      </div>
    }>
      <CheckoutPageInner />
    </Suspense>
  );
}

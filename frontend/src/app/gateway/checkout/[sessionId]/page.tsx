'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { deriveCardToken } from '../../../../lib/cardTokenize';
import { Lock, CreditCard, CheckCircle, XCircle, Clock, Eye, EyeOff, PlusCircle, Star } from 'lucide-react';

type SessionData = Awaited<ReturnType<typeof api.checkout.getSession>>;
type SavedCard = Awaited<ReturnType<typeof api.checkout.getSavedCards>>['results'][number];
type PageState = 'loading' | 'ready' | 'paying' | 'success' | 'declined' | 'expired' | 'completed' | 'error';

// Sentinel selection for "enter a new card" in the saved-card picker.
const NEW_CARD = 'new';

// ---------------------------------------------------------------------------
// Registry of supported GET prefill params.
// To add a new field: declare the param name here and wire its setter in
// applyPrefillParams below. The simulator (or any other caller) just appends
// ?<param>=<value> to the checkout URL.
// ---------------------------------------------------------------------------
const PREFILL_PARAM_NAMES = ['name', 'card', 'expiry', 'email'] as const;
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
  const [cvv, setCvv] = useState('');
  const [cvvTouched, setCvvTouched] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const cvvValid = /^\d{3,4}$/.test(cvv);

  // Saved cards (only when the session was created on behalf of a logged-in user). When a saved card
  // is selected we pay with its surrogate TOKEN and hide the name/number inputs; the payer still
  // supplies expiry + CVV to authorize. `NEW_CARD` (or an anonymous session) shows the full new-card form.
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>(NEW_CARD);
  const usingSavedCard = selectedCardId !== NEW_CARD;
  const selectedCard = usingSavedCard
    ? savedCards.find((c) => c.paymentCardInstanceReference === selectedCardId) ?? null
    : null;

  // Apply GET params to form fields. Add more params here as the payment form grows.
  const applyPrefillParams = useCallback((sp: ReturnType<typeof useSearchParams>) => {
    const get = (p: PrefillParam) => sp.get(p);

    const name = get('name');
    const card = get('card');
    const expiry = get('expiry');
    const email = get('email');

    if (name) setCardholderName(name);
    if (card) setCardNumber(card.replace(/(\d{4})(?=\d)/g, '$1 ').trim());
    if (email) setCardholderEmail(email);
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
        // If this session was created on behalf of a logged-in user, offer their saved cards. The
        // list is resolved server-side from the session's acting party (display-safe token + masked
        // PAN only). Default to the payer's preferred/first saved card for a faster one-tap pay.
        if (data.hasActingUser) {
          try {
            const { results } = await api.checkout.getSavedCards(sessionId);
            if (results.length > 0) {
              setSavedCards(results);
              // Optional ?card=<cardToken|cardRef> preselects a card, but ONLY if it belongs to
              // THIS user's saved cards (results are server-scoped to the session's acting party).
              // A token not owned by the payer is ignored, never auto-used (PCI DSS: never operate
              // another party's card-on-file; BIAN SD-88: the card belongs to the owner's agreement).
              const wanted = searchParams.get('card') ?? searchParams.get('cardToken');
              const match = wanted
                ? results.find((c) => c.cardToken === wanted || c.paymentCardInstanceReference === wanted)
                : null;
              const preselect = match ?? results.find((c) => c.paymentCardIsPreferred) ?? results[0];
              setSelectedCardId(preselect.paymentCardInstanceReference);
            }
          } catch { /* saved cards are best-effort; fall back to the new-card form */ }
        }
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

    // Saved card: pay with the stored surrogate TOKEN (never a PAN — we never held it). New card:
    // derive the deterministic token from the entered number (same PAN → same token, so re-paying
    // never duplicates a card-on-file). The name is cosmetic (the issuer never validates it, PCI
    // does not require it); for a saved card we send its alias/network as the display label.
    let cardToken: string;
    let payName: string;
    if (usingSavedCard && selectedCard) {
      cardToken = selectedCard.cardToken;
      payName = selectedCard.paymentCardAlias || selectedCard.paymentCardNetwork || 'Saved card';
    } else {
      const digits = cardNumber.replace(/\s/g, '');
      cardToken = await deriveCardToken(digits);
      payName = cardholderName;
    }

    try {
      const result = await api.checkout.pay(sessionId, {
        cardToken,
        cardholderName: payName,
        // Saved card: no expiry (the issuer authorizes on the token; only the CVV is re-checked).
        // New card: send the entered expiry.
        ...(usingSavedCard
          ? {}
          : { cardExpiryMonth: expiryMonth.padStart(2, '0'), cardExpiryYear: `20${expiryYear}` }),
        // Forward the entered CVV for issuer verification (never persisted; PCI Req 3.2). A wrong CVV declines.
        cardCvv: cvv,
        cardholderEmail: cardholderEmail || undefined,
      });
      if (result.success) {
        setState('success');
        setTimeout(() => {
          if (result.redirectUrl) router.push(result.redirectUrl);
        }, 2000);
      } else if (result.declined) {
        // A declined payment is a normal outcome: show the reason and return to the merchant.
        setError(result.declineReason || 'Your card was declined.');
        setState('declined');
        setTimeout(() => {
          if (result.redirectUrl) router.push(result.redirectUrl);
        }, 4000);
      } else {
        setState('ready');
        setError('Payment could not be completed. Please try again.');
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

  if (state === 'declined') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <XCircle className="mx-auto mb-3 text-red-500" size={48} />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Payment Declined</h2>
          <p className="text-sm text-gray-500 mb-2">{error || 'Your card was declined.'}</p>
          <p className="text-xs text-gray-400">Returning you to the merchant...</p>
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

            {/* Saved-card selector: shown only when the session belongs to a logged-in payer who has
                cards on file. Choosing a saved card pays with its token (no PAN entry); "Use a new
                card" reveals the full form. Accessible radio group. */}
            {savedCards.length > 0 && (
              <fieldset className="mb-4 space-y-2">
                <legend className="text-xs text-gray-500 mb-1">Pay with</legend>
                {/* Saved cards: show up to 3 in full; only when there are MORE than 3 do we cap the
                    height to ~3 rows and scroll (so 2 to 3 cards never look cut off). "Use a new card"
                    stays pinned below, outside the scroll. pr-1 kept always so widths align. */}
                <div className={`space-y-2 pr-1 ${savedCards.length > 3 ? 'max-h-[12rem] overflow-y-auto' : ''}`}>
                {savedCards.map((card) => {
                  const id = card.paymentCardInstanceReference;
                  const active = selectedCardId === id;
                  return (
                    <label
                      key={id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                        active ? 'border-[#00ED64] bg-[#00ED64]/5 ring-1 ring-[#00ED64]/40' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="savedCard"
                        value={id}
                        checked={active}
                        onChange={() => setSelectedCardId(id)}
                        className="accent-[#00ED64]"
                      />
                      <CreditCard size={18} className="text-gray-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {card.paymentCardAlias || card.paymentCardNetwork || 'Card'}
                          </span>
                          {card.paymentCardIsPreferred && (
                            <Star size={11} className="fill-amber-400 text-amber-400 shrink-0" aria-label="Default card" />
                          )}
                        </div>
                        <div className="text-xs text-gray-400 flex items-center gap-2">
                          <span className="font-mono">{card.paymentCardMaskedPanDisplay}</span>
                          {card.paymentCardNetwork && <><span>·</span><span>{card.paymentCardNetwork}</span></>}
                        </div>
                      </div>
                    </label>
                  );
                })}
                </div>
                {/* Pinned outside the scroll area so it is always reachable. Wrapped with the same
                    pr-1 and given a two-line layout so its width and height match the saved cards. */}
                <div className="pr-1">
                  <label
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                      selectedCardId === NEW_CARD ? 'border-[#00ED64] bg-[#00ED64]/5 ring-1 ring-[#00ED64]/40' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="savedCard"
                      value={NEW_CARD}
                      checked={selectedCardId === NEW_CARD}
                      onChange={() => setSelectedCardId(NEW_CARD)}
                      className="accent-[#00ED64]"
                    />
                    <PlusCircle size={18} className="text-gray-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-800">Use a new card</div>
                      <div className="text-xs text-gray-400">Enter your card details</div>
                    </div>
                  </label>
                </div>
              </fieldset>
            )}

            <form onSubmit={handlePay} className="space-y-3">
              {usingSavedCard && selectedCard ? (
                // Saved card chosen: name + number are on file, so they are neither shown nor
                // re-entered. Only the masked PAN is displayed (PCI: never the full PAN). The payer
                // still supplies expiry + CVV below to authorize.
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <div className="text-xs text-gray-400 mb-0.5">Paying with</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {selectedCard.paymentCardAlias || selectedCard.paymentCardNetwork || 'Saved card'}
                    </span>
                    <span className="font-mono text-xs text-gray-500">{selectedCard.paymentCardMaskedPanDisplay}</span>
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}

              <div className={`grid gap-3 ${usingSavedCard ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {/* Expiry is only entered for a NEW card. For a saved/tokenized card it is on file and
                    the issuer authorizes on the token, so the payer re-enters only the CVV below. */}
                {!usingSavedCard && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Expiry (MM / YY)</label>
                  <div className="flex gap-2">
                    <input
                      required={!usingSavedCard}
                      type="text"
                      value={expiryMonth}
                      onChange={(e) => setExpiryMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      placeholder="MM"
                      maxLength={2}
                      className="w-1/2 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]"
                    />
                    <input
                      required={!usingSavedCard}
                      type="text"
                      value={expiryYear}
                      onChange={(e) => setExpiryYear(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      placeholder="YY"
                      maxLength={2}
                      className="w-1/2 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]"
                    />
                  </div>
                </div>
                )}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">CVV</label>
                  <div className="relative">
                    <input
                      required
                      type={showCvv ? 'text' : 'password'}
                      inputMode="numeric"
                      autoComplete="off"
                      value={cvv}
                      onChange={(e) => { setCvv(e.target.value.replace(/\D/g, '').slice(0, 4)); }}
                      onBlur={() => setCvvTouched(true)}
                      placeholder="•••"
                      maxLength={4}
                      aria-invalid={cvvTouched && !cvvValid}
                      className={`w-full border rounded-lg pl-3 pr-9 py-2 text-sm text-center font-mono focus:outline-none focus:ring-2 ${
                        cvvTouched && !cvvValid
                          ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
                          : 'border-gray-300 focus:ring-[#00ED64]/40 focus:border-[#00ED64]'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCvv((s) => !s)}
                      aria-label={showCvv ? 'Hide CVV' : 'Show CVV'}
                      className="absolute inset-y-0 right-0 flex items-center px-2.5 text-gray-400 hover:text-gray-700"
                    >
                      {showCvv ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {cvvTouched && !cvvValid ? (
                    <p className="text-xs text-red-600 mt-0.5">Enter the 3 or 4 digit code.</p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">Validated locally, never stored (PCI DSS Req 3.2).</p>
                  )}
                </div>
              </div>

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

'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { deriveCardToken } from '../../../../lib/cardTokenize';
import { useViewerSavedCards, SavedCardSelector, PayingWithSummary, SignedInBadge } from '../../../../components/gateway/SavedCardSelector';
import { Lock, CreditCard, CheckCircle, XCircle, Eye, EyeOff, Copy, Check } from 'lucide-react';

type LinkData = Awaited<ReturnType<typeof api.paymentLinks.resolve>>;
type PageState = 'loading' | 'ready' | 'paying' | 'success' | 'declined' | 'unavailable' | 'error';

// Registry of GET prefill params. Add a new field here and wire it in applyPrefillParams.
const PREFILL_PARAM_NAMES = ['name', 'card', 'expiry', 'email'] as const;
type PrefillParam = typeof PREFILL_PARAM_NAMES[number];

function PaymentLinkPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const linkCode = params.linkCode as string;

  const [link, setLink] = useState<LinkData | null>(null);
  const [state, setState] = useState<PageState>('loading');
  const [txRef, setTxRef] = useState('');
  const [error, setError] = useState('');
  const [copiedRef, setCopiedRef] = useState(false);

  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [cvv, setCvv] = useState('');
  const [cvvTouched, setCvvTouched] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const cvvValid = /^\d{3,4}$/.test(cvv);

  // Saved cards belong to the AUTHENTICATED viewer of THIS browser (resolved from the PSP session
  // token, never from the link's creator). A shared link opened without a token shows no selector.
  // Choosing a saved card pays with its token (CVV only, no expiry); "Use a new card" shows the form.
  // Optional ?card=<cardToken|cardRef> preselects a card ONLY if the viewer owns it.
  const wantedCard = searchParams.get('card') ?? searchParams.get('cardToken');
  const { savedCards, selectedCardId, setSelectedCardId, selectedCard, usingSavedCard, viewerName } = useViewerSavedCards(wantedCard);

  const applyPrefillParams = useCallback((sp: ReturnType<typeof useSearchParams>) => {
    const get = (p: PrefillParam) => sp.get(p);
    const name = get('name');
    const card = get('card');
    const expiry = get('expiry');
    const email = get('email');

    if (name) setCardholderName(name);
    if (card) setCardNumber(card.replace(/(\d{4})(?=\d)/g, '$1 ').trim());
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
    if (email) setCustomerEmail(email);
  }, []);

  const loadLink = useCallback(async () => {
    try {
      const data = await api.paymentLinks.resolve(linkCode);
      setLink(data);
      if (data.paymentLinkStatus !== 'active') setState('unavailable');
      else {
        setState('ready');
        applyPrefillParams(searchParams);
      }
    } catch {
      setState('error');
      setError('Payment link not found.');
    }
  }, [linkCode, searchParams, applyPrefillParams]);

  useEffect(() => { loadLink(); }, [loadLink]);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!link) return;
    if (!cvvValid) { setCvvTouched(true); setError('Enter a valid CVV (3 or 4 digits).'); return; }
    setState('paying');
    setError('');

    // Saved card: pay with its stored surrogate TOKEN (never a PAN — we never held it) and omit
    // expiry (the issuer authorizes on the token; only the CVV is re-checked). New card: derive the
    // deterministic token from the entered number (same PAN → same token, so re-paying never
    // duplicates a card-on-file). The name is cosmetic; for a saved card we send its alias/network.
    let cardToken: string;
    let payName: string;
    if (usingSavedCard && selectedCard) {
      cardToken = selectedCard.cardToken;
      payName = selectedCard.paymentCardAlias || selectedCard.paymentCardNetwork || 'Saved card';
    } else {
      cardToken = await deriveCardToken(cardNumber.replace(/\s/g, ''));
      payName = cardholderName;
    }

    try {
      const result = await api.paymentLinks.pay(linkCode, {
        cardToken,
        cardholderName: payName,
        // Saved card: no expiry (issuer authorizes on the token). New card: send the entered expiry.
        ...(usingSavedCard
          ? {}
          : { cardExpiryMonth: expiryMonth.padStart(2, '0'), cardExpiryYear: `20${expiryYear}` }),
        // Forward the entered CVV for issuer verification (never persisted; PCI Req 3.2). A wrong CVV declines.
        cardCvv: cvv,
        customerEmail: customerEmail || undefined,
      });
      if (result.success) {
        setTxRef(result.cardTransactionInstanceReference ?? '');
        setState('success');
        // Notify parent frame when embedded as iframe in the simulator
        try {
          window.parent.postMessage(
            {
              type: 'sim_payment_link_complete',
              txnId: result.cardTransactionInstanceReference,
              caseId: result.fraudDiagnosisInstanceReference ?? null,
            },
            window.location.origin
          );
        } catch { /* not in iframe */ }
      } else if (result.declined) {
        // A declined payment is a normal outcome: show the reason (the buyer can retry).
        setError(result.declineReason || 'Your card was declined.');
        setState('declined');
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

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Loading payment details...</div>
      </div>
    );
  }

  if (state === 'success' && link) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <CheckCircle className="mx-auto mb-3 text-green-500" size={48} />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Payment Successful</h2>
          <p className="text-gray-500 text-sm mb-3">
            Thank you! Your payment of{' '}
            <strong>{formatAmount(link.paymentLinkAmount, link.paymentLinkCurrency)}</strong> to{' '}
            <strong>{link.merchantName}</strong> was completed.
          </p>
          {txRef && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2 font-mono break-all flex items-start justify-between gap-2 text-left">
              <span><span className="text-gray-400">Ref:</span> {txRef}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(txRef)
                    .then(() => setCopiedRef(true))
                    .catch(() => {});
                }}
                // Reset the confirmation on interaction end (no timers → no unmount/stale-closure races).
                onMouseLeave={() => setCopiedRef(false)}
                onBlur={() => setCopiedRef(false)}
                aria-label={copiedRef ? 'Reference copied' : 'Copy reference'}
                title={copiedRef ? 'Copied' : 'Copy reference'}
                className="shrink-0 text-gray-400 hover:text-green-600 focus:outline-none"
              >
                {copiedRef ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              </button>
            </div>
          )}
          <div className="mt-4 text-xs text-gray-400">Powered by Securit4 Pay (MongoDB PSP Platform)</div>
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
          <p className="text-sm text-gray-500 mb-4">{error || 'Your card was declined.'}</p>
          <button onClick={() => { setError(''); setState('ready'); }}
            className="text-sm text-[#001E2B] underline hover:no-underline">Try again</button>
        </div>
      </div>
    );
  }

  if (state === 'unavailable' && link) {
    const statusMessages: Record<string, string> = {
      completed: 'This payment link has already been used.',
      expired: 'This payment link has expired.',
      deactivated: 'This payment link is no longer active.',
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <XCircle className="mx-auto mb-3 text-red-500" size={48} />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Link Unavailable</h2>
          <p className="text-sm text-gray-500">{statusMessages[link.paymentLinkStatus] ?? 'This payment link is not available.'}</p>
        </div>
      </div>
    );
  }

  if (state === 'error' || !link) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <XCircle className="mx-auto mb-3 text-red-500" size={48} />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Not Found</h2>
          <p className="text-sm text-gray-500">{error || 'This payment link does not exist.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main className="flex-1 flex items-start justify-center py-8 px-4">
        <div className="w-full max-w-md space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Payment to</div>
            <div className="font-semibold text-gray-800 text-lg">{link.merchantName}</div>
            {/* Concept: clearly labeled so the payer sees exactly what they are being charged for. */}
            {link.paymentLinkDescription && (
              <div className="mt-3">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Concept</div>
                <div className="text-gray-700 text-sm">{link.paymentLinkDescription}</div>
              </div>
            )}
            {link.paymentLinkCustomerMessage && (
              <div className="mt-2 text-sm text-gray-600 italic bg-gray-50 rounded-lg px-3 py-2">
                {link.paymentLinkCustomerMessage}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
              <span className="text-gray-500 text-sm">Total</span>
              <span className="text-2xl font-bold text-gray-900">
                {formatAmount(link.paymentLinkAmount, link.paymentLinkCurrency)}
              </span>
            </div>
            {link.paymentLinkExpiresAt && (
              <div className="mt-1 text-xs text-amber-600">
                Expires: {new Date(link.paymentLinkExpiresAt).toLocaleString()}
              </div>
            )}
          </div>

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

            {/* Confirms the payer is recognised by the PSP (their session persists). Nothing when
                not logged in. */}
            <SignedInBadge name={viewerName} />

            {/* Saved-card selector: shown only when the AUTHENTICATED viewer of this browser has cards
                on file. Choosing a saved card pays with its token (no PAN entry); "Use a new card"
                reveals the full form. Identical UI on the redirect-checkout page. */}
            <SavedCardSelector savedCards={savedCards} selectedCardId={selectedCardId} onSelect={setSelectedCardId} />

            <form onSubmit={handlePay} className="space-y-3">
              {usingSavedCard && selectedCard ? (
                // Saved card chosen: name + number are on file, so they are neither shown nor
                // re-entered. Only the masked PAN is displayed (PCI: never the full PAN). The viewer
                // supplies only the CVV below to authorize (no expiry for a tokenized card).
                <PayingWithSummary card={selectedCard} />
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
                {/* Expiry only for a NEW card; a saved/tokenized card authorizes on the token, so the
                    viewer re-enters only the CVV. */}
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
                    <p className="text-xs text-gray-400 mt-0.5">Validated locally, never stored.</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Email (optional)</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]"
                />
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
                {state === 'paying' ? 'Processing...' : `Pay ${formatAmount(link.paymentLinkAmount, link.paymentLinkCurrency)}`}
              </button>
            </form>
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

export default function PaymentLinkPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Loading payment details...</div>
      </div>
    }>
      <PaymentLinkPageInner />
    </Suspense>
  );
}

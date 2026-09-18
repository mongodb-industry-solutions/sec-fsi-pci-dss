'use client';
import { useEffect, useMemo, useState } from 'react';
import { CreditCard, PlusCircle, Star, UserCheck } from 'lucide-react';
import { api, type SavedCardDisplay } from '../../lib/api';
import { getToken, isTokenExpired, decodeToken } from '../../lib/auth';
import { shouldAttemptSilentSignIn, silentSignInUrl } from '../../lib/silentSignIn';

// Sentinel selection for "enter a new card" in the saved-card picker.
export const NEW_CARD = 'new';

// ---------------------------------------------------------------------------
// Saved-card model for BOTH hosted payment pages (redirect checkout AND payment link).
//
// BROWSER-TOKEN ONLY: cards are surfaced only for the AUTHENTICATED viewer of THIS browser,
// identified by the session cookie on this origin. There is no fallback to the payment session's
// stored acting party: the checkout URL is a capability and not a proof of identity, so resolving
// cards from it would reveal that person's cards to anyone who opened the link.
//
// A payer who arrived from a merchant holds no cookie here, because they were authenticated at the
// AUTHORITY and the merchant's session lives on the merchant's own origin. Rather than trusting the
// link, this asks the authority who they are with `prompt=none` (see lib/silentSignIn.ts): either it
// answers from the session it already holds, and the cards are then read with a token minted for
// THIS browser's subject, or it refuses and the new-card form is what they get.
//
// Rows are display-safe only (surrogate token, masked PAN, network, alias, preferred flag). Never a
// full PAN, never the verification value, never the expiry.
// ---------------------------------------------------------------------------

/**
 * Sends the browser through the silent flow, once.
 *
 * `replace` rather than `assign`: a redirect chain leaves only its final URL in history, so the
 * payment page keeps its own entry and the back button does not walk into the flow again. The guard
 * is written BEFORE leaving, because the refusal comes back to this very page and the decision to
 * ask has to already be spent.
 */
function attemptSilentSignIn(): void {
  const here = window.location.pathname + window.location.search;
  const guard = `leafypay.silent.${window.location.pathname}`;
  if (!shouldAttemptSilentSignIn({
    hasToken: false,
    framed: window.self !== window.top,
    alreadyAttempted: sessionStorage.getItem(guard) === 'done',
  })) return;
  sessionStorage.setItem(guard, 'done');
  window.location.replace(silentSignInUrl(here));
}

/**
 * Fetch the saved cards to offer on a hosted payment page.
 *
 * SECURITY: cards are shown only for the AUTHENTICATED viewer of THIS browser, identified by the
 * session cookie read via getToken(). There is no fallback to the payment session's stored acting
 * party: opening a payment URL without being signed in must never reveal anyone's cards. With no
 * session here the authority is asked once, silently; if it refuses, new-card-only.
 *
 * @param wantedCard optional ?card=<cardToken|cardRef> to preselect, honoured ONLY
 *   if it belongs to the fetched cards (never auto-uses a card outside the shown set).
 */
export function useViewerSavedCards(wantedCard?: string | null) {
  const [savedCards, setSavedCards] = useState<SavedCardDisplay[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>(NEW_CARD);
  // Display name of the authenticated viewer (from their own session JWT), or null if not logged in.
  // Own PII shown to the authenticated owner only: no card data, no BIAN/PCI/GDPR deviation. Lets the
  // payer confirm the payment system recognises them (i.e. their PSP session persists).
  const [viewerName, setViewerName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = getToken();
        // Nobody signed in on this origin. Ask the authority once, in case the payer signed in there
        // through a merchant; until it answers there is no viewer, so no cards are loaded.
        if (!token || isTokenExpired(token)) {
          attemptSilentSignIn();
          return;
        }
        const name = decodeToken(token)?.name ?? null;
        if (!cancelled) setViewerName(name);
        // The viewer's OWN cards, caller-scoped by the backend from the token itself.
        const { results } = await api.customer.getMyCards(token);
        if (cancelled || results.length === 0) return;
        setSavedCards(results);
        // Preselect the requested card ONLY if it belongs to the shown set; otherwise
        // fall back to the preferred/first card (PCI: never operate a card outside the set).
        const match = wantedCard
          ? results.find((c) => c.cardToken === wantedCard || c.paymentCardInstanceReference === wantedCard)
          : null;
        const preselect = match ?? results.find((c) => c.paymentCardIsPreferred) ?? results[0];
        setSelectedCardId(preselect.paymentCardInstanceReference);
      } catch {
        // Saved cards are best-effort; on any failure fall back to the new-card form.
      }
    })();
    return () => { cancelled = true; };
  }, [wantedCard]);

  const usingSavedCard = selectedCardId !== NEW_CARD;
  const selectedCard = useMemo(
    () => (usingSavedCard ? savedCards.find((c) => c.paymentCardInstanceReference === selectedCardId) ?? null : null),
    [usingSavedCard, savedCards, selectedCardId],
  );

  return { savedCards, selectedCardId, setSelectedCardId, selectedCard, usingSavedCard, viewerName };
}

// Small badge confirming the payer is recognised by the PSP (their session persists). Renders
// nothing when there is no authenticated viewer. Shows only the viewer's OWN display name.
export function SignedInBadge({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#00ED64]/40 bg-[#00ED64]/5 px-3 py-2 mb-4">
      <UserCheck size={15} className="text-[#00684A] shrink-0" />
      <span className="text-xs text-gray-600">
        Signed in as <span className="font-medium text-gray-800">{name}</span>
      </span>
    </div>
  );
}

// The saved-card radio group. Shown only when the viewer has cards on file. Choosing a saved card
// pays with its token (no PAN entry); "Use a new card" reveals the full form. Up to 3 cards show in
// full; more than 3 caps the height to ~3 rows and scrolls, with "Use a new card" pinned below,
// outside the scroll, matching the row width/height.
export function SavedCardSelector({
  savedCards,
  selectedCardId,
  onSelect,
}: {
  savedCards: SavedCardDisplay[];
  selectedCardId: string;
  onSelect: (id: string) => void;
}) {
  if (savedCards.length === 0) return null;
  return (
    <fieldset className="mb-4 space-y-2">
      <legend className="text-xs text-gray-500 mb-1">Pay with</legend>
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
                onChange={() => onSelect(id)}
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
      {/* Pinned outside the scroll area so it is always reachable; same pr-1 + two-line layout so its
          width and height match the saved-card rows. */}
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
            onChange={() => onSelect(NEW_CARD)}
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
  );
}

// The "Paying with" summary shown in place of the name/number inputs when a saved card is chosen.
// Only the masked PAN is displayed (never the full PAN); the viewer still supplies the CVV to authorize.
export function PayingWithSummary({ card }: { card: SavedCardDisplay }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
      <div className="text-xs text-gray-400 mb-0.5">Paying with</div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-800 truncate">
          {card.paymentCardAlias || card.paymentCardNetwork || 'Saved card'}
        </span>
        <span className="font-mono text-xs text-gray-500">{card.paymentCardMaskedPanDisplay}</span>
      </div>
    </div>
  );
}

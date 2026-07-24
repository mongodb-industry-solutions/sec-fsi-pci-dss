// cspell:ignore BIAN
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, awaitPaymentOutcome } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { useDebugMode } from '../../../lib/debugMode';
import { FraudAlert } from '../../../components/FraudAlert';
import { Tooltip } from '../../../components/Tooltip';
import { detectNetwork, tokenizeCard } from '../../../lib/cardTokenize';
import Link from 'next/link';

// A saved card-on-file (BIAN SD-88) the customer can pay with. The surrogate token is reused so
// the transaction references the real stored card; the full PAN/CVV are never present here.
interface SavedCard {
  id: string;
  alias: string;
  masked: string;
  network: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
  token: string;
  isPreferred: boolean;
}

interface MerchantOption {
  id: string;
  label: string;
  mcc: string;
  risk: 'low' | 'medium' | 'high';
}

// MCC category hints for display
function mccNote(mcc: string): string {
  const map: Record<string, string> = {
    '5411': 'Grocery', '5734': 'Electronics', '5812': 'Restaurant',
    '5813': 'Nightlife', '6011': 'ATM/Cash', '7995': 'Gambling',
    '4816': 'Internet Svcs', '5999': 'Retail', '5045': 'Computers',
    '7011': 'Hotels', '5912': 'Pharmacy',
  };
  return map[mcc] ?? `MCC ${mcc}`;
}

const genToken = () => `pm_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

// Static fallback; shown only if the API call fails (network error, not yet seeded)
const MERCHANT_FALLBACK: MerchantOption[] = [
  { id: '', label: 'TechGadgets Ltd.',  mcc: '5734', risk: 'low' },
  { id: '', label: 'Casino Royale',     mcc: '7995', risk: 'high' },
  { id: '', label: 'Metro Supermarket', mcc: '5411', risk: 'low' },
  { id: '', label: 'Night Club XL',     mcc: '5813', risk: 'high' },
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

  // Merchant list state
  const [merchantPresets, setMerchantPresets] = useState<MerchantOption[]>(MERCHANT_FALLBACK);
  const [merchantsLoading, setMerchantsLoading] = useState(true);
  const [merchantSearch, setMerchantSearch] = useState('');
  const [searchResults, setSearchResults] = useState<MerchantOption[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) { setMerchantsLoading(false); return; }
    api.merchants.picker({ limit: 4 }, t)
      .then(({ results }) => {
        if (results.length > 0) {
          setMerchantPresets(results.map(r => ({
            id: r.merchantAgreementInstanceReference,
            label: r.merchantName,
            mcc: r.merchantCategoryCode,
            risk: r.merchantRiskCategory,
          })));
        }
      })
      .catch(() => { /* keep fallback */ })
      .finally(() => setMerchantsLoading(false));
  }, []);

  // Debounced merchant search
  useEffect(() => {
    if (!merchantSearch.trim()) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const tok = getToken() ?? '';
        const { results } = await api.merchants.picker({ q: merchantSearch.trim(), limit: 8 }, tok);
        setSearchResults(results.map(r => ({
          id: r.merchantAgreementInstanceReference,
          label: r.merchantName,
          mcc: r.merchantCategoryCode,
          risk: r.merchantRiskCategory,
        })));
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [merchantSearch]);

  // Saved cards the customer can pay with (their own card-on-file, SD-88).
  const [savedCards, setSavedCards]         = useState<SavedCard[]>([]);
  const [cardsLoading, setCardsLoading]     = useState(true);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<SavedCard['network'] | null>(null);
  const [maskedCard, setMaskedCard]         = useState('');
  const [cardToken, setCardToken]           = useState(() => genToken());
  // Card picker: 'saved' = pay with a card-on-file; 'new' = enter a fresh card (gets auto-saved).
  const [cardMode, setCardMode]             = useState<'saved' | 'new'>('saved');
  const [cardSearch, setCardSearch]         = useState('');
  // New-card entry (tokenized in-browser on Next; CVV validated, never sent/stored).
  const [newPan, setNewPan]                 = useState('');
  const [newExpiry, setNewExpiry]           = useState('');
  const [newCvv, setNewCvv]                 = useState('');
  const [newCardExpiry, setNewCardExpiry]   = useState('');
  const [amount, setAmount]                 = useState('850.00');
  const [merchant, setMerchant]             = useState('');
  const [mcc, setMcc]                       = useState('');
  const [selectedMerchantId, setSelectedMerchantId] = useState('');
  const [channel, setChannel]               = useState('online');
  const [initiationType, setInitiationType] = useState('customerInitiated');
  const [paymentReference, setPaymentReference] = useState('');
  const [txDescription, setTxDescription]   = useState('');
  const [txNarrative, setTxNarrative]       = useState(NARRATIVE_PRESETS[0]);
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const { debugMode }                       = useDebugMode();
  const [result, setResult] = useState<{
    txnId: string; fraudCaseCreated: boolean; caseId?: string; maskedPan: string
  } | null>(null);

  // Once merchant presets load, auto-select the first one (replaces old hard-coded default)
  useEffect(() => {
    if (!merchantsLoading && merchant === '' && merchantPresets.length > 0) {
      const first = merchantPresets[0];
      setMerchant(first.label);
      setMcc(first.mcc);
      setSelectedMerchantId(first.id);
      setTxDescription(first.label.toUpperCase().slice(0, 22));
    }
  }, [merchantsLoading, merchantPresets, merchant]);

  // Select one of the customer's saved cards: reuse its masked PAN, network and surrogate token.
  function selectSavedCard(c: SavedCard) {
    setCardMode('saved');
    setSelectedCardId(c.id);
    setSelectedNetwork(c.network);
    setMaskedCard(c.masked);
    setCardToken(c.token);
    setCardSearch('');
  }

  // Switch to entering a brand-new card. It is tokenized on Next and auto-saved on payment.
  function enterNewCardMode() {
    setCardMode('new');
    setSelectedCardId(null);
    setSelectedNetwork(null);
    setMaskedCard('');
    setCardToken(genToken());
  }

  // Live formatting / network detection while typing a new card (display only).
  function handleNewPan(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 19);
    setNewPan(digits.replace(/(.{4})/g, '$1 ').trim());
    setSelectedNetwork(detectNetwork(digits));
    setMaskedCard(digits.length >= 4 ? `****-****-****-${digits.slice(-4)}` : '');
  }
  function handleNewExpiry(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    setNewExpiry(digits.length >= 3 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
  }

  // Load the customer's saved cards (SD-88) to offer as payment methods.
  useEffect(() => {
    const t = getToken() ?? '';
    if (!t) { setCardsLoading(false); return; }
    api.auth.me(t)
      .then(async (me) => {
        const agId = (me.agreement as { customerAgreementInstanceReference?: string } | null)?.customerAgreementInstanceReference;
        if (!agId) return;
        const { results } = await api.customer.getCards(agId, t);
        const active = (results ?? [])
          .filter((c) => c.paymentCardStatus === 'active')
          .map((c) => ({
            id: c.paymentCardInstanceReference as string,
            alias: (c.paymentCardAlias as string | undefined) || (c.paymentCardNetwork as string | undefined) || 'Card',
            masked: (c.paymentCardMaskedPanDisplay as string | undefined) ?? '',
            network: c.paymentCardNetwork as SavedCard['network'],
            token: c.paymentCardReference as string,
            isPreferred: !!c.paymentCardIsPreferred,
          }));
        // Default card first so it lands among the (max 4) preselected and is auto-selected.
        active.sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred));
        setSavedCards(active);
      })
      .catch(() => { /* manual entry remains available */ })
      .finally(() => setCardsLoading(false));
  }, []);

  // Auto-select the customer's DEFAULT card (the one marked preferred), falling back to the first.
  // With no saved cards, default to new-card entry.
  useEffect(() => {
    if (cardsLoading || selectedCardId || maskedCard !== '') return;
    if (savedCards.length > 0) selectSavedCard(savedCards.find((c) => c.isPreferred) ?? savedCards[0]);
    else setCardMode('new');
  }, [cardsLoading, savedCards]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectMerchantOption(m: MerchantOption) {
    setMerchant(m.label);
    setMcc(m.mcc);
    setSelectedMerchantId(m.id);
    setTxDescription(m.label.toUpperCase().slice(0, 22));
    setMerchantSearch('');
    setSearchResults(null);
  }

  const selectedMerchantPreset = merchantPresets.find(m => m.label === merchant && m.mcc === mcc);

  // Card picker: show at most 4 cards; the rest are reachable via the search/autocomplete box.
  const cardPresets = savedCards.slice(0, 4);
  const cardSearchResults = cardSearch.trim()
    ? savedCards.filter(c => `${c.alias} ${c.masked} ${c.network}`.toLowerCase().includes(cardSearch.trim().toLowerCase()))
    : null;

  async function handleConfirm() {
    // A saved card is identified by its surrogate token (used to charge); a new card by the
    // masked PAN derived from the digits typed. maskedCard alone is display-only, so gate on
    // the value that actually drives the charge for the current mode.
    const hasCard = cardMode === 'saved' ? !!cardToken : !!maskedCard;
    if (!hasCard) { setError('Please select or enter a card.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const payload = decodeToken(token);
      const res = await api.transactions.create({
        cardToken,
        // Use the authenticated customer's email so the backend normalizes the
        // transaction to their canonical account reference and it shows in history.
        accountReference: payload?.email ?? `ACC-DEMO-${Date.now().toString(36).toUpperCase()}`,
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
        ...(selectedMerchantId ? { merchantAgreementInstanceReference: selectedMerchantId } : {}),
        // New card → send expiry + network so the PSP auto-registers it as a card-on-file (SD-88).
        ...(cardMode === 'new' && selectedNetwork ? { paymentCardExpirationDate: newCardExpiry, paymentCardNetwork: selectedNetwork } : {}),
        gatewayPayload: { source: 'app-mode', paymentReference: paymentReference || undefined },
      }, token);

      // dev.v8 F3: the payment is PENDING; wait for the issuer's async decision over SSE.
      const txnId = res.cardTransactionInstanceReference;
      const outcome = await awaitPaymentOutcome(txnId);
      if (outcome.status === 'declined') {
        setError(`The card issuer declined this payment${outcome.declineReason ? ` (${outcome.declineReason.replace(/_/g, ' ')})` : ''}. No charge was made.`);
        return;
      }
      // Persisted server-side; history reads from the real API (no local mirror).
      setResult({ txnId, fraudCaseCreated: !!outcome.fraudCaseCreated, caseId: outcome.caseId ?? undefined, maskedPan: maskedCard });
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
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-1.5 font-semibold text-gray-800">
                    Card
                    <Tooltip text="The card to charge. Pick one of your saved cards, search for another, or enter a new card; new cards are tokenized in your browser and saved to your wallet after payment." />
                  </h2>
                  <Link href="/system/cards" className="text-xs text-[#001E2B] hover:underline">Manage cards</Link>
                </div>

                {/* Saved-card picker (SD-88): up to 4 presets + search/autocomplete for the rest,
                    mirroring the Merchant picker. Selecting one reuses its surrogate token. */}
                {cardsLoading ? (
                  <div className="grid grid-cols-2 gap-2">
                    {[0, 1].map(i => <div key={i} className="rounded-lg border px-3 py-2.5 animate-pulse bg-gray-50 h-[52px]" />)}
                  </div>
                ) : savedCards.length > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {cardPresets.map((c) => {
                        const active = cardMode === 'saved' && selectedCardId === c.id;
                        return (
                          <button key={c.id} onClick={() => selectSavedCard(c)}
                            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                              active ? 'border-[#001E2B] bg-[#001E2B] text-white' : 'hover:border-gray-400'
                            }`}>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold truncate">{c.alias}</span>
                              {c.isPreferred && (
                                <span className={`text-[10px] px-1 py-0.5 rounded font-medium shrink-0 ${active ? 'bg-white/20 text-[#00ED64]' : 'bg-amber-50 text-amber-600'}`}>
                                  Default
                                </span>
                              )}
                            </div>
                            <div className={`font-mono text-xs mt-0.5 ${active ? 'text-gray-300' : 'text-gray-400'}`}>
                              {c.network ? `${c.network} ` : ''}...{c.masked.slice(-4)}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Search the rest of the wallet */}
                    {savedCards.length > 4 && (
                      <div className="relative">
                        <input
                          value={cardSearch}
                          onChange={(e) => setCardSearch(e.target.value)}
                          placeholder="Search your other cards..."
                          className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30"
                        />
                        {cardSearchResults !== null && cardSearchResults.length === 0 && (
                          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded-lg shadow-md px-3 py-2 text-sm text-gray-400">
                            No matching cards
                          </div>
                        )}
                        {cardSearchResults !== null && cardSearchResults.length > 0 && (
                          <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded-lg shadow-md divide-y overflow-y-auto max-h-48">
                            {cardSearchResults.map((c) => (
                              <li key={c.id}>
                                <button onClick={() => selectSavedCard(c)}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
                                  <span className="font-medium">{c.alias}</span>
                                  <span className="ml-2 text-xs text-gray-400 font-mono">{c.network ? `${c.network} ` : ''}...{c.masked.slice(-4)}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </>
                ) : null}

                {/* New-card entry: tokenized in-browser on Next; CVV validated, never stored. */}
                {cardMode === 'new' ? (
                  <div className="space-y-2 rounded-lg border border-[#001E2B]/20 bg-[#001E2B]/[0.03] p-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        New card
                        <Tooltip text="Enter a card not yet in your wallet. It is validated and tokenized in your browser (only the last 4 digits are stored) and saved to your wallet after a successful payment." />
                      </span>
                      {savedCards.length > 0 && (
                        <button onClick={() => selectSavedCard(savedCards[0])} className="text-xs text-[#001E2B] hover:underline">
                          Use a saved card
                        </button>
                      )}
                    </div>
                    <input value={newPan} onChange={(e) => handleNewPan(e.target.value)} inputMode="numeric"
                      placeholder="Card number" maxLength={23}
                      className="w-full border rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={newExpiry} onChange={(e) => handleNewExpiry(e.target.value)} inputMode="numeric"
                        placeholder="MM/YY" maxLength={5}
                        className="w-full border rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />
                      <input value={newCvv} onChange={(e) => setNewCvv(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric"
                        placeholder={selectedNetwork === 'AMEX' ? 'CVV (4)' : 'CVV (3)'}
                        className="w-full border rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />
                    </div>
                    <p className="text-xs text-gray-400">
                      {selectedNetwork ? `${selectedNetwork} · ` : ''}Validated in your browser. The security code is never stored
                      {debugMode ? ' (PCI DSS Req 3.2; SAD prohibited).' : '.'}
                    </p>
                  </div>
                ) : (
                  <button onClick={enterNewCardMode}
                    className="w-full border border-dashed rounded-lg px-3 py-2.5 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors">
                    + Use a new card
                  </button>
                )}

                <div>
                  <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                    Amount (USD)
                    <Tooltip text="The purchase amount to authorize. Amounts above the risk threshold (default $500) automatically open a fraud review case." />
                  </label>
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
                <h2 className="flex items-center gap-1.5 font-semibold text-gray-800">
                  Merchant
                  <Tooltip text="The business you are paying (BIAN SD-89). Pick one of the first four, search for another, or type a name and MCC manually. Some categories (e.g. gambling) are higher risk and influence fraud scoring." />
                </h2>

                {/* Preset grid; first 4 active merchants from SD-89 */}
                {merchantsLoading ? (
                  <div className="grid grid-cols-2 gap-2">
                    {[0, 1, 2, 3].map(i => (
                      <div key={i} className="rounded-lg border px-3 py-2.5 animate-pulse bg-gray-50 h-[52px]" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {merchantPresets.map((m) => (
                      <button key={`${m.label}-${m.mcc}`} onClick={() => selectMerchantOption(m)}
                        className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                          selectedMerchantPreset?.label === m.label && selectedMerchantPreset?.mcc === m.mcc
                            ? 'border-[#001E2B] bg-[#001E2B] text-white'
                            : 'hover:border-gray-400'
                        }`}>
                        <div className="text-xs font-semibold truncate">{m.label}</div>
                        <div className={`text-xs mt-0.5 flex items-center gap-1 ${
                          selectedMerchantPreset?.label === m.label && selectedMerchantPreset?.mcc === m.mcc
                            ? 'text-gray-300'
                            : m.risk === 'high' ? 'text-amber-500' : 'text-gray-400'
                        }`}>
                          {m.risk === 'high' && '⚠ '}{mccNote(m.mcc)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Search for merchants not in the initial 4 */}
                <div className="relative">
                  <input
                    value={merchantSearch}
                    onChange={(e) => setMerchantSearch(e.target.value)}
                    placeholder="Search more merchants..."
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30"
                  />
                  {searchLoading && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">Loading…</span>
                  )}
                  {searchResults !== null && searchResults.length === 0 && !searchLoading && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded-lg shadow-md px-3 py-2 text-sm text-gray-400">
                      No active merchants found
                    </div>
                  )}
                  {searchResults !== null && searchResults.length > 0 && (
                    <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded-lg shadow-md divide-y overflow-y-auto max-h-48">
                      {searchResults.map(m => (
                        <li key={`${m.label}-${m.mcc}`}>
                          <button onClick={() => selectMerchantOption(m)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
                            <span className="font-medium">{m.label}</span>
                            <span className={`ml-2 text-xs ${m.risk === 'high' ? 'text-amber-500' : 'text-gray-400'}`}>
                              {m.risk === 'high' && '⚠ '}{mccNote(m.mcc)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    Merchant name
                    <Tooltip text="The display name of the business. Auto-filled when you pick or search a merchant; editable for ad-hoc payments." />
                  </label>
                  <input value={merchant} onChange={(e) => { setMerchant(e.target.value); setSelectedMerchantId(''); }}
                    placeholder="Merchant name"
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    MCC code
                    <Tooltip text="ISO 18245 Merchant Category Code; a 4-digit code identifying the merchant's business type (e.g. 5411 grocery, 7995 gambling). Drives risk scoring." />
                  </label>
                  <input value={mcc} onChange={(e) => setMcc(e.target.value)}
                    placeholder="MCC code"
                    className="w-full border rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30" />
                </div>
              </div>
            </div>

            {/* Action row - global, outside panels, same pattern as Step 2 */}
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3">
              <Link href="/system/payment/history"
                className="flex-1 sm:flex-none sm:w-32 border rounded-lg py-2.5 text-sm text-center text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </Link>
              <button
                onClick={async () => {
                  if (cardMode === 'new') {
                    try {
                      const tk = await tokenizeCard({ pan: newPan, expiry: newExpiry, cvv: newCvv });
                      setMaskedCard(tk.maskedPan);
                      setCardToken(tk.token);
                      setSelectedNetwork(tk.network);
                      setNewCardExpiry(tk.expiry);
                    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid card details.'); return; }
                  } else if (!cardToken) {
                    // Saved mode: the surrogate token identifies the card (masked PAN is display-only).
                    setError('Please select or enter a card.'); return;
                  }
                  setError(null); setStep(2);
                }}
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
                      <span className="font-mono">{maskedCard}{selectedNetwork ? ` (${selectedNetwork})` : ''}</span>
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
                  investigationPath="/system/investigation"
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

            <button onClick={() => router.push('/system/payment/history')}
              className="w-full border rounded-lg py-2.5 text-sm text-gray-700 hover:bg-gray-50 bg-white">
              View My Transactions
            </button>
          </div>
        )}

      </main>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, Lock } from 'lucide-react';
import { Breadcrumb } from '../../../../components/Breadcrumb';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { useDebugMode } from '../../../../lib/debugMode';
import { useNotify } from '../../../../components/ui/ConfirmProvider';
import { Tooltip } from '../../../../components/Tooltip';
import { detectNetwork, tokenizeCard } from '../../../../lib/cardTokenize';

// Register a new card-on-file (BIAN SD-88). The PAN, expiry and CVV are entered here, validated and
// tokenized IN THE BROWSER: only the masked PAN + surrogate token + expiry + network are sent to
// the server. The CVV (SAD) is validated and discarded; never transmitted or stored (PCI DSS Req 3).
export default function NewCardPage() {
  const router = useRouter();
  const notify = useNotify();
  const { debugMode } = useDebugMode();

  const [token, setToken] = useState('');
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [pan, setPan] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [alias, setAlias] = useState('');
  const [preferred, setPreferred] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = getToken() ?? '';
    const role = t ? decodeToken(t)?.role : null;
    if (role !== 'customer') { router.replace('/system'); return; }
    setToken(t);
    api.auth.me(t)
      .then((me) => {
        const id = (me.agreement as { customerAgreementInstanceReference?: string } | null)?.customerAgreementInstanceReference ?? null;
        setAgreementId(id);
      })
      .catch(() => setAgreementId(null))
      .finally(() => setReady(true));
  }, [router]);

  const network = detectNetwork(pan.replace(/\D/g, ''));

  function formatPan(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 19);
    setPan(digits.replace(/(.{4})/g, '$1 ').trim());
  }
  function formatExpiry(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    setExpiry(digits.length >= 3 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
  }

  async function handleSubmit() {
    if (!agreementId) { setError('No payment agreement is linked to your account yet.'); return; }
    setError(null);
    let tokenized;
    try {
      tokenized = await tokenizeCard({ pan, expiry, cvv });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid card details.');
      return;
    }
    setSubmitting(true);
    try {
      await api.customer.addCard(agreementId, {
        cardToken: tokenized.token,
        paymentCardExpirationDate: tokenized.expiry,
        paymentCardMaskedPanDisplay: tokenized.maskedPan,
        paymentCardNetwork: tokenized.network,
        paymentCardIsPreferred: preferred,
        ...(alias.trim() ? { paymentCardAlias: alias.trim() } : {}),
      }, token);
      notify('Card registered.', 'success');
      router.push('/system/cards');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register card.');
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Payment Methods', href: '/system/cards' }, { label: 'Add a card' }]} />

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#001E2B] flex items-center justify-center shrink-0">
          <CreditCard size={20} className="text-[#00ED64]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#001E2B] leading-tight">Add a card</h1>
          <p className="text-gray-500 text-sm mt-0.5">Register a new card to pay faster next time.</p>
        </div>
      </div>

      {!ready ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : !agreementId ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No payment agreement is linked to your account yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          {/* Card number; the network is detected automatically from the number */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              Card number
              <Tooltip text="Your 13–19 digit card number (the PAN). The card network is detected automatically as you type. It is validated and tokenized in your browser; only the last 4 digits are stored. The full number never reaches our servers." />
            </label>
            <div className="relative">
              <input value={pan} onChange={(e) => formatPan(e.target.value)} inputMode="numeric"
                placeholder="1234 5678 9012 3456"
                className="w-full border rounded-lg px-3 py-2.5 pr-24 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20" />
              {network && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold px-2 py-1 rounded bg-[#001E2B] text-[#00ED64] select-none">
                  {network}
                </span>
              )}
            </div>
          </div>

          {/* Network; auto-filled from the card number, read-only */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              Network
              <Tooltip text="The card scheme (Visa, Mastercard, Amex, Elo). Detected automatically from the card number; you cannot edit it." />
            </label>
            <input value={network ?? ''} readOnly
              placeholder="Detected from the card number"
              className="w-full border rounded-lg px-3 py-2.5 text-sm bg-gray-50 text-gray-700 cursor-not-allowed focus:outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Expiry */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                Expiry
                <Tooltip text="The card's expiry date in MM/YY format, as printed on the front of the card. Must be a future date." />
              </label>
              <input value={expiry} onChange={(e) => formatExpiry(e.target.value)} inputMode="numeric"
                placeholder="MM/YY" maxLength={5}
                className="w-full border rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20" />
            </div>
            {/* CVV */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
                Security code
                <Tooltip text="The 3-digit code on the back of the card (4 digits on the front for Amex). Used only to validate the card right now; it is never stored or sent to our servers (PCI DSS prohibits storing it)." />
              </label>
              <input value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric"
                placeholder={network === 'AMEX' ? '4 digits' : '3 digits'}
                className="w-full border rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20" />
            </div>
          </div>

          {/* Nickname */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              Nickname
              <span className="text-gray-400 text-xs font-normal">(optional)</span>
              <Tooltip text="A label to help you recognize this card later, e.g. 'Personal' or 'Travel'. Display only; never enter the card number or security code here." />
            </label>
            <input value={alias} onChange={(e) => setAlias(e.target.value.slice(0, 40))} maxLength={40}
              placeholder="e.g. Personal, Travel, Work"
              className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20" />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={preferred} onChange={(e) => setPreferred(e.target.checked)}
              className="rounded border-gray-300 text-[#001E2B] focus:ring-[#001E2B]/20" />
            Set as my default card
            <Tooltip text="The default card is preselected for new payments and used for recurring charges." />
          </label>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
            <Lock size={13} className="shrink-0" />
            <span>
              Validated and tokenized in your browser. The full card number and security code are never stored
              {debugMode ? ' (PCI DSS Req 3.2 / 3.4; expiry is QE:none, token is a surrogate).' : '.'}
            </span>
          </div>

          <div className="flex gap-3 pt-1">
            <Link href="/system/cards"
              className="flex-1 sm:flex-none sm:w-32 border rounded-lg py-2.5 text-sm text-center text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </Link>
            <button onClick={handleSubmit} disabled={submitting}
              className="flex-1 bg-[#001E2B] text-[#00ED64] py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity">
              {submitting ? 'Registering…' : 'Add card'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

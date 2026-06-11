'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { MerchantBrandingWrapper } from './MerchantBrandingWrapper';
import { SimulatorStateManager } from './SimulatorStateManager';
import type { SimulatorScenario } from '../../types/simulator';

interface Props {
  scenario: SimulatorScenario;
  merchantId: string;
}

type FlowState = 'idle' | 'creating' | 'link_ready' | 'iframe_open' | 'complete' | 'error';

export function PaymentLinkFlow({ scenario, merchantId }: Props) {
  const router = useRouter();
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txnId, setTxnId] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState('Copy link');

  const { prefill } = scenario;

  // Restore from sessionStorage on reload
  useEffect(() => {
    const code = sessionStorage.getItem('sim_payment_link');
    if (code) {
      setLinkCode(code);
      setPayUrl(`${window.location.origin}/gateway/pay/${code}`);
      setFlowState('link_ready');
    }
  }, []);

  // Listen for postMessage from the payment link page inside the iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const { type, txnId: tid } = event.data ?? {};
      if (type !== 'sim_payment_link_complete') return;

      setFlowState('complete');
      setTxnId(tid ?? null);

      sessionStorage.setItem('sim_payment_step3', JSON.stringify({
        cardTransactionInstanceReference: tid,
        email: prefill.email,
        amount: prefill.amount,
        currency: prefill.currency,
        merchantName: prefill.merchantName,
        method: 'payment-link',
        linkCode,
      }));
      SimulatorStateManager.setStep(3);
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [prefill, linkCode]);

  async function createLink() {
    setFlowState('creating');
    setErrorMsg(null);
    try {
      const result = await api.simulator.createPaymentLink({
        merchantAgreementInstanceReference: merchantId,
        amount: prefill.amount,
        currency: prefill.currency,
        description: prefill.description,
        customerMessage: `Hi ${prefill.cardholderName}, please complete your payment using the link below.`,
        usageType: 'single_use',
      });
      const code = result.paymentLinkCode;
      setLinkCode(code);
      setPayUrl(`${window.location.origin}/gateway/pay/${code}`);
      SimulatorStateManager.setPaymentLink(code);
      setFlowState('link_ready');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to create payment link');
      setFlowState('error');
    }
  }

  function copyLink() {
    if (payUrl) {
      navigator.clipboard.writeText(payUrl).catch(() => {});
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy link'), 2000);
    }
  }

  function openInTab() {
    if (payUrl) window.open(payUrl, '_blank');
  }

  function openIframe() {
    setFlowState('iframe_open');
  }

  function handleContinueToInvestigation() {
    router.push('/simulator/investigation');
  }

  function handleCancel() {
    SimulatorStateManager.clearAll();
    router.push('/simulator');
  }

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (flowState === 'idle') {
    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div>
              <div className="font-semibold text-[#001E2B]">Payment Link</div>
              <div className="text-xs text-gray-500">Merchant generates a link, shares with customer, customer pays</div>
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 mb-4 space-y-1">
            <div><span className="font-medium">Customer:</span> {prefill.cardholderName}</div>
            <div><span className="font-medium">Amount:</span> {new Intl.NumberFormat('en-EU', { style: 'currency', currency: prefill.currency }).format(prefill.amount)}</div>
            <div><span className="font-medium">Merchant:</span> {prefill.merchantName}</div>
          </div>
          <button
            onClick={createLink}
            className="w-full bg-[#001E2B] text-[#00ED64] border border-[#00ED64] py-2.5 rounded-lg font-semibold text-sm hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
          >
            Generate Payment Link
          </button>
          <button onClick={handleCancel} className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors py-1">
            ← Cancel and change scenario
          </button>
        </div>
      </div>
    );
  }

  // ── Creating ──────────────────────────────────────────────────────────────
  if (flowState === 'creating') {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <p className="text-sm text-gray-500 animate-pulse">Creating payment link...</p>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (flowState === 'error') {
    return (
      <div className="max-w-xl mx-auto bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-red-700 text-sm font-medium">Failed to create payment link</p>
        <p className="text-red-500 text-xs mt-1">{errorMsg}</p>
        <button onClick={() => setFlowState('idle')} className="mt-4 text-sm text-red-600 underline">
          Try again
        </button>
      </div>
    );
  }

  // ── Link ready ────────────────────────────────────────────────────────────
  if (flowState === 'link_ready' && linkCode && payUrl) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-green-600">✅</span>
            <span className="font-semibold text-[#001E2B] text-sm">Payment link generated</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            The merchant shares this link with the customer via email, SMS, or WhatsApp.
            The customer clicks it and completes payment on the hosted page.
          </p>

          <div className="bg-gray-50 border rounded-lg p-3 flex items-center gap-2 mb-4">
            <code className="text-xs text-gray-700 flex-1 truncate">{payUrl}</code>
            <button
              onClick={copyLink}
              className="text-xs text-[#001E2B] border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 shrink-0"
            >
              {copyLabel}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={openIframe}
              className="w-full bg-[#001E2B] text-[#00ED64] border border-[#00ED64] py-2.5 rounded-lg font-semibold text-sm hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
            >
              Load payment form ↓
            </button>
            <button
              onClick={openInTab}
              className="w-full border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Open in new tab (manual)
            </button>
            <button onClick={handleCancel} className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors py-1">
              ← Cancel and change scenario
            </button>
          </div>

          <p className="text-[11px] text-gray-400 mt-3 text-center">
            Link code: <span className="font-mono">{linkCode}</span>
          </p>
        </div>
      </div>
    );
  }

  // ── Iframe open: customer completes payment inside hosted page ────────────
  if (flowState === 'iframe_open' && linkCode) {
    const prefillParams = new URLSearchParams();
    if (prefill.cardholderName) prefillParams.set('name', prefill.cardholderName);
    if (prefill.cardExpiry)     prefillParams.set('expiry', prefill.cardExpiry);
    if (prefill.cardHint)       prefillParams.set('card', prefill.cardHint);
    if (prefill.email)          prefillParams.set('email', prefill.email);
    const iframeSrc = `/gateway/pay/${linkCode}?${prefillParams.toString()}`;

    return (
      <MerchantBrandingWrapper
        merchantName={prefill.merchantName}
        amount={prefill.amount}
        currency={prefill.currency}
        description={prefill.description}
      >
        <iframe
          src={iframeSrc}
          className="w-full rounded-lg border shadow-inner bg-white"
          style={{ height: 'min(640px, 80vh)' }}
          title="Payment Link, hosted payment page"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-[11px] text-gray-400">
            The customer is completing payment on the hosted payment link page.
            PAN is never transmitted to the merchant.
          </p>
          <button onClick={handleCancel} className="text-xs text-gray-400 hover:text-gray-600 transition-colors shrink-0 ml-3">
            ← Cancel
          </button>
        </div>
      </MerchantBrandingWrapper>
    );
  }

  // ── Complete ──────────────────────────────────────────────────────────────
  if (flowState === 'complete') {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-[#001E2B] mb-2">Payment Completed</h2>
        {txnId && (
          <div className="inline-block bg-gray-50 border rounded-lg px-4 py-2 text-xs font-mono text-gray-600 mb-6">
            Transaction: {txnId}
          </div>
        )}
        <button
          onClick={handleContinueToInvestigation}
          className="bg-[#001E2B] text-[#00ED64] border border-[#00ED64] px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
        >
          Continue to Investigation →
        </button>
      </div>
    );
  }

  return null;
}

'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { MerchantBrandingWrapper } from './MerchantBrandingWrapper';
import { SimulatorStateManager } from './SimulatorStateManager';
import type { SimulatorScenario } from '../../types/simulator';
import simulatorConfig from '../../config/simulator.json';
import { variedAmountNum, variedDescription } from '../../lib/simVary';

interface Props {
  scenario: SimulatorScenario;
}

type FlowState = 'idle' | 'creating' | 'ready' | 'waiting' | 'complete' | 'error';

export function RedirectionPaymentFlow({ scenario }: Props) {
  const router = useRouter();
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txnId, setTxnId] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const { prefill } = scenario;

  // Editable payment options (persona + merchant stay fixed). Initialized from the scenario.
  const [amount, setAmount] = useState<number>(prefill.amount);
  const [description, setDescription] = useState<string>(prefill.description ?? '');
  const [varyNote, setVaryNote] = useState<string | null>(null);

  function handleVary() {
    const a = variedAmountNum(amount);
    const d = variedDescription(prefill.merchantName, description);
    setAmount(a);
    setDescription(d);
    setVaryNote(`Distinct values generated. Find it by amount ${new Intl.NumberFormat('en-EU', { style: 'currency', currency: prefill.currency }).format(a)} or descriptor “${d}”.`);
  }

  // Listen for postMessage from iframe callback page
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const { type, status, sessionId: sid, txnId: tid, caseId: cid } = event.data ?? {};
      if (type !== 'sim_payment_complete') return;

      setFlowState('complete');
      setTxnId(tid ?? null);
      setCaseId(cid || null);

      if (status === 'success' || status === 'paid') {
        // Persist for investigation step
        sessionStorage.setItem('sim_payment_step3', JSON.stringify({
          cardTransactionInstanceReference: tid,
          caseId: cid || null,
          email: prefill.email,
          amount,
          currency: prefill.currency,
          merchantName: prefill.merchantName,
          method: 'redirection',
          customerName: scenario.persona,
          sessionId: sid,
        }));
        SimulatorStateManager.setStep(3);
        // Persisted server-side; app-mode history reads it from the real API.
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [prefill, amount]);

  async function initSession() {
    setFlowState('creating');
    setErrorMsg(null);
    try {
      const origin = window.location.origin;
      const result = await api.simulator.createCheckoutSession({
        merchantId: simulatorConfig.merchantId,
        amount,
        currency: prefill.currency,
        description: description.trim() || prefill.description,
        returnUrl: `${origin}/simulator/payment/callback?status=success&session={session_id}&txn={txn_id}&case={case_id}`,
        cancelUrl: `${origin}/simulator/payment/callback?status=cancelled&session={session_id}`,
        merchantReference: `SIM-${scenario.id.toUpperCase()}-${Date.now()}`,
      });
      const sid = result.checkoutSessionInstanceReference;
      setSessionId(sid);
      SimulatorStateManager.setCheckoutSession(sid);
      setFlowState('ready');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create session';
      setErrorMsg(msg);
      setFlowState('error');
    }
  }

  function launchIframe() {
    setFlowState('waiting');
  }

  function handleContinueToInvestigation() {
    router.push('/simulator/investigation');
  }

  function handleCancel() {
    SimulatorStateManager.clearAll();
    router.push('/simulator');
  }

  // ── Idle / Creating ──────────────────────────────────────────────────────
  if (flowState === 'idle' || flowState === 'creating') {
    return (
      <MerchantBrandingWrapper
        merchantName={prefill.merchantName}
        amount={amount}
        currency={prefill.currency}
        description={description.trim() || prefill.description}
      >
        <div className="py-6">
          {flowState === 'idle' && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 mb-4 space-y-3 text-left">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-blue-800">
                  The customer and merchant are fixed by this scenario. Adjust the payment options
                  below, or use <strong>Vary values</strong> to generate a distinct variation.
                </p>
                <button
                  type="button"
                  onClick={handleVary}
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors"
                >
                  🎲 Vary values
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Amount ({prefill.currency})</label>
                  <input
                    type="number" step="0.01" min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Description</label>
                  <input
                    type="text" maxLength={22}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={prefill.merchantName.toUpperCase().slice(0, 22)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  />
                </div>
              </div>
              {varyNote && <p className="text-xs text-blue-700 font-medium">{varyNote}</p>}
            </div>
          )}
          <p className="text-sm text-gray-600 mb-4 text-center">
            Click below to simulate the merchant creating a checkout session and
            embedding the payment page in an iframe.
          </p>
          <div className="text-center">
            <button
              onClick={initSession}
              disabled={flowState === 'creating'}
              className="bg-[#001E2B] text-[#00ED64] border border-[#00ED64] px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors disabled:opacity-50"
            >
              {flowState === 'creating' ? 'Creating session…' : 'Proceed to checkout'}
            </button>
          </div>
          <button onClick={handleCancel} className="mt-2 w-full text-xs text-gray-400 hover:text-gray-600 transition-colors py-1">
            ← Cancel and change scenario
          </button>
        </div>
      </MerchantBrandingWrapper>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (flowState === 'error') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <div className="text-2xl mb-2">⚠️</div>
        <p className="text-red-700 text-sm font-medium">Failed to create checkout session</p>
        <p className="text-red-500 text-xs mt-1">{errorMsg}</p>
        <button onClick={() => setFlowState('idle')} className="mt-4 text-sm text-red-600 underline">
          Try again
        </button>
      </div>
    );
  }

  // ── Ready; show "launch" CTA before opening iframe ─────────────────────
  if (flowState === 'ready' && sessionId) {
    return (
      <MerchantBrandingWrapper
        merchantName={prefill.merchantName}
        amount={amount}
        currency={prefill.currency}
        description={description.trim() || prefill.description}
      >
        <div className="text-center py-6">
          <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-2 text-xs mb-4">
            ✅ Session created · ID: <code className="font-mono">{sessionId.slice(0, 12)}…</code>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            The PSP has returned a <strong>paymentPageUrl</strong>. The merchant site now
            loads this URL inside an iframe for the customer to complete payment.
          </p>
          <button
            onClick={launchIframe}
            className="bg-[#001E2B] text-[#00ED64] border border-[#00ED64] px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
          >
            Load payment form ↓
          </button>
          <button onClick={handleCancel} className="mt-2 w-full text-xs text-gray-400 hover:text-gray-600 transition-colors py-1">
            ← Cancel and change scenario
          </button>
        </div>
      </MerchantBrandingWrapper>
    );
  }

  // ── Waiting; iframe visible ──────────────────────────────────────────────
  if (flowState === 'waiting' && sessionId) {
    // Build prefill query params from scenario. The checkout page reads these via
    // useSearchParams; adding a new param only requires updating the registry there.
    const prefillParams = new URLSearchParams();
    if (prefill.cardholderName) prefillParams.set('name', prefill.cardholderName);
    if (prefill.cardExpiry)    prefillParams.set('expiry', prefill.cardExpiry);
    if (prefill.cardHint)      prefillParams.set('card', prefill.cardHint);
    if (prefill.email)         prefillParams.set('email', prefill.email);
    const iframeSrc = `/gateway/checkout/${sessionId}?${prefillParams.toString()}`;

    return (
      <MerchantBrandingWrapper
        merchantName={prefill.merchantName}
        amount={amount}
        currency={prefill.currency}
        description={description.trim() || prefill.description}
      >
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className="w-full rounded-lg border shadow-inner bg-white"
          style={{ height: 'min(640px, 80vh)' }}
          title="PSP Hosted Payment Page"
          sandbox="allow-scripts allow-same-origin allow-forms allow-top-navigation-by-user-activation"
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-[11px] text-gray-400">
            The customer is completing card entry inside the hosted payment page.
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
      <div className="max-w-2xl mx-auto text-center py-10">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-[#001E2B] mb-2">Payment Completed</h2>
        <p className="text-gray-600 text-sm mb-2">
          The hosted payment form processed the transaction and sent a <code>postMessage</code> back
          to this page. The merchant site received the callback.
        </p>
        {txnId && (
          <div className="inline-block bg-gray-50 border rounded-lg px-4 py-2 text-xs font-mono text-gray-600 mb-6">
            Transaction: {txnId}
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleContinueToInvestigation}
            className="bg-[#001E2B] text-[#00ED64] border border-[#00ED64] px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
          >
            Continue to Investigation →
          </button>
        </div>
      </div>
    );
  }

  return null;
}

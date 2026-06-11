'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { SimulatorStateManager } from './SimulatorStateManager';
import type { SimulatorScenario } from '../../types/simulator';

interface Props {
  scenario: SimulatorScenario;
  merchantId: string;
}

type FlowState = 'idle' | 'creating' | 'link_ready' | 'paying' | 'complete' | 'error';

export function PaymentLinkFlow({ scenario, merchantId }: Props) {
  const router = useRouter();
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txnId, setTxnId] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState('Copy link');

  const { prefill } = scenario;

  // If a link code is already in state (page reload), restore it
  useEffect(() => {
    const code = sessionStorage.getItem('sim_payment_link');
    if (code) {
      setLinkCode(code);
      setPayUrl(`${window.location.origin}/gateway/pay/${code}`);
      setFlowState('link_ready');
    }
  }, []);

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

  function simulateCustomerPaid() {
    // In demo context we pretend the customer opened the link in their browser
    // and navigate the current window to the pay page so the demo can show it
    if (payUrl) {
      setFlowState('paying');
      router.push(payUrl);
    }
  }

  function handleContinueToInvestigation() {
    router.push('/simulator/investigation');
  }

  if (flowState === 'idle') {
    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">🔗</span>
            <div>
              <div className="font-semibold text-[#001E2B]">Payment Link</div>
              <div className="text-xs text-gray-500">Merchant generates a link → shares with customer → customer pays</div>
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
        </div>
      </div>
    );
  }

  if (flowState === 'creating') {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <div className="text-3xl mb-3 animate-pulse">🔗</div>
        <p className="text-sm text-gray-500">Creating payment link…</p>
      </div>
    );
  }

  if (flowState === 'error') {
    return (
      <div className="max-w-xl mx-auto bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <div className="text-2xl mb-2">⚠️</div>
        <p className="text-red-700 text-sm font-medium">Failed to create payment link</p>
        <p className="text-red-500 text-xs mt-1">{errorMsg}</p>
        <button onClick={() => setFlowState('idle')} className="mt-4 text-sm text-red-600 underline">
          Try again
        </button>
      </div>
    );
  }

  if (flowState === 'link_ready' && linkCode && payUrl) {
    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-green-600">✅</span>
            <span className="font-semibold text-[#001E2B] text-sm">Payment link generated</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            The merchant shares this link with the customer (email, SMS, WhatsApp…).
            The customer clicks it and completes payment on the hosted page.
          </p>

          {/* Link display */}
          <div className="bg-gray-50 border rounded-lg p-3 flex items-center gap-2 mb-4">
            <code className="text-xs text-gray-700 flex-1 truncate">{payUrl}</code>
            <button
              onClick={copyLink}
              className="text-xs text-[#001E2B] border border-gray-300 rounded px-2 py-1 hover:bg-gray-100 shrink-0"
            >
              {copyLabel}
            </button>
          </div>

          {/* Simulator actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={simulateCustomerPaid}
              className="w-full bg-[#001E2B] text-[#00ED64] border border-[#00ED64] py-2.5 rounded-lg font-semibold text-sm hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
            >
              Simulate: customer opens link and pays →
            </button>
            <button
              onClick={openInTab}
              className="w-full border border-gray-300 text-gray-600 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Open in new tab (manual)
            </button>
          </div>

          <p className="text-[11px] text-gray-400 mt-3 text-center">
            Link code: <span className="font-mono">{linkCode}</span>
          </p>
        </div>
      </div>
    );
  }

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

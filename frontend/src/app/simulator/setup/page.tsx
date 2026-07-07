'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PaymentMethodSelector } from '../../../components/simulator/PaymentMethodSelector';
import { ScenarioSelector } from '../../../components/simulator/ScenarioSelector';
import { MerchantSelector, type SimMerchant } from '../../../components/simulator/MerchantSelector';
import { SimulatorStateManager } from '../../../components/simulator/SimulatorStateManager';
import type { PaymentMethodId, SimulatorScenario, PaymentMethod } from '../../../types/simulator';
import config from '../../../config/simulator.json';

const METHODS = config.methods as PaymentMethod[];
const SCENARIOS = config.scenarios as SimulatorScenario[];

export default function SimulatorPaymentSetupPage() {
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethodId | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState<SimMerchant | null>(null);

  function handleStart() {
    if (!method || !scenarioId || !merchant) return;
    SimulatorStateManager.clearAll();
    SimulatorStateManager.setMethod(method);
    SimulatorStateManager.setScenario(scenarioId);
    SimulatorStateManager.setMerchant(merchant.id, merchant.name, merchant.mcc);
    SimulatorStateManager.setStep(1);
    router.push('/simulator/payment');
  }

  const ready = !!method && !!scenarioId && !!merchant;

  return (
    <div className="max-w-2xl mx-auto mt-8 pb-12">
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🎬</div>
        <h1 className="text-2xl font-bold text-[#001E2B] mb-2">Simulate Payment</h1>
        <p className="text-gray-600 text-sm">
          Choose a payment method and a customer scenario, then walk through the full PCI DSS
          payment and fraud investigation story.
        </p>
      </div>

      {/* Step 1, Payment method */}
      <section className="bg-white rounded-xl border p-5 mb-4 shadow-sm">
        <h2 className="font-semibold text-[#001E2B] mb-1 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#001E2B] text-[#00ED64] text-xs flex items-center justify-center font-bold">1</span>
          Select Payment Method
        </h2>
        <p className="text-xs text-gray-500 mb-3">How should the payment be initiated?</p>
        <PaymentMethodSelector methods={METHODS} selected={method} onSelect={setMethod} />
      </section>

      {/* Step 2, Scenario (customer / payer) */}
      <section className={`bg-white rounded-xl border p-5 mb-4 shadow-sm transition-opacity ${method ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <h2 className="font-semibold text-[#001E2B] mb-1 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#001E2B] text-[#00ED64] text-xs flex items-center justify-center font-bold">2</span>
          Select Customer Scenario
        </h2>
        <p className="text-xs text-gray-500 mb-3">Which customer (payer) story should the demo follow?</p>
        <ScenarioSelector scenarios={SCENARIOS} selected={scenarioId} onSelect={setScenarioId} />
      </section>

      {/* Step 3, Merchant (payee); real merchants from the shared demo roster */}
      <section className={`bg-white rounded-xl border p-5 mb-6 shadow-sm transition-opacity ${scenarioId ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <h2 className="font-semibold text-[#001E2B] mb-1 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[#001E2B] text-[#00ED64] text-xs flex items-center justify-center font-bold">3</span>
          Select Merchant
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Which merchant (payee) receives the payment? The payment is attributed to this merchant and its
          webhook callback is notified; review it later in the system under this merchant.
        </p>
        <MerchantSelector selected={merchant?.id ?? null} onSelect={setMerchant} />
      </section>

      {/* CTA */}
      <div className="text-center">
        <button
          suppressHydrationWarning
          disabled={!ready}
          onClick={handleStart}
          className={`inline-block px-8 py-3 rounded-lg font-semibold text-sm transition-all ${
            ready
              ? 'bg-[#001E2B] text-[#00ED64] border border-[#00ED64] hover:bg-[#00ED64] hover:text-[#001E2B] shadow-md'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed border border-transparent'
          }`}
        >
          Start Demo →
        </button>
        {!ready && (
          <p className="text-xs text-gray-400 mt-2">Select a method, a customer scenario and a merchant to continue</p>
        )}
      </div>
    </div>
  );
}

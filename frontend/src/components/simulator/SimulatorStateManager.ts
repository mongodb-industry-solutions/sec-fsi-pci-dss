import type { PaymentMethodId, SimulatorState } from '../../types/simulator';

const KEYS = {
  METHOD: 'sim_method',
  SCENARIO: 'sim_scenario',
  STEP: 'sim_step',
  CHECKOUT_SESSION: 'sim_checkout_session',
  PAYMENT_LINK: 'sim_payment_link',
  PAYMENT_STEP3: 'sim_payment_step3',
} as const;

function safeGet(key: string): string | null {
  try { return sessionStorage.getItem(key); }
  catch { return null; }
}

function safeSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); }
  catch { /* ignore */ }
}

function safeRemove(key: string): void {
  try { sessionStorage.removeItem(key); }
  catch { /* ignore */ }
}

export const SimulatorStateManager = {
  getState(): SimulatorState {
    return {
      method: (safeGet(KEYS.METHOD) as PaymentMethodId) ?? null,
      scenarioId: safeGet(KEYS.SCENARIO),
      step: parseInt(safeGet(KEYS.STEP) ?? '0', 10),
      checkoutSessionId: safeGet(KEYS.CHECKOUT_SESSION),
      paymentLinkCode: safeGet(KEYS.PAYMENT_LINK),
    };
  },

  setMethod(method: PaymentMethodId): void {
    safeSet(KEYS.METHOD, method);
  },

  setScenario(scenarioId: string): void {
    safeSet(KEYS.SCENARIO, scenarioId);
  },

  setStep(step: number): void {
    safeSet(KEYS.STEP, String(step));
  },

  setCheckoutSession(sessionId: string): void {
    safeSet(KEYS.CHECKOUT_SESSION, sessionId);
  },

  setPaymentLink(code: string): void {
    safeSet(KEYS.PAYMENT_LINK, code);
  },

  clearAll(): void {
    Object.values(KEYS).forEach(safeRemove);
  },

  clearFlow(): void {
    safeRemove(KEYS.STEP);
    safeRemove(KEYS.CHECKOUT_SESSION);
    safeRemove(KEYS.PAYMENT_LINK);
    safeRemove(KEYS.PAYMENT_STEP3);
  },
};

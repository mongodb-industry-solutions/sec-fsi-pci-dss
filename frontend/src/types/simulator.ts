export type PaymentMethodId = 'api-card' | 'redirection' | 'payment-link' | 'insite';

export interface PaymentMethod {
  id: PaymentMethodId;
  label: string;
  icon: string;
  description: string;
  enabled: boolean;
  comingSoon?: boolean;
}

export interface SimulatorScenario {
  id: string;
  label: string;
  description: string;
  persona: string;
  expectedOutcome: 'fraud' | 'legit' | 'borderline';
  outcomeLabel: string;
  prefill: {
    cardholderName: string;
    email: string;
    phone: string;
    amount: number;
    currency: string;
    merchantName: string;
    merchantCategoryCode: string;
    description: string;
  };
}

export interface SimulatorConfig {
  methods: PaymentMethod[];
  scenarios: SimulatorScenario[];
  merchantId: string;
  merchantName: string;
}

export interface SimulatorState {
  method: PaymentMethodId | null;
  scenarioId: string | null;
  step: number;
  checkoutSessionId: string | null;
  paymentLinkCode: string | null;
}

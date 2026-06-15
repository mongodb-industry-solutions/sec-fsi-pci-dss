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
    /** Card expiry to pre-fill the hosted checkout page, format MM/YY */
    cardExpiry?: string;
    /** Test card number to pre-fill the hosted checkout page */
    cardHint?: string;
    /** Drives the CARD_AUTH stub result for this scenario */
    cardAuthOutcome?: 'approved' | 'declined' | 'challenge';
  };
}

export interface SimulatorConfig {
  merchantId: string;
  merchantName: string;
  defaultCurrency: string;
  fraudAmountThreshold: number;
  amountPresets: string[];
  defaultCard: string;
  testCards: { label: string; number: string }[];
  fallbackMerchants: { name: string; mcc: string }[];
  methods: PaymentMethod[];
  scenarios: SimulatorScenario[];
}

export interface SimulatorState {
  method: PaymentMethodId | null;
  scenarioId: string | null;
  // The merchant (payee) chosen for this run; a real merchant owned by a featured customer.
  merchantId: string | null;
  merchantName: string | null;
  merchantMcc: string | null;
  step: number;
  checkoutSessionId: string | null;
  paymentLinkCode: string | null;
}

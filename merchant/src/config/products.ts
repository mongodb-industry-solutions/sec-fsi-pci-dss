// Static demo catalogue — 4 products, one per PSP payment method. No DB (KISS).
export type PaymentMethod = 'payment_link' | 'redirect' | 'api_payment' | 'subscription';

export interface Product {
  id: string;
  name: string;
  description: string;
  /** Minor-unit-free amount (e.g. 24.5 = £24.50). */
  price: number;
  currency: string;
  method: PaymentMethod;
  methodLabel: string;
  /** lucide-react icon key (see ProductCard ICONS map). */
  icon: 'beans' | 'machine' | 'course' | 'subscription';
}

export const PRODUCTS: Product[] = [
  {
    id: 'espresso-beans-1kg',
    name: 'Espresso Beans 1kg',
    description: 'Single-origin dark roast, whole bean.',
    price: 24.5,
    currency: 'GBP',
    method: 'payment_link',
    methodLabel: 'Payment Link',
    icon: 'beans',
  },
  {
    id: 'espresso-machine',
    name: 'Espresso Machine',
    description: 'Dual-boiler prosumer espresso machine.',
    price: 899.0,
    currency: 'GBP',
    method: 'redirect',
    methodLabel: 'Redirect (Hosted Checkout)',
    icon: 'machine',
  },
  {
    id: 'barista-course',
    name: 'Barista Course',
    description: 'One-day hands-on barista training.',
    price: 149.0,
    currency: 'GBP',
    method: 'api_payment',
    methodLabel: 'API Payment (tokenised)',
    icon: 'course',
  },
  {
    id: 'coffee-subscription',
    name: 'Coffee Subscription',
    description: 'Monthly delivery of freshly roasted beans.',
    price: 39.0,
    currency: 'GBP',
    method: 'subscription',
    methodLabel: 'Redirect (Subscription)',
    icon: 'subscription',
  },
];

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

/** Merchant commission rate (Espresso Works seeded default = 0.025). Display-only in the merchant app. */
const DEFAULT_COMMISSION_RATE = 0.025;
function parseCommissionRate(raw: string | undefined): number {
  const n = Number(raw);
  // Fall back to the seeded default when unset / malformed / out of the valid 0..1 range,
  // so the UI never renders NaN or a nonsensical commission figure.
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_COMMISSION_RATE;
}
export const MERCHANT_COMMISSION_RATE = parseCommissionRate(process.env.PSP_MERCHANT_COMMISSION_RATE);

export function computeCommission(amount: number, rate = MERCHANT_COMMISSION_RATE): number {
  return Math.round(amount * rate * 100) / 100;
}

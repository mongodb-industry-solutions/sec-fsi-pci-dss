// Shared payment-option variation for the simulator. A scenario predefines a use case
// (persona + merchant, which stay fixed). These helpers vary only the payment options
// (amount, description) so repeated runs are diverse and easy to tell apart, while keeping
// the amount on the same side of the fraud threshold to preserve the scenario's intent.
import simulatorConfig from '../config/simulator.json';

export function shortTag(): string {
  return Math.random().toString(36).slice(2, 6);
}

export function variedAmountNum(base: number): number {
  const threshold = simulatorConfig.fraudAmountThreshold;
  const b = base > 0 ? base : 100;
  let v = b * (0.9 + Math.random() * 0.2); // ±10%
  if (b >= threshold) v = Math.max(threshold + 1, v);             // keep fraud-triggering
  else                v = Math.min(threshold - 0.01, Math.max(1, v)); // keep below threshold
  return Math.round(v * 100) / 100;
}

export function variedAmount(base: string): string {
  return variedAmountNum(parseFloat(base) || 100).toFixed(2);
}

// Descriptor without a trailing " #tag", derived from the current description or the merchant.
export function baseDescriptor(merchantName: string, current: string): string {
  const src = (current && current.trim()) ? current : merchantName.toUpperCase();
  return src.replace(/\s+#[a-z0-9]{4}$/i, '').trim();
}

export function variedDescription(merchantName: string, current: string): string {
  const base = baseDescriptor(merchantName, current).slice(0, 16);
  return `${base} #${shortTag()}`.slice(0, 22);
}

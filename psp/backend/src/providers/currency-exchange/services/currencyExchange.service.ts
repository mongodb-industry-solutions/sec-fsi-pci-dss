// Builtin Currency Exchange module (v17). Converts an amount between ISO-4217 currencies using a
// configurable rate table (rates are units-of-currency per 1 unit of baseCurrency). A configurable
// spread (bps) is applied on every conversion to mimic a real FX provider. Replaceable by a real FX
// rate provider via the capability config / dispatch without changing callers.
//
// BIAN: adjunct to Payment Initiation / Card Authorization, the money-movement gates
// convert the transaction amount into the funding/destination account currency before holding or
// crediting, so no balance is ever mutated in a mismatched currency.

import { Db } from 'mongodb';
import { getCapabilityModuleConfig } from '../../../modules/provider/services/capabilityModuleConfig.service';

export interface CurrencyExchangeConfig {
  baseCurrency: string;                 // rates are expressed relative to this (default EUR)
  rates: Record<string, number>;        // e.g. { EUR: 1, USD: 1.08, GBP: 0.85 }
  spreadBps: number;                    // basis points added to the mid rate (default 50 = 0.50%)
}

export const DEFAULT_CURRENCY_EXCHANGE_CONFIG: CurrencyExchangeConfig = {
  baseCurrency: 'EUR',
  rates: {
    EUR: 1,
    USD: 1.08,
    GBP: 0.85,
    CHF: 0.95,
    SGD: 1.45,
    NGN: 1650,
    PLN: 4.30,
  },
  spreadBps: 50,
};

export function resolveCurrencyExchangeConfig(
  stored: Record<string, unknown> | undefined | null,
): CurrencyExchangeConfig {
  const c = (stored ?? {}) as Partial<CurrencyExchangeConfig>;
  return {
    baseCurrency: typeof c.baseCurrency === 'string' ? c.baseCurrency : DEFAULT_CURRENCY_EXCHANGE_CONFIG.baseCurrency,
    rates: (c.rates && typeof c.rates === 'object')
      ? { ...DEFAULT_CURRENCY_EXCHANGE_CONFIG.rates, ...(c.rates as Record<string, number>) }
      : DEFAULT_CURRENCY_EXCHANGE_CONFIG.rates,
    spreadBps: typeof c.spreadBps === 'number' ? c.spreadBps : DEFAULT_CURRENCY_EXCHANGE_CONFIG.spreadBps,
  };
}

export interface ConvertResult {
  amount: number;        // converted amount in `to` currency, rounded to 2 dp (minor-unit precision)
  rate: number;          // effective from->to rate (incl. spread), rounded to 6 dp
  converted: boolean;    // false when from === to (no-op)
}

// Convert `amount` from one ISO-4217 currency to another. Same-currency is a no-op (rate 1). Throws
// only when a currency is missing from the rate table (a config error the caller should surface).
export function convert(
  amount: number,
  from: string,
  to: string,
  config: CurrencyExchangeConfig = DEFAULT_CURRENCY_EXCHANGE_CONFIG,
): ConvertResult {
  if (from === to) return { amount: round2(amount), rate: 1, converted: false };

  const rFrom = config.rates[from];
  const rTo = config.rates[to];
  if (rFrom === undefined || rTo === undefined) {
    throw new Error(`currency_exchange: missing rate for ${rFrom === undefined ? from : to}`);
  }

  // Mid cross-rate: units of `to` per unit of `from`. Spread widens the rate against the customer.
  const mid = rTo / rFrom;
  const effectiveRate = mid * (1 + config.spreadBps / 10_000);
  return { amount: round2(amount * effectiveRate), rate: round6(effectiveRate), converted: true };
}

// DB-aware convenience: resolves the stored capability config (falls back to defaults) then converts.
export async function resolveAndConvert(
  db: Db,
  amount: number,
  from: string,
  to: string,
): Promise<ConvertResult> {
  const stored = await getCapabilityModuleConfig(db, 'currency-exchange');
  const cfg = resolveCurrencyExchangeConfig(stored?.moduleConfig as Record<string, unknown> | undefined);
  return convert(amount, from, to, cfg);
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round6(n: number): number { return Math.round(n * 1_000_000) / 1_000_000; }

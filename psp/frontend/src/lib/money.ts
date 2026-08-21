// Intl throws on a missing or non ISO 4217 currency, so degrade to a plain amount instead.
export function formatAmount(
  amount: number | null | undefined,
  currency?: string | null,
  opts: Intl.NumberFormatOptions & { locale?: string } = {},
): string {
  const { locale = 'en-US', ...numberOpts } = opts;
  const code = (currency ?? '').trim().toUpperCase();
  const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  if (!/^[A-Z]{3}$/.test(code)) return value.toFixed(2);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, ...numberOpts }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

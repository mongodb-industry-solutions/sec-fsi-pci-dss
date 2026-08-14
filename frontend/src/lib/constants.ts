// Full external backend URL for display: webhook hook URLs, API docs, vendor callbacks.
export const BACKEND_PUBLIC_URL =
  process.env.NEXT_PUBLIC_PSP_URL_BACKEND_PUBLIC || 'http://localhost:8081';

// Private/internal backend base URL (e.g. in-VPC service address). Used only for display,
// so integrators calling from inside the private network can copy in-VPC OIDC endpoints.
// Empty when not configured (single-URL deployments); consumers should fall back to public.
export const BACKEND_PRIVATE_URL =
  process.env.NEXT_PUBLIC_PSP_URL_BACKEND_PRIVATE || '';

// Base URL the browser uses for fetch / SSE calls.
// When PRIVATE is defined → proxy mode: browser uses same-origin (''), Next.js
// rewrites forward to the PRIVATE URL server-side (see next.config.js).
// When PRIVATE is not defined → direct mode: browser calls PUBLIC URL directly.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_PSP_URL_BACKEND_PRIVATE !== undefined
    ? ''
    : BACKEND_PUBLIC_URL;

// External merchant demo app URL (Espresso Works). Same detection pattern as the backend:
// baked into the bundle at build time from NEXT_PUBLIC_PSP_URL_MERCHANT, with a localhost
// default for docker compose. Used by the simulator hub's "Simulate Merchant" card.
export const MERCHANT_PUBLIC_URL =
  process.env.NEXT_PUBLIC_PSP_URL_MERCHANT || 'http://localhost:8082';

// Shareable URL of this demo: runtime browser origin (correct in any environment),
// with NEXT_PUBLIC_PSP_URL_FRONTEND as optional override when the origin is not shareable.
export function demoPublicUrl(path = ''): string {
  const base = (
    process.env.NEXT_PUBLIC_PSP_URL_FRONTEND ||
    (typeof window !== 'undefined' ? window.location.origin : '')
  ).replace(/\/+$/, '');
  return `${base}${path}`;
}

// All seeded demo accounts share the same bcrypt-hashed credential.
// The plaintext is a fixed demo convention (documented in auth.controller.ts);
// the seed stores only the hash. Used to auto-fill the login form (debug mode)
// and by the simulator to obtain a real JWT per role via POST /api/v1/auth/login.
export const DEMO_PASSWORD = 'demo-password';

export const ROLE_LABELS: Record<string, string> = {
  customer: 'Customer',
  level1_analyst: 'L1 Analyst',
  level2_investigator: 'L2 Investigator',
  security_auditor: 'Security Auditor',
  merchant_officer: 'Merchant Officer',
  operations_officer: 'Operations Officer',
  manager:          'Manager',
};

export const PERFORMER_LABELS: Record<string, string> = {
  payment_service: 'System - Automated detection',
  level1_analyst: 'L1 Analyst',
  level2_investigator: 'L2 Investigator',
  security_auditor: 'Security Auditor',
  ai_agent: 'AI Agent',
  'rbac-layer': 'System - Access control',
  system: 'System',
};

export const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-red-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-green-600 text-white',
};

export const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  under_review: 'bg-yellow-100 text-yellow-800',
  escalated: 'bg-orange-100 text-orange-800',
  resolved_cleared: 'bg-green-100 text-green-800',
  resolved_fraud: 'bg-red-100 text-red-800',
  closed: 'bg-gray-100 text-gray-800',
};

const MCC_LABELS: Record<string, string> = {
  '5411': 'Grocery Stores',
  '5732': 'Electronics Stores',
  '5812': 'Restaurants / Food Service',
  '5834': 'Pharmacy',
  '6011': 'Cash Advance / ATM',
  '7011': 'Hotels / Lodging',
  '7995': 'Gambling / Betting',
};

// Plain-language label per indicator. Keys cover the fraud-engine rule ids and the gate indicators
// (`fds.*`, `hrp.*`, `aml.*`, `vop.*`) that reach a case, so no raw identifier is shown to a user.
const RISK_INDICATOR_LABELS: Record<string, string> = {
  amount_threshold: 'High-value transaction (amount exceeds fraud threshold)',
  high_value_txn: 'High-value transaction (amount exceeds fraud threshold)',
  elevated_value_txn: 'Elevated transaction amount',
  very_high_value_txn: 'Very high transaction amount',
  risky_mcc: 'High-risk merchant category',
  velocity_24h: 'Unusual number of transactions in 24 hours',
  sanctions_match: 'Sanctions screening match',
  fds_flagged: 'Flagged by fraud detection',
  transfer_risk_block: 'Transfer flagged by risk screening',
};

const SEVERITY_WORDS: Record<string, string> = {
  critical: 'critical', high: 'high', medium: 'medium', low: 'low',
};

export function formatRiskIndicator(indicator: string): string {
  const mccMatch = indicator.match(/^high_risk_mcc_(\d+)$/);
  if (mccMatch) {
    const mcc = mccMatch[1];
    const label = MCC_LABELS[mcc];
    return `High-risk merchant category: MCC ${mcc}${label ? ` (${label})` : ''}`;
  }

  // Gate indicators arrive as `family.detail` with an optional ": qualifier" suffix,
  // e.g. "fds.high.risk: velocity", "aml.alert: high", "hrp.sanctions.match".
  const [rawKey, qualifier] = indicator.split(':').map((s) => s.trim());
  const key = rawKey.toLowerCase().replace(/[.\s]+/g, '_');

  if (RISK_INDICATOR_LABELS[key]) {
    return qualifier ? `${RISK_INDICATOR_LABELS[key]} (${qualifier.replace(/_/g, ' ')})` : RISK_INDICATOR_LABELS[key];
  }
  if (key.startsWith('hrp_')) return 'Sanctions screening match';
  if (key.startsWith('fds_')) {
    const detail = qualifier ? RISK_INDICATOR_LABELS[qualifier.toLowerCase().replace(/[.\s]+/g, '_')] ?? qualifier.replace(/_/g, ' ') : '';
    return detail ? `Fraud risk detected (${detail})` : 'Fraud risk detected';
  }
  if (key.startsWith('aml_')) {
    const sev = SEVERITY_WORDS[(qualifier ?? '').toLowerCase()];
    return sev ? `Money-laundering alert (${sev} severity)` : 'Money-laundering alert';
  }
  if (key.startsWith('vop_')) return 'Payee name did not match the account holder';

  return indicator.replace(/[._]+/g, ' ');
}

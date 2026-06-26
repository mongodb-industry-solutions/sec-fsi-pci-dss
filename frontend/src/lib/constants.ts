export const API_BASE_URL =
  process.env.NEXT_PUBLIC_PSP_URL_BACKEND ?? 'http://localhost:8081';

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

export function formatRiskIndicator(indicator: string): string {
  if (indicator === 'amount_threshold') {
    return 'High-value transaction (amount exceeds fraud threshold)';
  }
  const mccMatch = indicator.match(/^high_risk_mcc_(\d+)$/);
  if (mccMatch) {
    const mcc = mccMatch[1];
    const label = MCC_LABELS[mcc];
    return `High-risk merchant category: MCC ${mcc}${label ? ` (${label})` : ''}`;
  }
  return indicator.replace(/_/g, ' ');
}

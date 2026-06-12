export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const DEMO_USERS_PASSWORDS: Record<string, string> = {
  // Customers
  'luis.fernandez@back.es': 'demo-password',
  'julia.santos@back.es': 'demo-password',
  'amara.okafor@demo.com': 'demo-password',
  'carlos.garcia@back.es': 'demo-password',
  'priya.patel@back.es': 'demo-password',
  // Analysts (L1)
  'sarah.chen@back.es': 'demo-password',
  'anna.kowalski@back.es': 'demo-password',
  // Investigators (L2)
  'michael.obi@back.es': 'demo-password',
  'james.wright@back.es': 'demo-password',
  // Security Auditors
  'diego.sans@back.es': 'demo-password',
  'sophie.martin@back.es': 'demo-password',
  // Merchant Officers
  'david.chen@demo.com': 'demo-password',
  'officer@bank.demo': 'demo-password',
  'marco.rossi@bank.demo': 'demo-password',
  // Manager
  'alex.rivera@back.es': 'demo-password',
};

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

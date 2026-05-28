export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const DEMO_USERS_PASSWORDS: Record<string, string> = {
  'luis.fernandez@leafybank.demo': 'demo-password',
  'julia.santos@leafybank.demo': 'demo-password',
  'sarah.chen@leafybank.demo': 'demo-password',
  'michael.obi@leafybank.demo': 'demo-password',
  'admin@leafybank.demo': 'demo-password',
};

export const ROLE_LABELS: Record<string, string> = {
  customer: 'Customer',
  level1_analyst: 'L1 Analyst',
  level2_investigator: 'L2 Investigator',
  security_auditor: 'Security Auditor',
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

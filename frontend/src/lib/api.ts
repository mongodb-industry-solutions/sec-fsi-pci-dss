import { API_BASE_URL } from './constants';

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...((options?.headers as Record<string, string>) ?? {}) },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

export interface LoginResponse {
  token: string;
  user: { partyAuthenticationInstanceReference: string; name: string; email: string; role: string };
}

export interface AuthUser {
  email: string;
  name: string;
  role: string;
}

export interface AuthDomain {
  name: string;
  displayName: string;
  type: 'local' | 'oidc' | 'saml';
  /** Determines UI behaviour: client_credentials → show form; others → show redirect button */
  flowType?: 'client_credentials' | 'authorization_code' | 'saml' | 'oidc';
  /** Optional banner text shown below the domain selector (sourced from DB) */
  alertMessage?: string;
}

export interface Merchant {
  name: string;
  mcc: string;
}

export interface CardTransactionCreateResponse {
  cardTransactionInstanceReference: string;
  cardTransactionStatus: string;
  fraudCaseCreated: boolean;
  fraudDiagnosisInstanceReference?: string;
}

export interface FraudCaseListResponse {
  results: FraudCase[];
  total: number;
  page: number;
  limit: number;
}

export interface TransactionSnapshot {
  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionMerchantName: string;
  cardTransactionDateTime: string;
  cardTransactionStatus: string;
  cardTransactionMaskedPanDisplay: string;
}

export interface FraudCase {
  fraudDiagnosisInstanceReference: string;
  fraudDiagnosisCaseReference: string;
  caseStatus: string;
  riskSeverity: string;
  linkedCardTransactionReference: string;
  linkedCustomerAgreementReference: string;
  transactionSnapshot?: TransactionSnapshot;
  fraudDiagnosisAssessment?: {
    riskIndicators: string[];
    fraudDiagnosisScore?: number;
  };
  diagnosisActionLog?: ActionEvent[];
  requestDateTime?: string;
}

export interface ActionEvent {
  actionDateTime: string;
  actionType: string;
  performedByInstanceReference: string;
  performedByRole: string;
  actionDetails: Record<string, unknown>;
}

export interface RawDocumentResponse {
  collection: string;
  document: Record<string, unknown>;
}

export const api = {
  auth: {
    login: (body: { email: string; password: string; domain: string }) =>
      apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    users: () =>
      apiFetch<{ users: AuthUser[] }>('/api/v1/auth/users'),
    domains: () =>
      apiFetch<{ domains: AuthDomain[] }>('/api/v1/auth/domains'),
  },

  transactions: {
    create: (body: object, token?: string) =>
      apiFetch<CardTransactionCreateResponse>('/api/v1/transactions', {
        method: 'POST',
        body: JSON.stringify(body),
      }, token),
    merchants: () =>
      apiFetch<{ merchants: Merchant[] }>('/api/v1/transactions/merchants'),
    getById: (id: string, token: string) =>
      apiFetch<Record<string, unknown>>(`/api/v1/transactions/${id}`, {}, token),
    getByCardToken: (cardToken: string, token: string) =>
      apiFetch<{ results: Record<string, unknown>[]; count: number }>(
        `/api/v1/transactions?cardToken=${encodeURIComponent(cardToken)}`, {}, token
      ),
  },

  customer: {
    getByEmail: (email: string, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer?email=${encodeURIComponent(email)}`, {}, token
      ),
    getByPhone: (phone: string, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer?phone=${encodeURIComponent(phone)}`, {}, token
      ),
    getByAccountRef: (ref: string, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer?accountRef=${encodeURIComponent(ref)}`, {}, token
      ),

    getCards: (customerId: string, token: string) =>
      apiFetch<{ results: Record<string, unknown>[] }>(
        `/api/v1/customer/${encodeURIComponent(customerId)}/cards`, {}, token
      ),
    addCard: (
      customerId: string,
      body: {
        cardToken: string;
        paymentCardExpirationDate: string;
        paymentCardMaskedPanDisplay: string;
        paymentCardNetwork: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
        paymentCardIsPreferred?: boolean;
      },
      token: string
    ) =>
      apiFetch<{ paymentCardInstanceReference: string; paymentCardStatus: string }>(
        `/api/v1/customer/${encodeURIComponent(customerId)}/cards`,
        { method: 'POST', body: JSON.stringify(body) },
        token
      ),
  },

  fraud: {
    list: (
      params: { status?: string; severity?: string; page?: number; limit?: number },
      token: string
    ) => {
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString();
      return apiFetch<FraudCaseListResponse>(
        `/api/v1/fraud${qs ? `?${qs}` : ''}`, {}, token
      );
    },
    getById: (id: string, token: string) =>
      apiFetch<FraudCase>(`/api/v1/fraud/${id}`, {}, token),
  },

  system: {
    users: () =>
      apiFetch<{ users: AuthUser[] }>('/api/v1/system/users'),
    rawDocument: (collection: string, id: string, token: string) =>
      apiFetch<RawDocumentResponse>(
        `/api/v1/system/raw/${collection}/${id}`, {}, token
      ),
  },

  health: () => apiFetch<{ status: string; atlas: string; kmsProvider: string; timestamp: string }>('/api/v1/system/health'),
};

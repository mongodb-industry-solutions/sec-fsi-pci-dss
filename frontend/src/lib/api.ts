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
  featured?: boolean;
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
  cardTransactionInstanceReference: string;
  customerAgreementInstanceReference: string;
  transactionSnapshot?: TransactionSnapshot;
  fraudDiagnosisAssessment?: {
    riskIndicators: string[];
    fraudDiagnosisScore?: number;
  };
  fraudDiagnosisCaseNotes?: string | null;
  fraudDiagnosisCustomerSubjectNotes?: string | null;
  fraudDiagnosisResolutionRecord?: {
    resolutionDateTime: string;
    resolutionOutcome: 'cleared' | 'confirmed_fraud' | 'referred';
    resolutionNotes: string;
  } | null;
  escalationAcceptedAt?: string | null;
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

export interface HrpcFlag {
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  label: string;
  description: string;
  detectedAt: string;
  source: string;
  reviewRequired: boolean;
}

export interface HrpcCheckResponse {
  accountRef: string;
  hrpcMatch: boolean;
  highestRiskLevel: 'none' | 'low' | 'medium' | 'high';
  hrpcFlags: HrpcFlag[];
}

export interface AuditEventWithCase extends ActionEvent {
  fraudDiagnosisInstanceReference: string;
  fraudDiagnosisCaseReference?: string;
}

export interface AuditEventsResponse {
  events: AuditEventWithCase[];
  total: number;
  page: number;
  limit: number;
}

export interface EscalationApproveResponse {
  fraudDiagnosisInstanceReference: string;
  fraudDiagnosisCaseStatus: string;
  escalationToken: string;
  escalationApprovedAt: string;
  tokenExpiresAt: string;
}

export interface CaseEventsResponse {
  caseId: string;
  events: ActionEvent[];
}

export interface NoteEntry {
  noteId: string;
  noteText: string;
  visibility: 'internal' | 'customer';
  performedByRole: string;
  actionDateTime: string;
  isRetracted: boolean;
  retractionReason: string | null;
  retractionDateTime: string | null;
}

export interface CaseNotesResponse {
  notes: NoteEntry[];
}

export interface TransactionNotesResponse {
  caseFound: boolean;
  fraudDiagnosisCaseReference: string | null;
  fraudDiagnosisCaseStatus: string | null;
  fraudDiagnosisCaseSeverity: string | null;
  fraudDiagnosisResolutionOutcome: string | null;
  notes: NoteEntry[];
}

export const api = {
  auth: {
    login: (body: { email: string; password: string; domain: string }) =>
      apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    users: (featured?: boolean) =>
      apiFetch<{ users: AuthUser[] }>(`/api/v1/auth/users${featured ? '?featured=true' : ''}`),
    domains: () =>
      apiFetch<{ domains: AuthDomain[] }>('/api/v1/auth/domains'),
    updateMe: (
      body: {
        customerName?: string;
        customerMobilePhoneNumber?: string;
        customerAgreementPreferredLanguage?: string;
        customerAgreementResidentialAddress?: { streetAddress: string; city: string; postalCode: string; countryCode: string };
      },
      token: string
    ) =>
      apiFetch<{ updated: boolean }>(
        '/api/v1/auth/me',
        { method: 'PATCH', body: JSON.stringify(body) },
        token
      ),
    me: (token: string) =>
      apiFetch<{
        sub: string;
        email: string;
        name: string;
        role: string;
        domain: string;
        partyInstanceReference?: string;
        agreement: Record<string, unknown> | null;
      }>('/api/v1/auth/me', {}, token),
  },

  transactions: {
    create: (body: object, token?: string) =>
      apiFetch<CardTransactionCreateResponse>('/api/v1/transactions', {
        method: 'POST',
        body: JSON.stringify(body),
      }, token),
    merchants: () =>
      apiFetch<{ merchants: Merchant[] }>('/api/v1/transactions/merchants'),
    getById: (id: string, token: string, escalationToken?: string) =>
      apiFetch<{
        cardTransactionInstanceReference: string;
        cardTransactionAmount: { amount: number; currency: string };
        cardTransactionDateTime: string;
        cardTransactionStatus: string;
        cardTransactionType?: string;
        cardTransactionMerchantName: string;
        cardTransactionMerchantCategoryCode?: string;
        cardTransactionMaskedPanDisplay: string;
        cardTransactionChannel?: string;
        cardTransactionInitiationType?: string;
        cardTransactionDescription?: string;
        cardTransactionNarrative?: string;
        paymentCardReference?: string;
        cardTransactionAccountReference?: string;
        sensitive?: {
          rawGatewayPayload?: Record<string, unknown>;
          processorTransactionMetadata?: Record<string, unknown>;
        } | null;
      }>(
        `/api/v1/transactions/${id}`,
        escalationToken ? { headers: { 'X-Escalation-Token': escalationToken } } : {},
        token
      ),
    getByCardToken: (cardToken: string, token: string) =>
      apiFetch<{ results: Record<string, unknown>[]; count: number }>(
        `/api/v1/transactions?cardToken=${encodeURIComponent(cardToken)}`, {}, token
      ),
    getNotes: (txnId: string, token: string) =>
      apiFetch<TransactionNotesResponse>(`/api/v1/transactions/${txnId}/notes`, {}, token),
    listAll: (
      params: { status?: string; merchant?: string; cardToken?: string; email?: string; page?: number; limit?: number },
      token: string
    ) => {
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString();
      return apiFetch<{
        results: Record<string, unknown>[];
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/transactions/all${qs ? `?${qs}` : ''}`, {}, token);
    },
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

    getById: (id: string, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer/by-id/${encodeURIComponent(id)}`, {}, token
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
      params: { status?: string; severity?: string; transactionId?: string; customerId?: string; caseReference?: string; page?: number; limit?: number },
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
    // Investigation analytics for L1/L2/auditor dashboards (no PII).
    stats: (token: string) =>
      apiFetch<{
        total: number; open: number; underReview: number; escalated: number; resolvedFraud: number; resolvedCleared: number;
        byStatus: Array<{ status: string; count: number }>;
        bySeverity: Array<{ severity: string; count: number }>;
        byMonth: Array<{ year: number; month: number; count: number }>;
      }>('/api/v1/fraud/stats', {}, token),
    // Auditor data-integrity oversight (PCI DSS Req 10) — no PII.
    integrity: (token: string) =>
      apiFetch<{
        totalCases: number;
        duplicateCount: number;
        duplicateReferences: Array<{ reference: string; count: number }>;
        orphanTransactionRefs: number;
        orphanCustomerRefs: number;
        orphanCustomerReferences: Array<{ reference: string; count: number }>;
        healthy: boolean;
      }>('/api/v1/fraud/integrity', {}, token),
    getEvents: (id: string, token: string) =>
      apiFetch<CaseEventsResponse>(`/api/v1/fraud/${id}/events`, {}, token),
    allEvents: (params: { page?: number; limit?: number }, token: string) => {
      const qs = new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString();
      return apiFetch<AuditEventsResponse>(
        `/api/v1/fraud/audit-events${qs ? `?${qs}` : ''}`, {}, token
      );
    },
    escalate: (id: string, body: { escalationReason: string }, token: string) =>
      apiFetch<{ fraudDiagnosisInstanceReference: string; fraudDiagnosisCaseStatus: string; escalationDateTime: string }>(
        `/api/v1/fraud/${id}/escalate`,
        { method: 'POST', body: JSON.stringify(body) },
        token
      ),
    escalateApprove: (id: string, body: { approvalNotes?: string }, token: string) =>
      apiFetch<EscalationApproveResponse>(
        `/api/v1/fraud/${id}/escalate/approve`,
        { method: 'POST', body: JSON.stringify(body) },
        token
      ),
    escalateReject: (id: string, body: { rejectionNotes?: string }, token: string) =>
      apiFetch<{ fraudDiagnosisInstanceReference: string; fraudDiagnosisCaseStatus: string; rejectedAt: string }>(
        `/api/v1/fraud/${id}/escalate/reject`,
        { method: 'POST', body: JSON.stringify(body) },
        token
      ),
    getNotes: (caseId: string, token: string) =>
      apiFetch<CaseNotesResponse>(`/api/v1/fraud/${caseId}/notes`, {}, token),
    addNote: (
      caseId: string,
      body: { noteText: string; visibility: 'internal' | 'customer' },
      token: string
    ) =>
      apiFetch<{ noteId: string; actionDateTime: string }>(
        `/api/v1/fraud/${caseId}/notes`,
        { method: 'POST', body: JSON.stringify(body) },
        token
      ),
    retractNote: (
      caseId: string,
      noteId: string,
      body: { retractionReason?: string },
      token: string
    ) =>
      apiFetch<{ retractedNoteId: string; retractionDateTime: string }>(
        `/api/v1/fraud/${caseId}/notes/${noteId}`,
        { method: 'DELETE', body: JSON.stringify(body) },
        token
      ),
    open: (body: { transactionId: string; reason?: string }, token: string) =>
      apiFetch<{ fraudDiagnosisInstanceReference: string; fraudDiagnosisCaseReference: string; alreadyExisted: boolean }>(
        '/api/v1/fraud',
        { method: 'POST', body: JSON.stringify(body) },
        token
      ),
    update: (
      id: string,
      body: {
        fraudDiagnosisCaseStatus?: string;
        fraudDiagnosisCaseNotes?: string;
        fraudDiagnosisCustomerSubjectNotes?: string;
        resolutionOutcome?: 'cleared' | 'confirmed_fraud' | 'referred';
        resolutionNotes?: string;
      },
      token: string
    ) =>
      apiFetch<{ fraudDiagnosisInstanceReference: string; fraudDiagnosisCaseStatus: string; recordUpdatedDateTime: string }>(
        `/api/v1/fraud/${id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        token
      ),
  },

  hrpc: {
    check: (accountRef: string, token: string) =>
      apiFetch<HrpcCheckResponse>(
        `/api/v1/fraud/hrpc/check?accountRef=${encodeURIComponent(accountRef)}`,
        {},
        token
      ),
  },

  system: {
    users: (featured?: boolean) =>
      apiFetch<{ users: AuthUser[] }>(`/api/v1/system/users${featured ? '?featured=true' : ''}`),
    rawDocument: (collection: string, id: string, token: string) =>
      apiFetch<RawDocumentResponse>(
        `/api/v1/system/raw/${collection}/${id}`, {}, token
      ),
  },

  health: () => apiFetch<{ status: string; atlas: string; kmsProvider: string; timestamp: string }>('/api/v1/system/health'),

  merchants: {
    picker: (params: { q?: string; limit?: number }, token: string) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
      ).toString();
      return apiFetch<{
        results: Array<{
          merchantAgreementInstanceReference: string;
          merchantName: string;
          merchantCategoryCode: string;
          merchantRiskCategory: 'low' | 'medium' | 'high';
        }>;
        total: number;
      }>(`/api/v1/merchants/picker${qs ? `?${qs}` : ''}`, {}, token);
    },
    getMe: (token: string) =>
      apiFetch<{ found: boolean; merchant: Record<string, unknown> | null }>(
        '/api/v1/merchants/me', {}, token
      ),
    review: (merchantId: string, body: { action: 'approve' | 'reject'; reviewNote?: string }, token: string) =>
      apiFetch<{ merchantAgreementInstanceReference: string; merchantAgreementStatus: string; merchantReviewedDateTime: string }>(
        `/api/v1/merchants/${merchantId}/review`,
        { method: 'PATCH', body: JSON.stringify(body) },
        token
      ),
    list: (filters: { status?: string; mcc?: string; name?: string; risk?: string; page?: number; limit?: number }, token: string) => {
      const qs = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
      ).toString();
      return apiFetch<{ results: Record<string, unknown>[]; total: number }>(
        `/api/v1/merchants${qs ? `?${qs}` : ''}`, {}, token
      );
    },
    getById: (id: string, token: string) =>
      apiFetch<Record<string, unknown>>(`/api/v1/merchants/${id}`, {}, token),
    // Partial update of merchant configuration (PATCH /:id). Owner may self-serve
    // operational fields; risk-governed fields require PSP staff.
    update: (
      id: string,
      patch: Partial<{
        merchantAllowedCurrencies: string[];
        merchantSettlementSchedule: string;
        merchantWebhookEndpoint: string;
        merchantTransactionLimitAmount: number;
        merchantAgreementStatus: string;
      }>,
      token: string,
    ) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/merchants/${id}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
        token,
      ),
    // Acquiring-side: payments this merchant received (no payer PII returned).
    transactions: (merchantId: string, params: { page?: number; limit?: number; status?: string; search?: string }, token: string) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
      ).toString();
      return apiFetch<{
        results: Array<{
          cardTransactionInstanceReference: string;
          cardTransactionAmount: { amount: number; currency: string };
          cardTransactionDateTime: string;
          cardTransactionStatus: string;
          cardTransactionType?: string;
          cardTransactionChannel?: string;
          cardTransactionMerchantName: string;
          cardTransactionMaskedPanDisplay: string;
          cardTransactionDescription?: string;
        }>;
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/merchants/${merchantId}/transactions${qs ? `?${qs}` : ''}`, {}, token);
    },
    // Acquiring analytics (BIAN Merchant Activity Analysis): totals + breakdowns, no PII.
    stats: (merchantId: string, token: string) =>
      apiFetch<{
        count: number;
        totalAmount: number;
        avgAmount: number;
        byStatus: Array<{ status: string; count: number; amount: number }>;
        byMonth: Array<{ year: number; month: number; count: number; amount: number }>;
        byCurrency: Array<{ currency: string; count: number; amount: number }>;
      }>(`/api/v1/merchants/${merchantId}/stats`, {}, token),
    // Merchant lifecycle audit trail (SD-89, PCI DSS Req 10).
    events: (merchantId: string, token: string) =>
      apiFetch<{
        events: Array<{
          merchantAgreementEventInstanceReference: string;
          eventType: string;
          eventDateTime: string;
          performedByPartyReference?: string;
          performedByRole?: string;
          details?: Record<string, unknown>;
        }>;
      }>(`/api/v1/merchants/${merchantId}/events`, {}, token),
    create: (body: Record<string, unknown>, token: string) =>
      apiFetch<{ merchantAgreementInstanceReference: string; merchantName: string; merchantAgreementStatus: string; merchantApiKey: string }>(
        '/api/v1/merchants', { method: 'POST', body: JSON.stringify(body) }, token
      ),
    // API key metadata (no secret/hash) — id, prefix, label, status, dates.
    listKeys: (merchantId: string, token: string) =>
      apiFetch<{
        keys: Array<{
          keyId: string;
          keyPrefix: string;
          keyLabel: string | null;
          keyStatus: 'active' | 'revoked';
          keyCreatedDateTime: string;
          keyLastUsedDateTime: string | null;
        }>;
      }>(`/api/v1/merchants/${merchantId}/keys`, {}, token),
    generateKey: (merchantId: string, token: string, label?: string) =>
      apiFetch<{ keyId: string; keyPrefix: string; keyLabel?: string | null; merchantApiKey: string }>(
        `/api/v1/merchants/${merchantId}/keys`, { method: 'POST', body: JSON.stringify({ label }) }, token
      ),
    revokeKey: (merchantId: string, keyId: string, token: string) =>
      apiFetch<{ revoked: boolean; keyId: string }>(
        `/api/v1/merchants/${merchantId}/keys/${keyId}`, { method: 'DELETE' }, token
      ),
    registerWebhook: (merchantId: string, webhookEndpoint: string, token: string) =>
      apiFetch<{ merchantAgreementInstanceReference: string; merchantWebhookEndpoint: string }>(
        `/api/v1/merchants/${merchantId}/webhooks`,
        { method: 'POST', body: JSON.stringify({ webhookEndpoint }) },
        token
      ),
  },

  checkout: {
    createSession: (body: {
      merchantAgreementInstanceReference: string;
      amount: number;
      currency: string;
      description: string;
      returnUrl: string;
      cancelUrl: string;
      merchantReference: string;
    }, token: string) =>
      apiFetch<{ checkoutSessionInstanceReference: string; paymentPageUrl: string; expiresAt: string }>(
        '/api/v1/checkout/sessions', { method: 'POST', body: JSON.stringify(body) }, token
      ),
    getSession: (sessionId: string) =>
      apiFetch<{
        checkoutSessionInstanceReference: string;
        checkoutSessionAmount: number;
        checkoutSessionCurrency: string;
        checkoutSessionDescription: string;
        merchantName: string;
        checkoutSessionStatus: string;
        checkoutSessionExpiresAt: string;
        checkoutSessionReturnUrl: string;
        checkoutSessionCancelUrl: string;
      }>(`/api/v1/checkout/sessions/${sessionId}`),
    pay: (sessionId: string, body: { cardToken: string; cardholderName: string; cardExpiryMonth: string; cardExpiryYear: string; cardholderEmail?: string; saveCard?: boolean }) =>
      apiFetch<{ success: boolean; cardTransactionInstanceReference: string; redirectUrl: string }>(
        `/api/v1/checkout/sessions/${sessionId}/pay`, { method: 'POST', body: JSON.stringify(body) }
      ),
    cancelSession: (sessionId: string, merchantAgreementInstanceReference: string, token: string) =>
      apiFetch<{ checkoutSessionInstanceReference: string; checkoutSessionStatus: string }>(
        `/api/v1/checkout/sessions/${sessionId}`,
        { method: 'DELETE', body: JSON.stringify({ merchantAgreementInstanceReference }) },
        token
      ),
  },

  paymentLinks: {
    create: (body: {
      merchantAgreementInstanceReference: string;
      amount: number;
      currency: string;
      description: string;
      customerMessage?: string;
      usageType: 'single_use' | 'multi_use';
      maxUses?: number;
      expiresAt?: string;
    }, token: string) =>
      apiFetch<{ paymentLinkInstanceReference: string; paymentLinkCode: string; paymentUrl: string }>(
        '/api/v1/payment/links', { method: 'POST', body: JSON.stringify(body) }, token
      ),
    list: (merchantId: string, token: string, page = 1, limit = 20) =>
      apiFetch<{ results: Record<string, unknown>[]; total: number }>(
        `/api/v1/payment/links?merchantId=${encodeURIComponent(merchantId)}&page=${page}&limit=${limit}`,
        {}, token
      ),
    resolve: (code: string) =>
      apiFetch<{
        paymentLinkCode: string;
        paymentLinkAmount: number;
        paymentLinkCurrency: string;
        paymentLinkDescription: string;
        merchantName: string;
        paymentLinkCustomerMessage?: string;
        paymentLinkStatus: string;
        paymentLinkExpiresAt?: string;
      }>(`/api/v1/payment/links/${code}`),
    pay: (code: string, body: { cardToken: string; cardholderName: string; cardExpiryMonth: string; cardExpiryYear: string; customerEmail?: string }) =>
      apiFetch<{ success: boolean; cardTransactionInstanceReference: string; fraudDiagnosisInstanceReference?: string | null }>(
        `/api/v1/payment/links/${code}/pay`, { method: 'POST', body: JSON.stringify(body) }
      ),
    deactivate: (id: string, merchantAgreementInstanceReference: string, token: string) =>
      apiFetch<{ paymentLinkInstanceReference: string; paymentLinkStatus: string }>(
        `/api/v1/payment/links/${id}`,
        { method: 'PATCH', body: JSON.stringify({ action: 'deactivate', merchantAgreementInstanceReference }) },
        token
      ),
  },
  simulator: {
    createCheckoutSession: (body: {
      merchantId: string;
      amount: number;
      currency: string;
      description: string;
      returnUrl: string;
      cancelUrl: string;
      merchantReference: string;
    }) =>
      apiFetch<{ checkoutSessionInstanceReference: string; paymentPageUrl: string; expiresAt: string }>(
        '/api/v1/system/simulator/checkout-session', { method: 'POST', body: JSON.stringify(body) }
      ),
    createPaymentLink: (body: {
      merchantId: string;
      amount: number;
      currency: string;
      description: string;
      customerMessage?: string;
      usageType: 'single_use' | 'multi_use';
    }) =>
      apiFetch<{ paymentLinkInstanceReference: string; paymentLinkCode: string; paymentUrl: string }>(
        '/api/v1/system/simulator/payment-link', { method: 'POST', body: JSON.stringify(body) }
      ),
    getTransactions: (email: string) =>
      apiFetch<{ transactions: Record<string, unknown>[]; total: number }>(
        `/api/v1/system/simulator/transactions/${encodeURIComponent(email)}`
      ),
  },

  integrations: {
    list: (token: string, params?: { type?: string; status?: string }) => {
      const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([,v]) => v) as [string,string][]).toString() : '';
      return apiFetch<{ integrations: Record<string, unknown>[] }>(`/api/v1/integrations/providers${qs}`, {}, token);
    },
    get: (id: string, token: string) =>
      apiFetch<{ integration: Record<string, unknown> }>(`/api/v1/integrations/providers/${id}`, {}, token),
    create: (body: Record<string, unknown>, token: string) =>
      apiFetch<{ integration: Record<string, unknown>; apiKey?: string }>(
        '/api/v1/integrations/providers', { method: 'POST', body: JSON.stringify(body) }, token
      ),
    update: (id: string, body: Record<string, unknown>, token: string) =>
      apiFetch<{ integration: Record<string, unknown> }>(
        `/api/v1/integrations/providers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token
      ),
    rotateKey: (id: string, token: string) =>
      apiFetch<{ integration: Record<string, unknown>; apiKey: string }>(
        `/api/v1/integrations/providers/${id}/rotate-key`, { method: 'POST' }, token
      ),
    test: (id: string, token: string) =>
      apiFetch<{ status: string; latencyMs: number }>(`/api/v1/integrations/providers/${id}/test`, { method: 'POST' }, token),
    suspend: (id: string, token: string) =>
      apiFetch<{ integration: Record<string, unknown> }>(`/api/v1/integrations/providers/${id}/suspend`, { method: 'POST' }, token),
    events: (id: string, token: string, page = 1, limit = 20) =>
      apiFetch<{ events: Record<string, unknown>[]; total: number; page: number }>(
        `/api/v1/integrations/providers/${id}/events?page=${page}&limit=${limit}`, {}, token
      ),
    testMapping: (id: string, body: { direction: 'outbound' | 'inbound'; payload: Record<string, unknown> }, token: string) =>
      apiFetch<{ original: Record<string, unknown>; transformed: Record<string, unknown>; appliedRules: number; errors: string[] }>(
        `/api/v1/integrations/providers/${id}/test-mapping`, { method: 'POST', body: JSON.stringify(body) }, token
      ),
    delete: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(
        `/api/v1/integrations/providers/${id}`, { method: 'DELETE' }, token
      ),
  },
  integrationGroups: {
    list: (token: string, params?: { type?: string }) => {
      const qs = params?.type ? `?type=${params.type}` : '';
      return apiFetch<{ groups: Record<string, unknown>[] }>(`/api/v1/integrations/groups${qs}`, {}, token);
    },
    get: (id: string, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(`/api/v1/integrations/groups/${id}`, {}, token),
    create: (body: { name: string; providerType: string; strategy: string }, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        '/api/v1/integrations/groups', { method: 'POST', body: JSON.stringify(body) }, token
      ),
    update: (id: string, body: Record<string, unknown>, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        `/api/v1/integrations/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token
      ),
    addMember: (groupId: string, body: { providerId: string; priority?: number; weight?: number }, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        `/api/v1/integrations/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify(body) }, token
      ),
    removeMember: (groupId: string, providerId: string, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        `/api/v1/integrations/groups/${groupId}/members/${providerId}`, { method: 'DELETE' }, token
      ),
    getDefault: (type: string, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(`/api/v1/integrations/groups/default/${type}`, {}, token),
    updateStrategy: (groupId: string, strategy: string, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        `/api/v1/integrations/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify({ routingGroupStrategy: strategy }) }, token
      ),
  },
};

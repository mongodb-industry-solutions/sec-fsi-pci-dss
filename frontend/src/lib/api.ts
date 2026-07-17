import { API_BASE_URL } from './constants';

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
  token?: string
): Promise<T> {
  // Only advertise a JSON body when one is actually sent. A bodyless request (DELETE,
  // GET) that still carries `Content-Type: application/json` makes Fastify's JSON parser
  // reject it with FST_ERR_CTP_EMPTY_JSON_BODY ("Body cannot be empty…"). This surfaced
  // when leaving a routing group (DELETE with no body).
  const headers: Record<string, string> = {
    ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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

// v17.1 bank transfer destination (banking coordinates for the rail engine).
export interface BankDestination {
  countryCode: string;
  currency: string;
  iban?: string;
  accountNumber?: string;
  routingNumber?: string;
  bic?: string;
  correspondentBic?: string;
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
  partyRef?: string;
  /** Present when this customer owns a merchant (customer who is also a merchant owner). */
  merchant?: { id: string; name: string; mcc?: string };
}

/** Declarative filters for the shared demo roster (see config/demoRoster.json). */
export interface DemoUserFilters {
  featured?: boolean;
  role?: string[];
  q?: string;
  isMerchant?: boolean;
}

// Build the demo-roster querystring. Accepts a legacy boolean (= { featured }) or a filters object.
function demoRosterQuery(arg?: boolean | DemoUserFilters): string {
  const f: DemoUserFilters = typeof arg === 'boolean' ? { featured: arg } : (arg ?? {});
  const qs = new URLSearchParams();
  if (f.featured) qs.set('featured', 'true');
  if (f.role?.length) qs.set('role', f.role.join(','));
  if (f.q) qs.set('q', f.q);
  if (f.isMerchant) qs.set('isMerchant', 'true');
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export interface AuthDomain {
  name: string;
  displayName: string;
  type: 'local' | 'oidc' | 'saml';
  /** Determines UI behaviour: client_credentials → show form; others → show redirect button */
  flowType?: 'client_credentials' | 'authorization_code' | 'saml' | 'oidc';
  /** Optional banner text shown below the domain selector (sourced from DB) */
  alertMessage?: string;
  /** True when this local domain accepts public self-registration (show a Register link). */
  selfRegistration?: boolean;
}

// v16: Typed webhook types (ADR-038)
export type WebhookEventType =
  | 'payment.completed'
  | 'payment.failed'
  | 'oauth.authorization_granted'
  | 'oauth.authorization_revoked'
  | 'user.notification'
  | 'dispute.opened'
  | 'kyb.status_changed';

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'payment.completed': 'Payment Completed',
  'payment.failed': 'Payment Failed',
  'oauth.authorization_granted': 'App Access Granted',
  'oauth.authorization_revoked': 'App Access Revoked',
  'user.notification': 'User Notification (delegation)',
  'dispute.opened': 'Dispute Opened',
  'kyb.status_changed': 'KYB Status Changed',
};

export interface TypedWebhookConfig {
  webhookId: string;
  webhookEventType: WebhookEventType;
  webhookUrl: string;
  webhookSecret: string;           // Masked on GET
  webhookStatus: 'active' | 'inactive';
  webhookAttributeMapping?: Record<string, string>;
  webhookHeaders?: Record<string, string>;
  webhookApiKeyId?: string;
  webhookApiKeyTransport?: 'header' | 'body';
  webhookApiKeyFieldName?: string;
  webhookCreatedDateTime: string;
  webhookLastTestedAt?: string;
  webhookLastDeliveryStatus?: 'success' | 'failed';
  webhookLastDeliveryError?: string;
}

export interface TypedWebhookTestResult {
  delivered: boolean;
  statusCode?: number;
  attempts: number;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  response?: { status: number; headers: Record<string, string>; body: unknown };
  error?: string;
  signature: string;
}

export interface WebhookDeliveryLog {
  logId: string;
  merchantAgreementInstanceReference: string;
  webhookId: string;
  webhookEventType: WebhookEventType;
  deliveryType: 'live' | 'test';
  requestUrl: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  delivered: boolean;
  attempts: number;
  error?: string;
  signature: string;
  deliveredAt: string;
}

// v16: Merchant OAuth 2.0 client registration (SD-89 BQ:Grant)
export interface MerchantOAuthClient {
  oauthClientId: string;
  oauthClientSecretPrefix: string;          // First 8 chars — plaintext never returned
  oauthRedirectUris: string[];
  oauthGrantTypes: ('authorization_code' | 'client_credentials' | 'refresh_token')[];
  oauthScopes: string[];
  oauthClientStatus: 'active' | 'suspended' | 'revoked';
  oauthClientCreatedDateTime: string;
  oauthTokenLifetimeSeconds: number;
  oauthRefreshTokenLifetimeDays: number;
  oauthRequirePkce: boolean;
  oauthPostLogoutRedirectUris?: string[];
  oauthClaimMapping?: Record<string, string>;
  oauthLogoUri?: string;   // v18: OIDC logo_uri (https) — branding on the consent page + app listings
  oauthClientUri?: string; // v18: OIDC client_uri (https) — merchant home page link
}

// v16: OAuth consent grants (user-authorized apps)
export interface ConsentGrant {
  consentId: string;
  oauthClientId: string;
  merchantAgreementInstanceReference: string;
  merchantName: string;
  oauthLogoUri?: string | null; // v18: OIDC logo_uri (branding) for the authorized-apps list
  grantedScopes: string[];
  consentStatus: 'active' | 'revoked';
  consentGrantedAt: string;
  consentRevokedAt?: string | null;
  lastUsedAt?: string | null;
}

// passwordless enrolled credential (WebAuthn-style). Public metadata only; keys never leave the device.
export interface EnrolledCredential {
  credentialId: string;
  partyEnrolledCredentialInstanceReference: string;
  alg: 'RS256' | 'ES256';
  deviceName?: string;
  status: 'active' | 'revoked';
  createdAt: string;
  lastUsedAt?: string | null;
}

// v18 D-01: detail of one authorized app — scopes expanded with human-readable descriptions + branding.
export interface ConsentGrantScope {
  scope: string;
  description: string;
  required: boolean;
}
export interface ConsentGrantDetail {
  consentId: string;
  oauthClientId: string;
  merchantAgreementInstanceReference: string;
  merchantName: string;
  oauthLogoUri?: string | null;
  oauthClientUri?: string | null;
  grantedScopes: ConsentGrantScope[];
  consentStatus: 'active' | 'revoked';
  consentGrantedAt: string;
  lastUsedAt?: string | null;
  cibaEnabled?: boolean; // client may initiate CIBA (passwordless/backchannel) on the user's behalf
}

export interface Merchant {
  name: string;
  mcc: string;
}

// dev.v8 F3: create now returns PENDING; the authorized/declined outcome arrives over SSE.
export interface CardTransactionCreateResponse {
  cardTransactionInstanceReference: string;
  cardTransactionStatus: string; // 'pending'
}

// Terminal authorization outcome delivered by GET /transactions/:id/stream (SSE).
export interface PaymentOutcome {
  status: 'authorized' | 'declined';
  fraudCaseCreated?: boolean;
  caseId?: string | null;
  declineReason?: string | null;
  declineCode?: string | null;
}

// Opens the public per-transaction SSE stream and resolves with the first terminal outcome. The
// backend emits immediately if the outcome already landed, so this is race-safe. Public (no token).
export function awaitPaymentOutcome(txnId: string, signal?: AbortSignal): Promise<PaymentOutcome> {
  return new Promise<PaymentOutcome>((resolve, reject) => {
    fetch(`${API_BASE_URL}/api/v1/transactions/${encodeURIComponent(txnId)}/stream`, { signal })
      .then(async (res) => {
        if (!res.body) { reject(new Error('No stream')); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) { reject(new Error('Stream closed before outcome')); return; }
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            const json = dataLine.slice(5).trim();
            if (!json || json === '{}') continue;
            try {
              const d = JSON.parse(json) as PaymentOutcome;
              if (d.status) { await reader.cancel(); resolve(d); return; }
            } catch { /* ignore non-JSON keepalives */ }
          }
        }
      })
      .catch(reject);
  });
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
  performedByName?: string;
  performedByRole: string;
  actionDetails: Record<string, unknown>;
}

export interface RawDocumentResponse {
  collection: string;
  document: Record<string, unknown>;
}

export interface CaseEnrichment {
  caseId: string;
  asOf: string;
  operation: {
    transactionId: string;
    type: string;
    status: string;
    channel: string | null;
    merchantCategoryCode: string | null;
    merchantName: string;
    maskedPan: string;
    amount: { amount: number; currency: string };
    dateTime: string;
    description: string | null;
  } | null;
  sdf: {
    score: number | null;
    scorePending: boolean;
    indicators: string[];
    conclusion: string | null;
    events: Array<{ dateTime: string; action: string; outcome: string; summary?: Record<string, unknown> }>;
  };
  hrp: {
    available: boolean;
    match?: boolean;
    highestRiskLevel?: 'none' | 'low' | 'medium' | 'high';
    flags?: Array<{ category: string; riskLevel: string; label: string; description: string; detectedAt: string; source: string; reviewRequired: boolean }>;
  };
  kyc: {
    customerId: string;
    name: string | null;
    segment: string | null;
    status: string | null;
    enrollmentDate: string | null;
    kycCheck: Record<string, unknown> | null;
    accountRef: string | null;
    email: string | null;
    phone: string | null;
    contactRestricted: boolean;
    sensitiveUnlocked: boolean;
    sensitive: Record<string, unknown> | null;
  } | null;
  kyb: {
    merchantId: string;
    name: string;
    status: string;
    kybCheck: Record<string, unknown> | null;
    riskCategory: string | null;
    tier: string | null;
    countryCode: string | null;
    categoryCode: string | null;
  } | null;
  references: {
    caseId: string;
    transactionId: string | null;
    customerId: string | null;
    merchantId: string | null;
    accountRef: string | null;
  };
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

// ADR-031: customer questions raised by L1/L2 investigators (SD-83), answered by the customer.
export interface CustomerQuestion {
  questionId: string;
  caseReference: string;
  transactionId: string;
  questionText: string;
  options: string[];
  allowOther: boolean;
  status: 'pending' | 'closed';
  askedByRole: string;
  askedDateTime: string;
  responseOption: string | null;
  responseText: string | null;
  respondedDateTime: string | null;
}

export interface NotificationItem {
  id: string;
  type: 'fraud_question' | 'transaction_status' | string;
  title: string;
  detail: string;
  href: string;
  transactionId: string | null;
  caseReference: string | null;
  status: 'unread' | 'read';
  actionable: boolean;
  createdAt: string;
  readAt: string | null;
}

// ADR-030: data-driven RBAC/ACL
export type AclPermissionMap = Record<string, string[]>;
export interface EffectivePermissions {
  role: string;
  label: string;
  description: string | null;
  scope: 'own' | 'all';
  isBuiltin: boolean;
  bianServiceDomain: string | null;
  permissions: AclPermissionMap;
  catalog: { resources: string[]; actions: string[] };
}
export interface ManagedUserDTO {
  id: string;
  email: string;
  name: string;
  role: string;
  domain: string;
  status: 'active' | 'suspended' | 'pending';
  featured?: boolean;
  partyReference?: string;
  lastLoginAt?: string;
  createdAt?: string;
  phone?: string;
}
export interface RoleRecordDTO {
  roleName: string;
  roleLabel: string;
  roleDescription?: string;
  rolePermissions: AclPermissionMap;
  roleScope: 'own' | 'all';
  roleIsBuiltin: boolean;
  bianServiceDomain: string;
  bianControlRecordType: string;
  recordCreatedDateTime?: string;
  recordUpdatedDateTime?: string;
}

// Display-safe saved card returned by GET /customer/me/cards and rendered by the hosted payment
// pages' saved-card selector. Surrogate token + masked PAN only; never the full PAN, CVV or expiry.
export interface SavedCardDisplay {
  paymentCardInstanceReference: string;
  cardToken: string;
  paymentCardMaskedPanDisplay: string;
  paymentCardNetwork?: string;
  paymentCardAlias?: string;
  paymentCardIsPreferred?: boolean;
}

// v27: Encrypted-KYC search (Queryable Encryption showcase). Field registry + tier-shaped results.
export type KycSearchMode = 'substring' | 'prefix' | 'suffix' | 'range' | 'equality';

export interface KycSearchFieldDef {
  key: string;
  label: string;
  mode: KycSearchMode;                     // effective mode (text modes degrade to equality pre-8.2)
  bsonType: 'string' | 'date' | 'int' | 'bool';
  minQueryLength?: number;
  maxQueryLength?: number;
  rangeMin?: number | string;
  rangeMax?: number | string;
  enumValues?: Array<string | boolean>;
}

export interface KycSearchFieldsResponse {
  textSearchEnabled: boolean;
  fields: KycSearchFieldDef[];
  sensitiveResultFields: string[];
}

export interface KycSearchResult {
  customerAgreementInstanceReference: string;
  partyInstanceReference: string;
  customerName: string;
  customerEmailAddress?: string;           // L2 (with token) / auditor only
  customerMobilePhoneNumber?: string;      // L2 (with token) / auditor only
  customerAgreementReference: string;
  customerSegment?: string;
  customerAgreementStatus?: string;
  customerAgreementKycCheck?: Record<string, unknown> | null;
  contactPiiRestricted: boolean;
  sensitive?: {
    customerAgreementResidentialAddress?: unknown;
    governmentIdentificationReference?: unknown;
    customerAgreementRiskNotes?: unknown;
  };
}

export interface KycSearchResponse {
  field: string;
  count: number;
  results: KycSearchResult[];
}

export interface KycSearchBody {
  field: string;
  value?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export const api = {
  acl: {
    effective: (token: string) =>
      apiFetch<EffectivePermissions>('/api/v1/acl/effective', {}, token),
  },

  roles: {
    list: (token: string) =>
      apiFetch<{ roles: RoleRecordDTO[]; catalog: { resources: string[]; actions: string[] } }>('/api/v1/roles', {}, token),
    get: (roleName: string, token: string) =>
      apiFetch<RoleRecordDTO>(`/api/v1/roles/${encodeURIComponent(roleName)}`, {}, token),
    create: (body: Partial<RoleRecordDTO> & { roleName: string; roleLabel: string }, token: string) =>
      apiFetch<RoleRecordDTO>('/api/v1/roles', { method: 'POST', body: JSON.stringify(body) }, token),
    update: (roleName: string, body: Partial<RoleRecordDTO>, token: string) =>
      apiFetch<RoleRecordDTO>(`/api/v1/roles/${encodeURIComponent(roleName)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
    remove: (roleName: string, token: string) =>
      apiFetch<{ deleted: boolean; roleName: string }>(`/api/v1/roles/${encodeURIComponent(roleName)}`, { method: 'DELETE' }, token),
  },

  users: {
    list: (token: string, params?: { domain?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.domain) qs.set('domain', params.domain);
      if (params?.q) qs.set('q', params.q);
      const s = qs.toString();
      return apiFetch<{ users: ManagedUserDTO[] }>(`/api/v1/users${s ? `?${s}` : ''}`, {}, token);
    },
    get: (id: string, token: string) =>
      apiFetch<ManagedUserDTO>(`/api/v1/users/${encodeURIComponent(id)}`, {}, token),
    create: (body: { email: string; name: string; role: string; domain?: string; password: string; status?: 'active' | 'suspended'; phone?: string }, token: string) =>
      apiFetch<ManagedUserDTO>('/api/v1/users', { method: 'POST', body: JSON.stringify(body) }, token),
    update: (id: string, body: { name?: string; role?: string; status?: 'active' | 'suspended' | 'pending'; password?: string; phone?: string }, token: string) =>
      apiFetch<ManagedUserDTO>(`/api/v1/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
    remove: (id: string, token: string) =>
      apiFetch<{ deleted: boolean; id: string }>(`/api/v1/users/${encodeURIComponent(id)}`, { method: 'DELETE' }, token),
  },

  auth: {
    login: (body: { email: string; password: string; domain: string }) =>
      apiFetch<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    // Server-side logout: invalidates all of the caller's session tokens (advances their epoch).
    logout: (token: string) =>
      apiFetch<{ loggedOut: boolean }>('/api/v1/auth/logout', { method: 'POST' }, token),
    users: (filters?: boolean | DemoUserFilters) =>
      apiFetch<{ users: AuthUser[] }>(`/api/v1/auth/users${demoRosterQuery(filters)}`),
    domains: () =>
      apiFetch<{ domains: AuthDomain[] }>('/api/v1/auth/domains'),
    // Public self-registration for local domains that enable it. Role is always `customer`
    // (server-enforced). Returns the resulting status: 'active' (auto-approved) or 'pending'.
    register: (body: { email: string; name: string; password: string; phone?: string; domain?: string }) =>
      apiFetch<{ status: 'active' | 'pending'; message: string }>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
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
        party?: Record<string, unknown> | null;
        agreement: Record<string, unknown> | null;
      }>('/api/v1/auth/me', {}, token),
  },

  notifications: {
    // ADR-031: the user's notifications (read + unread); `count` = unread.
    list: (token: string) =>
      apiFetch<{ count: number; items: NotificationItem[] }>('/api/v1/notifications', {}, token),
    markRead: (id: string, token: string) =>
      apiFetch<{ ok: boolean }>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: JSON.stringify({}) }, token),
    markAllRead: (token: string) =>
      apiFetch<{ updated: number }>('/api/v1/notifications/read-all', { method: 'POST', body: JSON.stringify({}) }, token),
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
        merchantAgreementInstanceReference?: string;
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
    // ADR-031: customer questions on a transaction + immutable answer submission.
    getQuestions: (txnId: string, token: string) =>
      apiFetch<{ questions: CustomerQuestion[] }>(`/api/v1/transactions/${txnId}/questions`, {}, token),
    answerQuestion: (txnId: string, questionId: string, body: { option: string; text?: string }, token: string) =>
      apiFetch<CustomerQuestion>(
        `/api/v1/transactions/${txnId}/questions/${questionId}/response`,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
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
    // v27: encrypted-KYC search. The field registry drives which controls the UI renders;
    // the search runs QE over ciphertext server-side. Sensitive result fields are returned
    // only to L2 (with a valid escalation token) / auditor — the server is the boundary.
    searchFields: (token: string) =>
      apiFetch<KycSearchFieldsResponse>('/api/v1/customer/search/fields', {}, token),
    search: (body: KycSearchBody, token: string, escalationToken?: string) =>
      apiFetch<KycSearchResponse>(
        '/api/v1/customer/search',
        {
          method: 'POST',
          body: JSON.stringify(body),
          ...(escalationToken ? { headers: { 'X-Escalation-Token': escalationToken } } : {}),
        },
        token,
      ),
    getByEmail: (email: string, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer?email=${encodeURIComponent(email)}`, {}, token
      ),
    getByPhone: (phone: string, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer?phone=${encodeURIComponent(phone)}`, {}, token
      ),
    getByAccountRef: (ref: string, token: string, escalationToken?: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer?accountRef=${encodeURIComponent(ref)}`,
        escalationToken ? { headers: { 'X-Escalation-Token': escalationToken } } : {},
        token
      ),

    getById: (id: string, token: string, escalationToken?: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer/by-id/${encodeURIComponent(id)}`,
        escalationToken ? { headers: { 'X-Escalation-Token': escalationToken } } : {},
        token
      ),
    getCards: (customerId: string, token: string) =>
      apiFetch<{ results: Record<string, unknown>[] }>(
        `/api/v1/customer/${encodeURIComponent(customerId)}/cards`, {}, token
      ),
    // The AUTHENTICATED caller's OWN saved cards (display-safe). The agreement is resolved server-side
    // from the token (partyRef) — never a client-supplied id — so a caller only ever sees their own
    // cards. Used by the hosted payment pages to offer a saved-card pick to the signed-in viewer.
    // Display-safe only: surrogate token + masked PAN + network + alias + preferred. No PAN/CVV/expiry.
    getMyCards: (token: string) =>
      apiFetch<{ results: SavedCardDisplay[] }>('/api/v1/customer/me/cards', {}, token),
    addCard: (
      customerId: string,
      body: {
        cardToken: string;
        paymentCardExpirationDate: string;
        paymentCardMaskedPanDisplay: string;
        paymentCardNetwork: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
        paymentCardIsPreferred?: boolean;
        paymentCardAlias?: string;
      },
      token: string
    ) =>
      apiFetch<{ paymentCardInstanceReference: string; paymentCardStatus: string }>(
        `/api/v1/customer/${encodeURIComponent(customerId)}/cards`,
        { method: 'POST', body: JSON.stringify(body) },
        token
      ),
    // Owner self-service card detail: surrogate token, expiry (QE:none), dates, alias/note.
    getCardById: (customerId: string, cardId: string, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(cardId)}`,
        {},
        token
      ),
    // Edit the alias/note; the only mutable attributes of a saved card. Owner-only; audited.
    updateCard: (
      customerId: string,
      cardId: string,
      body: { paymentCardAlias?: string; paymentCardCustomerNote?: string },
      token: string
    ) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(cardId)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        token
      ),
    // Activate / deactivate a saved card. Owner-only; audited. A deactivated card is declined by
    // the PSP on every operation, even if the issuer would approve.
    setCardActive: (customerId: string, cardId: string, active: boolean, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/customer/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(cardId)}/status`,
        { method: 'PATCH', body: JSON.stringify({ active }) },
        token
      ),
    // Remove (soft-delete) a saved card. Owner-only; emits a compliance audit event server-side.
    deleteCard: (customerId: string, cardId: string, token: string) =>
      apiFetch<{ removed: boolean }>(
        `/api/v1/customer/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(cardId)}`,
        { method: 'DELETE' },
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
    // Aggregated case read-model (operation + SDF + HRP + KYC + KYB). Sensitive KYC PII is
    // included only when a valid escalation token is supplied (L2) or for the auditor.
    enrichment: (id: string, token: string, escalationToken?: string) =>
      apiFetch<CaseEnrichment>(
        `/api/v1/fraud/${id}/enrichment`,
        escalationToken ? { headers: { 'X-Escalation-Token': escalationToken } } : {},
        token,
      ),
    // Investigation analytics for L1/L2/auditor dashboards (no PII).
    stats: (token: string) =>
      apiFetch<{
        total: number; open: number; underReview: number; escalated: number; resolvedFraud: number; resolvedCleared: number;
        byStatus: Array<{ status: string; count: number }>;
        bySeverity: Array<{ severity: string; count: number }>;
        byMonth: Array<{ year: number; month: number; count: number }>;
      }>('/api/v1/fraud/stats', {}, token),
    // Auditor data-integrity oversight (PCI DSS Req 10); no PII.
    integrity: (token: string) =>
      apiFetch<{
        totalCases: number;
        duplicateCount: number;
        duplicateReferences: Array<{ reference: string; count: number }>;
        orphanTransactionRefs: number;
        orphanCustomerRefs: number;
        orphanCustomerReferences: Array<{ reference: string; count: number }>;
        healthy: boolean;
        cards?: {
          duplicateArrangementCount: number;
          duplicateArrangements: Array<{ maskedPan: string; count: number }>;
          tokenizationDuplicateCount: number;
          tokenizationDuplicates: Array<{ maskedPan: string; network?: string | null; distinctTokens: number }>;
          registryDriftCount: number;
          registryDrift: Array<{ maskedPan: string; registryCount: number; liveCount: number }>;
          healthy: boolean;
        };
      }>('/api/v1/fraud/integrity', {}, token),
    // Shared-card registry lookup (FDS/AML); investigation roles. Token from a transaction.
    cardRegistry: (cardToken: string, token: string) =>
      apiFetch<{
        paymentCardReference: string;
        paymentCardMaskedPanDisplay: string;
        paymentCardNetwork?: string | null;
        cardHolderCount: number;
        cardHolderAgreementReferences: string[];
        firstRegisteredDateTime?: string;
      }>(`/api/v1/customer/card-registry/${encodeURIComponent(cardToken)}`, {}, token),
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
    // ADR-031: investigator-posed customer questions on a case.
    getQuestions: (caseId: string, token: string) =>
      apiFetch<{ questions: CustomerQuestion[] }>(`/api/v1/fraud/${caseId}/questions`, {}, token),
    createQuestion: (caseId: string, body: { questionText: string; options: string[]; allowOther: boolean }, token: string) =>
      apiFetch<CustomerQuestion>(`/api/v1/fraud/${caseId}/questions`, { method: 'POST', body: JSON.stringify(body) }, token),
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
    users: (filters?: boolean | DemoUserFilters) =>
      apiFetch<{ users: AuthUser[] }>(`/api/v1/system/users${demoRosterQuery(filters)}`),
    rawDocument: (collection: string, id: string, token: string) =>
      apiFetch<RawDocumentResponse>(
        `/api/v1/system/raw/${collection}/${id}`, {}, token
      ),
  },

  health: (detail?: 'server' | 'db' | 'all') =>
    apiFetch<{ status: string; version?: string; serviceId?: string; checks?: Record<string, unknown[]> }>(
      `/api/v1/system/health${detail ? `?detail=${detail}` : ''}`
    ),

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
        merchantDefaultPayoutAccountReference: string;
        merchantCommissionRate: number; // v18 B-08: SD-89 commission rate 0..1
      }>,
      token: string,
    ) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/merchants/${id}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
        token,
      ),
    deactivate: (id: string, token: string, reason?: string) =>
      apiFetch<{ merchantAgreementInstanceReference: string; merchantAgreementStatus: string; merchantDeactivatedDateTime: string }>(
        `/api/v1/merchants/${id}/deactivate`,
        { method: 'POST', body: JSON.stringify({ reason }) },
        token,
      ),
    transactions: (merchantId: string, params: {
      page?: number; limit?: number; status?: string; search?: string;
      txnId?: string; cardToken?: string; dateFrom?: string; dateTo?: string;
    }, token: string) => {
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
          paymentCardReference?: string;
        }>;
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/merchants/${merchantId}/transactions${qs ? `?${qs}` : ''}`, {}, token);
    },
    transactionById: (merchantId: string, txnId: string, token: string) =>
      apiFetch<{
        cardTransactionInstanceReference: string;
        cardTransactionAmount: { amount: number; currency: string };
        cardTransactionDateTime: string;
        cardTransactionStatus: string;
        cardTransactionType?: string;
        cardTransactionChannel?: string;
        cardTransactionInitiationType?: string;
        cardTransactionMerchantName: string;
        cardTransactionMerchantCategoryCode?: string;
        cardTransactionMaskedPanDisplay: string;
        cardTransactionDescription?: string;
        cardTransactionNarrative?: string;
        paymentCardReference?: string;
        merchantAgreementInstanceReference?: string;
      }>(`/api/v1/merchants/${merchantId}/transactions/${txnId}`, {}, token),
    // Acquiring analytics (BIAN Merchant Activity Analysis): totals + breakdowns, no PII.
    stats: (merchantId: string, token: string) =>
      apiFetch<{
        count: number;
        totalAmount: number;
        avgAmount: number;
        byStatus: Array<{ status: string; count: number; amount: number }>;
        byMonth: Array<{ year: number; month: number; count: number; amount: number }>;
        byCurrency: Array<{ currency: string; count: number; amount: number }>;
        // v18 B-06: commission revenue (SD-89) aggregated from paymentExecution fee (SD-65).
        commissionRevenue?: {
          total: number;
          count: number;
          byMonth: Array<{ year: number; month: number; count: number; amount: number }>;
        };
      }>(`/api/v1/merchants/${merchantId}/stats`, {}, token),
    // v18 B-03: merchant activity view — who did what through this merchant (SD-16 audit). Display-safe.
    activity: (
      merchantId: string,
      filters: { user?: string; q?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number },
      token: string,
    ) => {
      const qs = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
      ).toString();
      return apiFetch<{
        events: Array<{
          id: string;
          eventDateTime: string;
          processType: string;
          processAction: string;
          processOutcome: string;
          entityType: string;
          entityId: string;
          clientId?: string;
          actingPartyReference?: string;
          actingUserName?: string;
          actingChannel?: string;
          summary?: Record<string, unknown>;
        }>;
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/merchants/${merchantId}/activity${qs ? `?${qs}` : ''}`, {}, token);
    },
    // v18 B-08: users who authorized this merchant (OAuth consent grants, SD-16). Display-safe.
    authorizations: (
      merchantId: string,
      filters: { q?: string; page?: number; limit?: number },
      token: string,
    ) => {
      const qs = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
      ).toString();
      return apiFetch<{
        authorizations: Array<{
          consentId: string;
          partyAuthenticationInstanceReference: string;
          userName?: string;
          userEmail?: string;
          grantedScopes: string[];
          consentStatus: 'active' | 'revoked';
          consentGrantedAt: string;
          lastUsedAt?: string | null;
        }>;
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/merchants/${merchantId}/authorizations${qs ? `?${qs}` : ''}`, {}, token);
    },
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
    // API key metadata (no secret/hash); id, prefix, label, status, dates.
    listKeys: (merchantId: string, token: string) =>
      apiFetch<{
        keys: Array<{
          keyId: string;
          keyPrefix: string;
          keyLabel: string | null;
          keyStatus: 'active' | 'revoked';
          keyOrigin?: 'generated' | 'imported';
          keyCreatedDateTime: string;
          keyLastUsedDateTime: string | null;
        }>;
      }>(`/api/v1/merchants/${merchantId}/keys`, {}, token),
    generateKey: (merchantId: string, token: string, label?: string) =>
      apiFetch<{ keyId: string; keyPrefix: string; keyLabel?: string | null; merchantApiKey: string }>(
        `/api/v1/merchants/${merchantId}/keys`, { method: 'POST', body: JSON.stringify({ label }) }, token
      ),
    // Register an existing key from the merchant's own system (hashed server-side; never stored plain).
    importKey: (merchantId: string, apiKey: string, token: string, label?: string) =>
      apiFetch<{ keyId: string; keyPrefix: string; keyLabel?: string | null; keyStatus: 'active'; keyOrigin: 'imported' }>(
        `/api/v1/merchants/${merchantId}/keys/import`, { method: 'POST', body: JSON.stringify({ apiKey, label }) }, token
      ),
    // Rename (relabel) a key to identify it more easily. Empty label clears it.
    updateKeyLabel: (merchantId: string, keyId: string, label: string, token: string) =>
      apiFetch<{ keyId: string; keyLabel: string | null }>(
        `/api/v1/merchants/${merchantId}/keys/${keyId}`, { method: 'PATCH', body: JSON.stringify({ label }) }, token
      ),
    revokeKey: (merchantId: string, keyId: string, token: string) =>
      apiFetch<{ revoked: boolean; keyId: string }>(
        `/api/v1/merchants/${merchantId}/keys/${keyId}`, { method: 'DELETE' }, token
      ),
    // v16: OAuth 2.0 client management (SD-89 BQ:Grant)
    getOAuthClient: (merchantId: string, token: string) =>
      apiFetch<MerchantOAuthClient>(`/api/v1/merchants/${merchantId}/oauth-client`, {}, token),
    createOAuthClient: (merchantId: string, token: string, body: {
      redirect_uris: string[];
      grant_types: string[];
      scopes: string[];
      require_pkce?: boolean;
      token_lifetime_seconds?: number;
      refresh_token_lifetime_days?: number;
    }) =>
      apiFetch<{ client: MerchantOAuthClient; oauthClientSecret: string }>(
        `/api/v1/merchants/${merchantId}/oauth-client`,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    updateOAuthClient: (merchantId: string, token: string, patch: {
      redirect_uris?: string[];
      post_logout_redirect_uris?: string[];
      grant_types?: string[];
      scopes?: string[];
      require_pkce?: boolean;
      token_lifetime_seconds?: number;
      refresh_token_lifetime_days?: number;
      claim_mapping?: Record<string, string>;
      logo_uri?: string;    // https URL (or '' to clear); http allowed only for localhost
      client_uri?: string;  // https URL (or '' to clear); http allowed only for localhost
      client_id?: string;     // set a custom client_id (changing it orphans existing tokens/consents)
      client_secret?: string; // set a custom secret (re-hashed; plaintext never returned)
      client_secret_prefix?: string; // independent display label (not derived from the secret)
    }) =>
      apiFetch<MerchantOAuthClient>(
        `/api/v1/merchants/${merchantId}/oauth-client`,
        { method: 'PATCH', body: JSON.stringify(patch) },
        token,
      ),
    rotateOAuthClientSecret: (merchantId: string, token: string) =>
      apiFetch<{ oauthClientId: string; oauthClientSecret: string }>(
        `/api/v1/merchants/${merchantId}/oauth-client/rotate-secret`,
        { method: 'POST' },
        token,
      ),
    revokeOAuthClient: (merchantId: string, token: string) =>
      apiFetch<{ revoked: boolean }>(
        `/api/v1/merchants/${merchantId}/oauth-client`,
        { method: 'DELETE' },
        token,
      ),
    registerWebhook: (merchantId: string, webhookEndpoint: string, token: string) =>
      apiFetch<{ merchantAgreementInstanceReference: string; merchantWebhookEndpoint: string; merchantWebhookSecret?: string }>(
        `/api/v1/merchants/${merchantId}/webhooks`,
        { method: 'POST', body: JSON.stringify({ webhookEndpoint }) },
        token
      ),
    // Send a simulated payment.completed webhook so the merchant can test their endpoint. Optional
    // edited payload + an optional auth header (paste the auth scheme/key the endpoint expects).
    testWebhook: (merchantId: string, token: string, body?: { payload?: Record<string, unknown>; authHeader?: { name: string; value: string } }) =>
      apiFetch<{
        configured: boolean;
        endpoint?: string;
        payload?: Record<string, unknown>;
        requestHeaders?: Record<string, string>;
        signature?: string;
        delivered?: boolean;
        statusCode?: number;
        attempts?: number;
        response?: unknown;
        error?: string;
      }>(`/api/v1/merchants/${merchantId}/webhooks/test`, { method: 'POST', body: JSON.stringify(body ?? {}) }, token),

    // v16: Typed webhook registry (ADR-038) — per-event-type webhooks
    listTypedWebhooks: (merchantId: string, token: string) =>
      apiFetch<{ webhooks: TypedWebhookConfig[] }>(`/api/v1/merchants/${merchantId}/webhooks/registry`, {}, token),
    registerTypedWebhook: (merchantId: string, token: string, body: {
      eventType: WebhookEventType; url: string;
      attributeMapping?: Record<string, string>; headers?: Record<string, string>;
      apiKeyId?: string; apiKeyTransport?: 'header' | 'body'; apiKeyFieldName?: string;
    }) =>
      apiFetch<{ webhook: TypedWebhookConfig; webhookSecret: string }>(
        `/api/v1/merchants/${merchantId}/webhooks/registry`,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    updateTypedWebhook: (merchantId: string, webhookId: string, token: string, patch: {
      url?: string; status?: 'active' | 'inactive';
      attributeMapping?: Record<string, string>; headers?: Record<string, string>;
      apiKeyId?: string | null; apiKeyTransport?: 'header' | 'body'; apiKeyFieldName?: string;
    }) =>
      apiFetch<TypedWebhookConfig>(
        `/api/v1/merchants/${merchantId}/webhooks/registry/${webhookId}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
        token,
      ),
    deleteTypedWebhook: (merchantId: string, webhookId: string, token: string) =>
      apiFetch<{ deleted: boolean; webhookId: string }>(
        `/api/v1/merchants/${merchantId}/webhooks/registry/${webhookId}`,
        { method: 'DELETE' },
        token,
      ),
    testTypedWebhook: (merchantId: string, webhookId: string, token: string, payload?: Record<string, unknown>) =>
      apiFetch<TypedWebhookTestResult>(
        `/api/v1/merchants/${merchantId}/webhooks/registry/${webhookId}/test`,
        { method: 'POST', body: JSON.stringify(payload ? { payload } : {}) },
        token,
      ),
    getTestPayload: (merchantId: string, webhookId: string, token: string) =>
      apiFetch<{ payload: Record<string, unknown> }>(
        `/api/v1/merchants/${merchantId}/webhooks/registry/${webhookId}/test-payload`,
        {},
        token,
      ),
    listDeliveryLogs: (
      merchantId: string,
      token: string,
      filter?: { eventType?: WebhookEventType; deliveryType?: 'live' | 'test'; delivered?: boolean },
      pagination?: { page?: number; limit?: number },
    ) => {
      const params = new URLSearchParams();
      if (filter?.eventType) params.set('eventType', filter.eventType);
      if (filter?.deliveryType) params.set('deliveryType', filter.deliveryType);
      if (filter?.delivered !== undefined) params.set('delivered', String(filter.delivered));
      if (pagination?.page) params.set('page', String(pagination.page));
      if (pagination?.limit) params.set('limit', String(pagination.limit));
      const qs = params.toString();
      return apiFetch<{ logs: WebhookDeliveryLog[]; total: number; page: number; limit: number; totalPages: number }>(
        `/api/v1/merchants/${merchantId}/webhooks/logs${qs ? '?' + qs : ''}`,
        {},
        token,
      );
    },
  },

  // v16: OAuth consent grants (user's authorized apps)
  // Self-scoped "Authorized Applications" (connected apps). All routes resolve the caller's own `sub`.
  consentGrants: {
    // Revoked grants are kept; filter with status (active | revoked | all, default all).
    list: (token: string, status: 'active' | 'revoked' | 'all' = 'all') =>
      apiFetch<{ grants: ConsentGrant[] }>(`/api/v1/auth/grants?status=${status}`, {}, token),
    // v18 D-01: detail of one authorized app (scopes with descriptions, approval date/time, branding).
    getDetail: (consentId: string, token: string) =>
      apiFetch<ConsentGrantDetail>(`/api/v1/auth/grants/${encodeURIComponent(consentId)}`, {}, token),
    // v18 D-02: operations the caller executed through this app (display-safe). Filter + paginate.
    getOperations: (
      consentId: string,
      filters: { q?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number },
      token: string,
    ) => {
      const qs = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
      ).toString();
      return apiFetch<{
        events: Array<{
          id: string;
          eventDateTime: string;
          processType: string;
          processAction: string;
          processOutcome: string;
          entityType: string;
          entityId: string;
          clientId?: string;
          actingPartyReference?: string;
          actingChannel?: string;
          summary?: Record<string, unknown>;
        }>;
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/auth/grants/${encodeURIComponent(consentId)}/operations${qs ? `?${qs}` : ''}`, {}, token);
    },
    revoke: (consentId: string, token: string) =>
      apiFetch<{ revoked: boolean; consentId: string }>(
        `/api/v1/auth/grants/${encodeURIComponent(consentId)}`,
        { method: 'DELETE' },
        token,
      ),
    // Re-approve a previously revoked grant (reverts the revocation; mints no tokens).
    reactivate: (consentId: string, token: string) =>
      apiFetch<{ reactivated: boolean; consentId: string }>(
        `/api/v1/auth/grants/${encodeURIComponent(consentId)}/reactivate`,
        { method: 'POST' },
        token,
      ),
  },

  // passwordless credential management (SD-91/SD-16). Owner-scoped by the session token.
  credentials: {
    list: (token: string) =>
      apiFetch<{ credentials: EnrolledCredential[] }>(`/api/v1/auth/enroll`, {}, token),
    // Step 1 of the registration ceremony: get a challenge to sign with the freshly generated key.
    challenge: (token: string) =>
      apiFetch<{ challenge: string; expiresIn: number }>(
        `/api/v1/auth/enroll/challenge`, { method: 'POST', body: '{}' }, token,
      ),
    // Step 2: register the public key + signed challenge (proof of possession).
    register: (
      body: { challenge: string; publicKeyPem: string; alg: 'RS256' | 'ES256'; signature: string; credentialId?: string; authenticatorMetadata?: { deviceName?: string; createdVia?: string } },
      token: string,
    ) => apiFetch<EnrolledCredential>(`/api/v1/auth/enroll`, { method: 'POST', body: JSON.stringify(body) }, token),
    rotate: (
      credentialId: string,
      body: { challenge: string; publicKeyPem: string; alg: 'RS256' | 'ES256'; signature: string; credentialId?: string; authenticatorMetadata?: { deviceName?: string; createdVia?: string } },
      token: string,
    ) => apiFetch<EnrolledCredential>(
      `/api/v1/auth/enroll/${encodeURIComponent(credentialId)}/rotate`,
      { method: 'POST', body: JSON.stringify(body) }, token,
    ),
    revoke: (credentialId: string, token: string) =>
      apiFetch<{ revoked: boolean; credentialId: string }>(
        `/api/v1/auth/enroll/${encodeURIComponent(credentialId)}`, { method: 'DELETE' }, token,
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
        hasActingUser?: boolean;
      }>(`/api/v1/checkout/sessions/${sessionId}`),
    pay: (sessionId: string, body: { cardToken: string; cardholderName: string; cardExpiryMonth?: string; cardExpiryYear?: string; cardCvv?: string; cardholderEmail?: string; saveCard?: boolean }) =>
      apiFetch<{ success: boolean; declined?: boolean; cardTransactionInstanceReference?: string | null; responseCode?: string; declineReason?: string; redirectUrl?: string | null }>(
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
    pay: (code: string, body: { cardToken: string; cardholderName: string; cardExpiryMonth?: string; cardExpiryYear?: string; cardCvv?: string; customerEmail?: string }) =>
      apiFetch<{ success: boolean; declined?: boolean; cardTransactionInstanceReference?: string | null; fraudDiagnosisInstanceReference?: string | null; responseCode?: string; declineReason?: string }>(
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
      return apiFetch<{ integrations: Record<string, unknown>[] }>(`/api/v1/providers/vendors${qs}`, {}, token);
    },
    get: (id: string, token: string) =>
      apiFetch<{ integration: Record<string, unknown> }>(`/api/v1/providers/vendors/${id}`, {}, token),
    create: (body: Record<string, unknown>, token: string) =>
      apiFetch<{ integration: Record<string, unknown>; apiKey?: string }>(
        '/api/v1/providers/vendors', { method: 'POST', body: JSON.stringify(body) }, token
      ),
    update: (id: string, body: Record<string, unknown>, token: string) =>
      apiFetch<{ integration: Record<string, unknown> }>(
        `/api/v1/providers/vendors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token
      ),
    rotateKey: (id: string, token: string) =>
      apiFetch<{ integration: Record<string, unknown>; apiKey: string }>(
        `/api/v1/providers/vendors/${id}/rotate-key`, { method: 'POST' }, token
      ),
    test: (id: string, token: string) =>
      apiFetch<{ status: string; latencyMs: number }>(`/api/v1/providers/vendors/${id}/test`, { method: 'POST' }, token),
    suspend: (id: string, token: string) =>
      apiFetch<{ integration: Record<string, unknown> }>(`/api/v1/providers/vendors/${id}/suspend`, { method: 'POST' }, token),
    events: (id: string, token: string, page = 1, limit = 20) =>
      apiFetch<{ events: Record<string, unknown>[]; total: number; page: number }>(
        `/api/v1/providers/vendors/${id}/events?page=${page}&limit=${limit}`, {}, token
      ),
    testMapping: (id: string, body: { direction: 'outbound' | 'inbound'; payload: Record<string, unknown> }, token: string) =>
      apiFetch<{ original: Record<string, unknown>; transformed: Record<string, unknown>; appliedRules: number; errors: string[] }>(
        `/api/v1/providers/vendors/${id}/test-mapping`, { method: 'POST', body: JSON.stringify(body) }, token
      ),
    runTest: (id: string, body: { direction: 'outbound' | 'inbound'; payload: Record<string, unknown>; overrideUrl?: string }, token: string) =>
      apiFetch<{
        direction: 'outbound' | 'inbound'; executed: boolean; status: string; latencyMs: number;
        responseCode?: number; responseBody?: unknown; transformed: Record<string, unknown>; appliedRules: number; targetUrl?: string; error?: string;
      }>(`/api/v1/providers/vendors/${id}/run-test`, { method: 'POST', body: JSON.stringify(body) }, token),
    delete: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(
        `/api/v1/providers/vendors/${id}`, { method: 'DELETE' }, token
      ),
  },
  integrationGroups: {
    list: (token: string, params?: { type?: string }) => {
      const qs = params?.type ? `?type=${params.type}` : '';
      return apiFetch<{ groups: Record<string, unknown>[] }>(`/api/v1/providers/groups${qs}`, {}, token);
    },
    get: (id: string, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(`/api/v1/providers/groups/${id}`, {}, token),
    create: (body: { name: string; providerType: string; strategy: string }, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        '/api/v1/providers/groups', { method: 'POST', body: JSON.stringify(body) }, token
      ),
    update: (id: string, body: Record<string, unknown>, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        `/api/v1/providers/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token
      ),
    deleteGroup: (id: string, token: string) =>
      apiFetch<{ deleted: boolean }>(
        `/api/v1/providers/groups/${id}`, { method: 'DELETE' }, token
      ),
    addMember: (groupId: string, body: { providerId: string; priority?: number; weight?: number }, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        `/api/v1/providers/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify(body) }, token
      ),
    removeMember: (groupId: string, providerId: string, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        `/api/v1/providers/groups/${groupId}/members/${providerId}`, { method: 'DELETE' }, token
      ),
    getDefault: (type: string, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(`/api/v1/providers/groups/default/${type}`, {}, token),
    updateStrategy: (groupId: string, strategy: string, token: string) =>
      apiFetch<{ group: Record<string, unknown> }>(
        `/api/v1/providers/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify({ routingGroupStrategy: strategy }) }, token
      ),
  },

  // Internal Modules (ADR-029): engine config + Auth Domains full CRUD.
  modules: {
    getConfig: (capability: string, token: string) =>
      apiFetch<Record<string, unknown>>(`/api/v1/modules/${capability}/config`, {}, token),
    updateConfig: (capability: string, moduleConfig: Record<string, unknown>, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/modules/${capability}/config`, { method: 'PUT', body: JSON.stringify({ moduleConfig }) }, token
      ),
    domains: {
      list: (token: string, params?: { q?: string; page?: number; limit?: number }) => {
        const entries = Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)] as [string, string]);
        const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : '';
        return apiFetch<{ items: Record<string, unknown>[]; total: number; page: number; limit: number }>(`/api/v1/modules/domains${qs}`, {}, token);
      },
      get: (id: string, token: string) =>
        apiFetch<Record<string, unknown>>(`/api/v1/modules/domains/${id}`, {}, token),
      create: (body: Record<string, unknown>, token: string) =>
        apiFetch<Record<string, unknown>>('/api/v1/modules/domains', { method: 'POST', body: JSON.stringify(body) }, token),
      update: (id: string, body: Record<string, unknown>, token: string) =>
        apiFetch<Record<string, unknown>>(`/api/v1/modules/domains/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
      remove: (id: string, token: string) =>
        apiFetch<{ deleted: boolean }>(`/api/v1/modules/domains/${id}`, { method: 'DELETE' }, token),
    },
  },

  // SD-66 Payout Account Arrangement + SD-65 Payment Execution (v17)
  accounts: {
    list: (partyRef: string, token: string, params?: { status?: string; page?: number; limit?: number }) => {
      const qs = params ? '?' + new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
      ).toString() : '';
      return apiFetch<{
        results: Array<{
          payoutAccountInstanceReference: string;
          payoutAccountType: string;
          payoutAccountStatus: string;
          payoutAccountCurrency: string;
          payoutAccountAlias?: string;
          payoutAccountBankName?: string;
          payoutAccountIsDefault: boolean;
          payoutAccountPreferredRail: string;
          payoutAccountBalance?: { availableAmount: number; pendingAmount: number; reservedAmount: number; currency: string };
          recordCreatedDateTime: string;
        }>;
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/accounts/${encodeURIComponent(partyRef)}${qs}`, {}, token);
    },
    setDefault: (partyRef: string, accountRef: string, token: string) =>
      apiFetch<{ payoutAccountInstanceReference: string; payoutAccountIsDefault: boolean }>(
        `/api/v1/accounts/${encodeURIComponent(partyRef)}/${encodeURIComponent(accountRef)}/default`,
        { method: 'POST', body: JSON.stringify({}) },
        token,
      ),
    close: (partyRef: string, accountRef: string, token: string) =>
      apiFetch<{ payoutAccountInstanceReference: string; payoutAccountStatus: string }>(
        `/api/v1/accounts/${encodeURIComponent(partyRef)}/${encodeURIComponent(accountRef)}`,
        { method: 'DELETE' },
        token,
      ),
    get: (partyRef: string, accountRef: string, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/accounts/${encodeURIComponent(partyRef)}/${encodeURIComponent(accountRef)}`,
        {},
        token
      ),
    update: (partyRef: string, accountRef: string, body: { payoutAccountAlias?: string; payoutAccountIsDefault?: boolean }, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/accounts/${encodeURIComponent(partyRef)}/${encodeURIComponent(accountRef)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        token
      ),
    create: (partyRef: string, body: Record<string, unknown>, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/accounts/${encodeURIComponent(partyRef)}`,
        { method: 'POST', body: JSON.stringify(body) },
        token
      ),
    revealIban: (partyRef: string, accountRef: string, token: string) =>
      apiFetch<{ payoutAccountIban: string }>(
        `/api/v1/accounts/${encodeURIComponent(partyRef)}/${encodeURIComponent(accountRef)}/iban`,
        {},
        token
      ),
    cards: (partyRef: string, accountRef: string, token: string) =>
      apiFetch<{ results: Array<{
        paymentCardInstanceReference: string;
        paymentCardMaskedPanDisplay: string;
        paymentCardNetwork: string;
        paymentCardStatus: string;
        paymentCardIsPreferred: boolean;
        paymentCardAlias?: string;
        fundingPayoutAccountInstanceReference?: string;
        recordCreatedDateTime: string;
      }>; total: number }>(
        `/api/v1/accounts/${encodeURIComponent(partyRef)}/${encodeURIComponent(accountRef)}/cards`,
        {},
        token
      ),
    getTransfer: (transferRef: string, token: string) =>
      apiFetch<{
        paymentExecutionInstanceReference: string;
        initiatorPartyReference: string | null;
        initiatorName: string | null;
        beneficiaryPartyReference: string | null;
        sourcePayoutAccountReference: string | null;
        sourceAccountMasked: string | null;
        resolvedPayoutAccountReference: string | null;
        beneficiaryArrangementReference: string | null;
        beneficiaryAlias: string | null;
        beneficiaryName: string | null;
        destinationIban: string | null;
        destinationAccountMasked: string | null;
        destinationCountry: string | null;
        grossAmount: number;
        netAmount: number;
        feeAmount: number;
        currency: string;
        recipientCurrency: string | null;
        recipientAmount: number | null;
        fxRate: number | null;
        paymentExecutionRail: string | null;
        routingNote: string | null;
        paymentExecutionStatus: string;
        fraudCaseCreated: boolean | null;
        fraudDiagnosisInstanceReference: string | null;
        initiatedAt: string | null;
        completedAt: string | null;
        fraudCase: {
          fraudDiagnosisInstanceReference: string;
          fraudDiagnosisCaseReference: string;
          fraudDiagnosisCaseStatus: string;
          fraudDiagnosisCaseSeverity: string;
          fraudDiagnosisScore: number | null;
          riskIndicators: string[];
          subsystemSignals: Record<string, unknown> | null;
        } | null;
      }>(
        `/api/v1/accounts/transfer/${encodeURIComponent(transferRef)}`,
        {},
        token
      ),
    transfers: (partyRef: string, token: string, params?: { page?: number; limit?: number }) => {
      const qs = params ? '?' + new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
      ).toString() : '';
      return apiFetch<{
        results: Array<{
          paymentExecutionInstanceReference: string;
          initiatorPartyReference: string | null;
          beneficiaryPartyReference: string | null;
          resolvedPayoutAccountReference: string | null;
          grossAmount: number;
          netAmount: number;
          feeAmount: number;
          currency: string;
          paymentExecutionRail: string | null;
          routingNote: string | null;
          paymentExecutionRemittanceInformation: string | null;
          paymentExecutionStatus: string;
          direction: 'sent' | 'received';
          initiatedAt: string | null;
          completedAt: string | null;
        }>;
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/accounts/${encodeURIComponent(partyRef)}/transfers${qs}`, {}, token);
    },
    movements: (partyRef: string, accountRef: string, token: string, params?: { type?: string; direction?: string; from?: string; to?: string; page?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.type) qs.set('type', params.type);
      if (params?.direction) qs.set('direction', params.direction);
      if (params?.from) qs.set('from', params.from);
      if (params?.to) qs.set('to', params.to);
      if (params?.page) qs.set('page', String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      const q = qs.toString();
      return apiFetch<{ movements: Record<string, unknown>[]; total: number }>(
        `/api/v1/accounts/${encodeURIComponent(partyRef)}/${encodeURIComponent(accountRef)}/movements${q ? `?${q}` : ''}`,
        {},
        token
      );
    },
  },

  // SD-54 Counterparty Administration — staff-facing beneficiary registry (v18)
  beneficiaries: {
    list: (
      token: string,
      params?: { ownerRef?: string; q?: string; status?: 'active' | 'removed'; page?: number; limit?: number },
    ) => {
      const qs = params
        ? '?' + new URLSearchParams(
            Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
          ).toString()
        : '';
      return apiFetch<{
        results: Array<{
          counterpartyArrangementReference: string;
          ownerPartyReference: string;
          counterpartyPartyReference: string;
          counterpartyLabel: string;
          counterpartyLookupType: 'phone' | 'email';
          counterpartyLookupHint: string;
          counterpartyArrangementStatus: 'active' | 'removed';
          recordCreatedDateTime: string;
          recordUpdatedDateTime: string;
        }>;
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/beneficiaries${qs}`, {}, token);
    },
    get: (beneficiaryRef: string, token: string) =>
      apiFetch<{
        counterpartyArrangementReference: string;
        ownerPartyReference: string;
        counterpartyPartyReference: string;
        counterpartyLabel: string;
        counterpartyLookupType: 'phone' | 'email';
        counterpartyLookupHint: string;
        counterpartyArrangementStatus: 'active' | 'removed';
        bianServiceDomain: string;
        bianControlRecordType: string;
        recordCreatedDateTime: string;
        recordUpdatedDateTime: string;
        schemaVersion: number;
      }>(`/api/v1/beneficiaries/by-ref/${encodeURIComponent(beneficiaryRef)}`, {}, token),
    updateLabel: (ownerRef: string, beneficiaryRef: string, counterpartyLabel: string, token: string) =>
      apiFetch<Record<string, unknown>>(
        `/api/v1/beneficiaries/${encodeURIComponent(ownerRef)}/${encodeURIComponent(beneficiaryRef)}`,
        { method: 'PATCH', body: JSON.stringify({ counterpartyLabel }) },
        token,
      ),
    add: (
      ownerRef: string,
      body: { lookupType: 'phone' | 'email'; lookupValue: string; label?: string },
      token: string,
    ) =>
      apiFetch<{ found: boolean; counterpartyArrangementReference?: string; counterpartyLabel?: string; counterpartyLookupHint?: string }>(
        `/api/v1/beneficiaries/${encodeURIComponent(ownerRef)}`,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    remove: (ownerRef: string, beneficiaryRef: string, token: string) =>
      apiFetch<{ counterpartyArrangementReference: string; counterpartyArrangementStatus: string }>(
        `/api/v1/beneficiaries/${encodeURIComponent(ownerRef)}/${encodeURIComponent(beneficiaryRef)}`,
        { method: 'DELETE' },
        token,
      ),
    transfer: (
      ownerRef: string,
      beneficiaryRef: string,
      body: { fromAccountRef: string; amount: number; note?: string },
      token: string,
    ) =>
      apiFetch<{ transferReference: string; amount: number; currency: string; status: string; failureReason?: string; recipientHint?: string }>(
        `/api/v1/beneficiaries/${encodeURIComponent(ownerRef)}/${encodeURIComponent(beneficiaryRef)}/transfer`,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
  },

  // v17.1: bank transfers (ACH / SEPA / SWIFT) — rail engine preview + execute.
  transfers: {
    preview: (
      body: { destination: BankDestination; amountCurrency?: string; rail?: string },
      token: string,
    ) =>
      apiFetch<{ ok: boolean; rail?: string; feeAmount?: number; feeCurrency?: string; errors: string[] }>(
        `/api/v1/gateway/transfers/preview`,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    bank: (
      body: { amount: number; currency: string; destination: BankDestination; rail?: string; reference?: string; settlementSchedule?: string },
      token: string,
      idempotencyKey?: string,
    ) =>
      apiFetch<{ executionReference: string; status: string; rail?: string; feeAmount?: number; currency: string; errors?: string[] }>(
        `/api/v1/gateway/transfers/bank`,
        { method: 'POST', body: JSON.stringify(body), headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined },
        token,
      ),
    status: (ref: string, token: string) =>
      apiFetch<{ executionReference: string; status: string; rail?: string; grossAmount: number; feeAmount: number; currency: string; failureReason?: string; completedAt?: string }>(
        `/api/v1/gateway/transfers/${encodeURIComponent(ref)}/status`,
        {},
        token,
      ),
    createMandate: (
      body: { scheme: string; amount: number; currency: string; destination: BankDestination; frequency: string; reference?: string; maxRuns?: number },
      token: string,
    ) =>
      apiFetch<{ recurringMandateInstanceReference: string; mandateReference: string; scheme: string; frequency: string; nextRunAt: string }>(
        `/api/v1/gateway/transfers/mandates`,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
  },

  executions: {
    list: (token: string, params?: { status?: string; page?: number; limit?: number }) => {
      const qs = params ? '?' + new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
      ).toString() : '';
      return apiFetch<{
        results: Array<{
          paymentExecutionInstanceReference: string;
          paymentExecutionStatus: string;
          grossAmount: number;
          netAmount: number;
          currency: string;
          beneficiaryType: string;
          resolvedPayoutAccountReference?: string;
          cardTransactionInstanceReference?: string;
          paymentExecutionRail?: string;
          recordCreatedDateTime: string;
        }>;
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/executions${qs}`, {}, token);
    },
    getById: (executionRef: string, token: string) =>
      apiFetch<Record<string, unknown>>(`/api/v1/executions/${encodeURIComponent(executionRef)}`, {}, token),
  },

  processEvents: {
    // Unified audit stream: business + compliance + integration events.
    audit: (token: string, params?: { source?: string; type?: string; entityType?: string; outcome?: string; q?: string; ref?: string; minScore?: number; from?: string; to?: string; page?: number; limit?: number }) => {
      const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
      return apiFetch<{
        events: Array<{ id: string; source: string; eventDateTime: string; type: string; action: string; outcome: string; entityType?: string; entityId?: string; performedByRole?: string | null; bianServiceDomain?: string; context?: string; summary?: Record<string, unknown> }>;
        total: number; page: number; limit: number; capped: boolean;
      }>(`/api/v1/events/audit${qs}`, {}, token);
    },
    // dev.v8: correlated journey — every DomainEvent for one business-process instance, in order.
    trail: (correlationId: string, token: string) =>
      apiFetch<{ correlationId: string; count: number; events: Array<{ eventId: string; eventType: string; occurredAt: string; correlationId: string; causationId?: string; businessProcess: string; source: string; payload: Record<string, unknown>; bian?: { serviceDomain: string; controlRecord: string } }> }>(
        `/api/v1/events/trail/${encodeURIComponent(correlationId)}`, {}, token,
      ),
    list: (token: string, params?: { processType?: string; entityType?: string; from?: string; to?: string; page?: number; limit?: number }) => {
      const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
      return apiFetch<{ events: Record<string, unknown>[]; total: number; page: number; limit: number }>(
        `/api/v1/events/process${qs}`, {}, token
      );
    },
    getByEntity: (entityType: string, entityId: string, token: string, params?: { page?: number; limit?: number }) => {
      const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
      return apiFetch<{ events: Record<string, unknown>[]; total: number; page: number; limit: number }>(
        `/api/v1/events/process/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}${qs}`, {}, token
      );
    },
    listCompliance: (token: string, params?: { processType?: string; entityType?: string; from?: string; to?: string; page?: number; limit?: number }) => {
      const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
      return apiFetch<{ events: Record<string, unknown>[]; total: number; page: number; limit: number }>(
        `/api/v1/events/compliance${qs}`, {}, token
      );
    },
    getComplianceByEntity: (entityType: string, entityId: string, token: string, params?: { page?: number; limit?: number }) => {
      const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
      return apiFetch<{ events: Record<string, unknown>[]; total: number; page: number; limit: number }>(
        `/api/v1/events/compliance/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}${qs}`, {}, token
      );
    },
  },
};

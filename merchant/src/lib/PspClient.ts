// Single server-only client for the Leafy Pay PSP API (DRY, OOP).
// - Attaches the Bearer access token from the session.
// - On 401, transparently refreshes once and retries.
// - Throws PspError so callers (pages) can degrade gracefully (E-12).
import 'server-only';
import { discover, refreshTokens, clientCredentialsToken } from './oauth';
import { ENV } from './env';
import { getSession, setSession, Session } from './session';

export class PspError extends Error {
  constructor(public status: number, public body: unknown, msg?: string) {
    super(msg ?? `PSP request failed: ${status}`);
    this.name = 'PspError';
  }
  get isAuth() {
    return this.status === 401 || this.status === 403;
  }
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Extra query params. */
  query?: Record<string, string | number | undefined>;
}

export class PspClient {
  private constructor(private session: Session) {}

  /** Build a client from the current request's session, or null if not logged in. */
  static async fromSession(): Promise<PspClient | null> {
    const session = await getSession();
    return session ? new PspClient(session) : null;
  }

  get sub() {
    return this.session.sub;
  }
  get grantedScopes() {
    return this.session.grantedScopes;
  }
  hasScope(scope: string) {
    return this.session.grantedScopes.includes(scope);
  }

  // ── Low-level request with refresh-on-401 ─────────────────────────────────────
  private async ensureFreshToken(): Promise<void> {
    if (Date.now() < this.session.expiresAt - 5000) return; // still valid
    await this.doRefresh();
  }

  private async doRefresh(): Promise<void> {
    if (!this.session.refreshToken) return;
    try {
      const t = await refreshTokens(this.session.refreshToken);
      this.session = {
        ...this.session,
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? this.session.refreshToken,
        grantedScopes: t.scope ? t.scope.split(' ').filter(Boolean) : this.session.grantedScopes,
        expiresAt: Date.now() + t.expires_in * 1000,
      };
      // Persist rotated tokens. Only possible in a route handler / server action;
      // in an RSC render this throws and is safely ignored (token still used for this request).
      try {
        await setSession(this.session);
      } catch {
        /* RSC render cannot mutate cookies — non-fatal */
      }
    } catch {
      /* refresh failed → next request will surface 401 and the user re-logs in */
    }
  }

  private async request<T>(path: string, opts: RequestOpts = {}, retried = false): Promise<T> {
    await this.ensureFreshToken();
    const cfg = await discover();
    const base = ENV.pspBaseUrl();
    const url = new URL(`${base}${path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    void cfg;

    const res = await fetch(url.toString(), {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.session.accessToken}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });

    if (res.status === 401 && !retried && this.session.refreshToken) {
      await this.doRefresh();
      return this.request<T>(path, opts, true);
    }

    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) throw new PspError(res.status, data, (data as any)?.error_description ?? (data as any)?.error);
    return data as T;
  }

  // ── OIDC / identity ───────────────────────────────────────────────────────────
  userinfo() {
    return this.request<{ sub: string; name?: string; preferred_username?: string; email?: string }>(
      '/api/v1/auth/userinfo',
    );
  }

  // ── Products: payment methods ───────────────────────────────────────────────
  createPaymentLink(input: {
    merchantAgreementInstanceReference: string;
    amount: number;
    currency: string;
    description: string;
    usageType?: 'single_use' | 'multi_use';
  }) {
    return this.request<{ paymentLinkInstanceReference: string; paymentLinkCode: string; paymentUrl: string }>(
      '/api/v1/payment/links',
      { method: 'POST', body: { usageType: 'single_use', ...input } },
    );
  }

  createCheckoutSession(input: {
    merchantAgreementInstanceReference: string;
    amount: number;
    currency: string;
    description: string;
    returnUrl: string;
    cancelUrl: string;
    merchantReference: string;
  }) {
    return this.request<{ checkoutSessionInstanceReference: string; paymentPageUrl: string; expiresAt: string }>(
      '/api/v1/checkout/sessions',
      { method: 'POST', body: input },
    );
  }

  // API payment — SERVER-TO-SERVER merchant charge (Item 2). Uses the merchant's OWN client_credentials
  // machine token (scope write:payments), NOT the logged-in user's session/authorization_code token. No
  // CHD in the merchant: the PSP charges a tokenised card and returns the order + card-transaction ref.
  // Static because it needs no user session — it is the merchant's own identity.
  static async apiPaymentServerToServer(
    input: { paymentOrderMerchantReference: string; amount: number; currency: string; paymentOrderDescription?: string; actingSubjectReference?: string },
    idempotencyKey: string,
  ): Promise<{ paymentOrderInstanceReference: string; paymentOrderReference: string; paymentOrderStatus: string; cardTransactionInstanceReference?: string }> {
    const token = await clientCredentialsToken('write:payments');
    const base = ENV.pspBaseUrl();
    const res = await fetch(`${base}/api/v1/gateway/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(input),
      cache: 'no-store',
    });
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) throw new PspError(res.status, data, (data as any)?.error_description ?? (data as any)?.error);
    return data as { paymentOrderInstanceReference: string; paymentOrderReference: string; paymentOrderStatus: string; cardTransactionInstanceReference?: string };
  }

  // ── Beneficiaries (OAuth on-behalf-of; sub-binding token.sub === partyRef) ─────
  listBeneficiaries(page = 1, limit = 20) {
    return this.request<{ results: any[]; total: number; page: number; limit: number }>(
      `/api/v1/merchant/beneficiaries/${encodeURIComponent(this.sub)}`,
      { query: { page, limit } },
    );
  }

  payBeneficiary(input: {
    amount: number;
    currency: string;
    destination: Record<string, unknown>;
    rail?: string;
    reference?: string;
  }) {
    // Money movement to a beneficiary/external account = bank transfer (SD-65).
    return this.bankTransfer(input);
  }

  removeBeneficiary(beneficiaryToken: string) {
    return this.request(
      `/api/v1/merchant/beneficiaries/${encodeURIComponent(this.sub)}/${encodeURIComponent(beneficiaryToken)}`,
      { method: 'DELETE' },
    );
  }

  // ── Bank transfers (ACH / SEPA / SWIFT) — merchant OAuth on-behalf-of (write:transfers) ──
  previewTransfer(input: { destination: Record<string, unknown>; amountCurrency?: { amount: number; currency: string }; rail?: string }) {
    return this.request(`/api/v1/merchant/transfers/${encodeURIComponent(this.sub)}/preview`, { method: 'POST', body: input });
  }

  bankTransfer(input: { amount: number; currency: string; destination: Record<string, unknown>; rail?: string; reference?: string; settlementSchedule?: string }) {
    return this.request(`/api/v1/merchant/transfers/${encodeURIComponent(this.sub)}/bank`, { method: 'POST', body: input });
  }

  // ── Accounts (masked IBAN only; GDPR/PSD2 minimisation) — merchant OAuth (read:accounts) ──
  listAccounts(page = 1, limit = 20) {
    return this.request<{ results: any[]; total: number; page: number; limit: number }>(
      `/api/v1/merchant/accounts/${encodeURIComponent(this.sub)}`,
      { query: { page, limit } },
    );
  }

  // ── History (payment executions for this party) — merchant OAuth (read:transactions) ──
  listHistory(page = 1, limit = 20) {
    return this.request<{ results: any[]; total: number; page: number; limit: number }>(
      `/api/v1/merchant/transactions/${encodeURIComponent(this.sub)}`,
      { query: { page, limit } },
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

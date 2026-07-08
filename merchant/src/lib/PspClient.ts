// Single server-only client for the Leafy Pay PSP API (DRY, OOP).
// - Attaches the Bearer access token from the session.
// - On 401, transparently refreshes once and retries.
// - Throws PspError so callers (pages) can degrade gracefully (E-12).
import 'server-only';
import { discover } from './oauth';
import { ENV } from './env';
import { getSession, setSession, Session } from './session';
import { getFreshUserToken, peekToken, primeToken, getClientCredentialsToken } from './tokenCache';

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
  // `canPersist` gates writing the session cookie. It is FALSE on the render/read
  // path (Server Components), where cookie writes are illegal. If a write ever
  // leaked a Set-Cookie onto a document/RSC response, it would invalidate the Next.js
  // client router cache and drive an infinite /history refetch loop. Only mutating
  // contexts (server actions / route handlers) may persist a rotated token.
  private constructor(private session: Session, private canPersist = false) {}

  /**
   * Build a client for the render/read path (Server Components). NEVER persists the
   * session cookie. The current access token is used as-is (refreshed in memory only).
   */
  static async fromSession(): Promise<PspClient | null> {
    const session = await getSession();
    return session ? new PspClient(session, false) : null;
  }

  /**
   * Build a client for a mutating context (server action / route handler) where
   * writing the session cookie is legal, so a rotated refresh token can be persisted.
   */
  static async fromSessionForMutation(): Promise<PspClient | null> {
    const session = await getSession();
    return session ? new PspClient(session, true) : null;
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
    // 1. Cookie token still comfortably valid → use it as-is (and seed the process cache
    //    so concurrent/subsequent renders can reuse it without hitting the PSP).
    if (Date.now() < this.session.expiresAt - 5000) {
      if (this.session.refreshToken) {
        primeToken(this.session.sub, {
          accessToken: this.session.accessToken,
          refreshToken: this.session.refreshToken,
          grantedScopes: this.session.grantedScopes,
          expiresAt: this.session.expiresAt,
        });
      }
      return;
    }
    // 2. A newer token may already be cached in this process (refreshed by an earlier
    //    render that could not persist the cookie). Adopt it instead of refreshing again.
    const cached = peekToken(this.session.sub);
    if (cached) {
      this.adoptToken(cached);
      return;
    }
    // 3. Otherwise refresh, coalescing concurrent refreshes into one POST /auth/token.
    await this.doRefresh();
  }

  private adoptToken(t: { accessToken: string; refreshToken: string; grantedScopes: string[]; expiresAt: number }): void {
    this.session = {
      ...this.session,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      grantedScopes: t.grantedScopes,
      expiresAt: t.expiresAt,
    };
  }

  private async doRefresh(): Promise<void> {
    if (!this.session.refreshToken) return;
    try {
      // Single-flight, process-cached refresh: N concurrent callers share one token call,
      // and the refreshed token is reused across renders/requests within its TTL.
      const t = await getFreshUserToken(this.session.sub, this.session.refreshToken, this.session.grantedScopes);
      this.adoptToken(t);
      // Persist rotated tokens ONLY in a mutating context (server action / route
      // handler). On the render/read path we never write the cookie: a Set-Cookie
      // on a GET document/RSC response invalidates the Next.js router cache and can
      // trigger an infinite refetch loop. The refreshed token is still used in memory
      // (and via the process cache) for this request either way.
      if (this.canPersist) {
        try {
          await setSession(this.session);
        } catch {
          /* cookie mutation not available in this context (non-fatal) */
        }
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
    const accessToken = await getClientCredentialsToken('write:payments');
    const base = ENV.pspBaseUrl();
    const res = await fetch(`${base}/api/v1/gateway/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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

  // Add (register) a beneficiary by resolving a phone/email to a saved payee (SD-54). The merchant
  // never learns the recipient's identity — the PSP resolves it server-side and returns an opaque
  // token. Anti-enumeration: the PSP returns { found: false } for a non-existent/duplicate contact.
  addBeneficiary(lookupType: 'phone' | 'email', lookupValue: string, label?: string) {
    return this.request<{ found: boolean; counterpartyArrangementReference?: string; counterpartyLabel?: string; counterpartyLookupHint?: string }>(
      `/api/v1/merchant/beneficiaries/${encodeURIComponent(this.sub)}/lookup`,
      { method: 'POST', body: { lookupType, lookupValue, ...(label ? { label } : {}) } },
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

  // Send money to a saved beneficiary (P2P transfer, SD-65). The merchant sends only the amount,
  // opaque beneficiary token, an optional chosen source account reference and an optional description;
  // the PSP resolves the recipient (and the default source account, if none chosen) server-side.
  sendToBeneficiary(beneficiaryToken: string, amount: number, currency?: string, fromAccountRef?: string, note?: string) {
    return this.request<{ transferReference: string; amount: number; currency: string; status: string; failureReason?: string }>(
      `/api/v1/merchant/beneficiaries/${encodeURIComponent(this.sub)}/${encodeURIComponent(beneficiaryToken)}/send`,
      { method: 'POST', body: { amount, ...(currency ? { currency } : {}), ...(fromAccountRef ? { fromAccountRef } : {}), ...(note ? { note } : {}) } },
    );
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

  bankTransfer(input: { amount: number; currency: string; destination: Record<string, unknown>; rail?: string; reference?: string; fromAccountRef?: string; settlementSchedule?: string }) {
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

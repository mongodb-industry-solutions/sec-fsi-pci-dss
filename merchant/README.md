# Leafy Merchant Demo — Espresso Works Ltd

An **autonomous** Next.js (App Router) demo storefront for *Espresso Works Ltd* that integrates
with the **Securit4 Pay PSP** purely via **OAuth2 / OIDC SSO + REST API**. It has **no database** and
shares no code with the PSP `backend/`/`frontend/` — it is an external system, deployed separately.

## Architecture

- **Confidential OAuth client.** The `client_secret` and tokens live **only server-side** (Next.js
  route handlers / server components). The browser never sees the Bearer token.
- **Stateless encrypted session.** Tokens are stored in an AES-256-GCM encrypted, httpOnly cookie
  (`src/lib/session.ts`) — no server-side session store, no DB.
- **Single `PspClient`.** All PSP API calls go through `src/lib/PspClient.ts` (attaches Bearer,
  refreshes on 401). Pages never call the PSP directly.
- **Graceful degradation.** Consent is granular (PSP Fase E): the app reads the *real*
  `grantedScopes` from the session and hides features the user did not grant (e.g. balance).

## Ports

| App | Local dev | Container | Host mapping |
|---|---|---|---|
| Merchant (this app) | **8082** | 8080 | `8082:8080` |
| PSP backend (API + OIDC) | 8081 | 8080 | `8081:8080` |
| PSP frontend (consent UI) | 8080 | 8080 | `8080:8080` |

Local dev runs on **8082**; inside Docker the container listens on **8080** (same convention as the
PSP `frontend/`), and docker-compose maps host `8082:8080`. The port is env-driven via
`PSP_MERCHANT_PORT`. The seeded OAuth redirect URI is `http://localhost:8082/api/auth/callback`
(plus staging/prod HTTPS URIs).

## Seeded demo credentials (from the PSP seeder)

| Field | Value |
|---|---|
| client_id | `oauth001-0000-4000-8000-000000000001` |
| client_secret | `espresso-demo-secret-2026` |
| redirect_uri | `http://localhost:8082/api/auth/callback` |
| scopes (user SSO) | `openid profile read:beneficiaries write:beneficiaries read:transactions read:accounts read:merchant_profile read:notifications write:transfers` |
| grant types | `authorization_code`, `refresh_token` (user SSO) + `client_credentials` (server-to-server API payment) |
| machine scope | `write:payments` (client_credentials only — never on the user consent page) |
| PKCE | S256 required (authorization_code) |

The **same** confidential client is reused for the server-to-server **API payment**: the merchant app
fetches a `client_credentials` token (scope `write:payments`) server-side and calls `POST /gateway/payments`.
This is NOT the user's session/`authorization_code` token — it is the merchant's own machine identity. The
`client_secret` stays server-only (never `NEXT_PUBLIC_`).

Log in on the PSP consent page with a seeded Espresso Works user (owner: `luis.fernandez@back.es`).

## Run

```bash
cp env.example .env.local    # then set PSP_MERCHANT_SESSION_SECRET
npm install
npm run dev                  # http://localhost:8082
```

Requires the PSP backend (8081) + frontend (8080) running with a reseeded DB.
From the repo root, `npm run dev` now starts backend + frontend + merchant together.

> Env file note: this repo's sandbox blocks writing dotfiles named `.env*`, so the template
> ships as `env.example`. Copy it to `.env.local` yourself.

## Global .env additions (repo root)

The merchant reads `PSP_MERCHANT_*` vars. The docker-compose `merchant` service pulls them from
the repo-root `.env` (falling back to sane defaults). The root `.env` was write-protected in this
sandbox, so add the following block **manually** to the repo-root `.env`:

```env
# ── Merchant demo (Espresso Works) ──────────────────────────────────────────
PSP_MERCHANT_BASE_URL=http://localhost:8082
PSP_MERCHANT_PORT=8082
PSP_MERCHANT_PSP_BASE_URL=http://localhost:8081
PSP_MERCHANT_AUTHORIZE_URL=http://localhost:8080/auth/authorize
PSP_MERCHANT_OAUTH_CLIENT_ID=oauth001-0000-4000-8000-000000000001
PSP_MERCHANT_OAUTH_CLIENT_SECRET=espresso-demo-secret-2026
PSP_MERCHANT_SESSION_SECRET=change-me-to-a-32-byte-random-secret-value
```

## The 4 demo products (one per payment method)

| Product | Method | PSP API |
|---|---|---|
| Espresso Beans 1kg | Payment Link | `POST /payment/links` |
| Espresso Machine | Redirect (hosted checkout) | `POST /checkout/sessions` |
| Barista Course | API Payment — server-to-server, `client_credentials` + `write:payments` (token vault, no CHD) | `POST /gateway/payments` |
| Coffee Subscription | Redirect (subscription) | `POST /checkout/sessions` |

The merchant **never** handles PAN/CVV (PCI DSS SAQ A). API payments use a test token, never card data.

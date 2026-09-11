/**
 * Shared E2E helpers: JWT minting + role injection via the `demo_token` cookie.
 *
 * The app reads auth from the `demo_token` cookie (see frontend/src/lib/auth.ts
 * `getToken`), NOT localStorage, so role injection MUST use cookies. The JWT is
 * only base64-decoded client-side (`decodeToken`), never signature-verified in the
 * frontend, so a fake signature is fine for E2E.
 *
 * This file is under e2e/support and does not match `*.spec.ts`, so Playwright
 * never runs it as a test.
 */
import { BrowserContext } from '@playwright/test';

export type DemoRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'merchant_officer'
  | 'operations_officer'
  | 'manager';

const ROLE_USER: Record<DemoRole, { sub: string; email: string; name: string }> = {
  customer:            { sub: 'u-cust-001', email: 'luis.fernandez@back.es', name: 'Luis Fernandez' },
  level1_analyst:      { sub: 'u-l1-001',   email: 'sarah.chen@back.es',     name: 'Sarah Chen' },
  level2_investigator: { sub: 'u-l2-001',   email: 'michael.obi@back.es',    name: 'Michael Obi' },
  security_auditor:    { sub: 'u-aud-001',  email: 'admin@back.es',          name: 'Audit User' },
  merchant_officer:    { sub: 'u-mo-001',   email: 'olivia.park@back.es',    name: 'Olivia Park' },
  operations_officer:  { sub: 'u-ops-001',  email: 'nina.torres@back.es',    name: 'Nina Torres' },
  manager:             { sub: 'u-mgr-001',  email: 'alex.rivera@back.es',    name: 'Alex Rivera' },
};

export function mintJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat: now, exp: now + 86400, domain: 'leafypay', ...payload })}.fake-signature`;
}

/**
 * Mint a JWT for a known demo role. `extra` overrides/augments claims (e.g. partyRef).
 *
 * The claim is `roles`, an ARRAY, because that is what the authority issues and what the app reads:
 * `decodeToken` collapses `roles[0]` into the single `role` the screens use. This used to mint the
 * singular `role`, which decoded to an empty string and left every role dashboard unable to tell
 * who was looking at it.
 */
export function roleJwt(role: DemoRole, extra: Record<string, unknown> = {}): string {
  return mintJwt({ roles: [role], ...ROLE_USER[role], ...extra });
}

/**
 * Inject a signed-in session, as BOTH cookies, the way the real callback leaves it.
 *
 * Two cookies because OIDC separates two questions, and the app reads them separately:
 * `demo_token` is the access token, which carries authority (`roles`, `account_holder`), and
 * `demo_identity` is the id token, which carries who the person is (`name`, `email`).
 *
 * Setting only the access token is not a smaller version of signing in, it is a different state.
 * Profile claims do not belong in an access token, so `decodeToken` does not look for them there,
 * and a session missing the id token renders every greeting and user menu as the raw email address.
 */
export async function loginAs(context: BrowserContext, role: DemoRole, extra: Record<string, unknown> = {}) {
  const user = ROLE_USER[role];
  const expires = Math.floor(Date.now() / 1000) + 86400;
  const cookie = (name: string, value: string) => ({
    name, value, domain: 'localhost', path: '/', expires,
  });

  await context.addCookies([
    cookie('demo_token', roleJwt(role, extra)),
    cookie('demo_identity', mintJwt({
      sub: user.sub,
      name: user.name,
      preferred_username: user.name,
      email: user.email,
    })),
  ]);
}

/** Standard JSON fulfill helper for page.route handlers. */
export function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/**
 * Stub GET /api/v1/acl/effective (ADR-030). Pages/sections gated by
 * <RequirePermission> and useEffectivePermissions read the caller's permissions
 * from this endpoint (never from the JWT), so E2E must provide them explicitly.
 * `permissions` is a resource → actions map, e.g. { transactions: ['view'] }.
 */
export async function stubPermissions(
  page: import('@playwright/test').Page,
  permissions: Record<string, string[]>,
  role = 'analyst',
) {
  await page.route('**/api/v1/acl/effective', (r) => r.fulfill(json({
    role,
    label: role,
    description: null,
    scope: 'all',
    isBuiltin: true,
    bianServiceDomain: null,
    permissions,
    catalog: { resources: Object.keys(permissions), actions: ['view', 'viewSensitive', 'manage', 'investigate'] },
  })));
}

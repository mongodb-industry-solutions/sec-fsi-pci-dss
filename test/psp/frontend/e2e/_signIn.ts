/**
 * Signing in for real, the way a person does it now.
 *
 * This exists because the suite was written when the console collected the password itself. It does
 * not any more, and cannot: `/api/auth/login` is GET only and starts an authorization code flow
 * with PKCE, because a credential is entered at the authority and never here. A spec that POSTs
 * credentials to this app is asserting a capability the app deliberately gave up.
 *
 * So the helper drives the whole redirect: this app, to the authority's sign-in page, back with a
 * code, which the callback exchanges and turns into the session cookies. Nothing is stubbed. The
 * point of an unmocked sweep is to catch a page that renders against a stub and is blank against
 * the real system, and a stubbed sign-in would be the one hole in exactly the wall being tested.
 *
 * Not named `*.spec.ts` on purpose, so Playwright's matcher never collects it as a suite.
 */
import { expect, Page, BrowserContext } from '@playwright/test';

/** The browser-facing authority. A different origin from the app, which is the whole design. */
export const AUTHORITY_UI = process.env.PSP_GIAM_UI_URL ?? 'http://localhost:8086';
export const APP = process.env.BASE_URL ?? 'http://localhost:8080';

export interface Persona {
  login: string;
  password: string;
}

/** The operator the sweep runs as. Held in one place so a seed change lands in one place. */
export const DEFAULT_PERSONA: Persona = {
  login: 'alex.rivera@back.es',
  password: 'demo-password',
};

/**
 * Completes an interactive sign-in and leaves `context` holding a real session.
 *
 * Returns the access token, because the sweep asserts against it and because a helper that only
 * says "it worked" cannot show WHAT it signed in as.
 */
export async function signIn(page: Page, persona: Persona = DEFAULT_PERSONA): Promise<string> {
  await page.goto(`${APP}/api/auth/login`, { waitUntil: 'domcontentloaded' });

  /**
   * The redirect actually left this app.
   *
   * Asserted before touching the form: if the app ever regains a login form of its own, the fill
   * below would succeed against the wrong origin and the spec would pass while the property this
   * whole extraction exists to hold had been broken.
   */
  await expect(page, 'sign-in did not redirect to the authority').toHaveURL(
    new RegExp(`^${AUTHORITY_UI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/auth/login`),
  );

  await page.locator('#login').fill(persona.login);
  await page.locator('#password').fill(persona.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  /**
   * A first-time authorization asks for consent, and a returning one does not.
   *
   * Both are correct, so the prompt is handled when it appears rather than waited for. Waiting
   * unconditionally would hang on every run after the first, and skipping it would hang on the
   * first run against a freshly seeded database.
   */
  const approve = page.getByRole('button', { name: /^(Approve|Allow|Continue)$/ });
  await Promise.race([
    page.waitForURL((url) => url.pathname.startsWith('/system'), { timeout: 20_000 }).catch(() => null),
    approve.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => null),
  ]);
  if (await approve.isVisible().catch(() => false)) {
    await approve.click();
  }

  // Back on the app, with the code already exchanged by the callback.
  await page.waitForURL((url) => url.href.startsWith(APP), { timeout: 20_000 });

  const token = await tokenFrom(page.context());
  expect(token, 'the sign-in produced no session cookie').toBeTruthy();
  return token as string;
}

/** The access token the callback stored, read from the cookie jar rather than from the page. */
export async function tokenFrom(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies();
  return cookies.find((cookie) => cookie.name === 'demo_token')?.value ?? null;
}

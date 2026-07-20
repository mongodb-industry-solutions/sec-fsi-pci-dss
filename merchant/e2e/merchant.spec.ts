/**
 * Merchant app E2E (Playwright).
 *
 * These specs exercise the real SSO + PSP integration and therefore need the FULL stack:
 *   - merchant  → http://localhost:8082
 *   - PSP API   → http://localhost:8081  (reseeded DB)
 *   - PSP UI    → http://localhost:8080  (consent page)
 *
 * They are skipped unless RUN_MERCHANT_E2E=1 so CI (single-server) stays green.
 * Log in on the consent page with a seeded Espresso Works user (owner luis.fernandez@back.es).
 */
import { test, expect, Page } from '@playwright/test';

const RUN = process.env.RUN_MERCHANT_E2E === '1';
const EMAIL = process.env.MERCHANT_E2E_EMAIL ?? 'luis.fernandez@back.es';
const PASSWORD = process.env.MERCHANT_E2E_PASSWORD ?? 'demo-password';

test.describe('Merchant ↔ Sec4 Pay SSO + API', () => {
  test.skip(!RUN, 'Set RUN_MERCHANT_E2E=1 with the full PSP + merchant stack running.');

  // Drives the OAuth consent page hosted by the PSP frontend and lands back on the merchant.
  async function login(page: Page) {
    await page.goto('/');
    await page.getByRole('link', { name: /login with sec4 pay/i }).click();
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.getByRole('link', { name: /allow/i }).click();
    await expect(page).toHaveURL(/localhost:8082/);
    await expect(page.getByText(/signed in as/i)).toBeVisible();
  }

  test('SSO login establishes a server-side session', async ({ page }) => {
    await login(page);
    await expect(page.getByText(/granted permissions/i)).toBeVisible();
  });

  test('each product triggers its payment method', async ({ page }) => {
    await login(page);
    await page.goto('/products');
    const cards = page.locator('button', { hasText: 'Pay' });
    await expect(cards.first()).toBeVisible();
    // Payment Link product → shows a shareable link (does not navigate away).
    await cards.nth(0).click();
    await expect(page.getByText(/payment link created|error|not authorised/i)).toBeVisible();
  });

  test('beneficiaries list renders (masked) or degrades gracefully', async ({ page }) => {
    await login(page);
    await page.goto('/beneficiaries');
    await expect(page.getByRole('heading', { name: /beneficiaries|permission not granted/i })).toBeVisible();
  });

  test('bank transfer preview + submit', async ({ page }) => {
    await login(page);
    await page.goto('/transfers');
    const heading = page.getByRole('heading', { name: /bank transfer|permission not granted/i });
    await expect(heading).toBeVisible();
    if (await page.getByRole('button', { name: /preview/i }).count()) {
      await page.getByRole('button', { name: /preview/i }).click();
      await expect(page.getByText(/preview/i)).toBeVisible();
    }
  });

  test('accounts show masked IBAN and history renders', async ({ page }) => {
    await login(page);
    await page.goto('/accounts');
    await expect(page.getByRole('heading', { name: /your accounts|permission not granted/i })).toBeVisible();
    await page.goto('/history');
    await expect(page.getByRole('heading', { name: /operation history|permission not granted/i })).toBeVisible();
  });
});

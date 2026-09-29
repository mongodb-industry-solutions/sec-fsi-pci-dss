/**
 * An account holder is offered only what their token can use.
 *
 * The backend already refuses every one of these on its own (see the integration suite); this is
 * the other half of least privilege, that the screen never draws a control whose only outcome is a
 * 403. A button that always fails is worse than no button: it reads as a bug in the bank rather
 * than as a boundary that was never meant to open.
 *
 * Requires the bank frontend and backend running, signing in through the real authority.
 */
import { test, expect, Page } from '@playwright/test';

const BANK_UI = process.env.BANK_UI_URL ?? 'http://localhost:8084';
const DEMO_PASSWORD = 'demo-password';

async function signIn(page: Page, login: string) {
  await page.goto(`${BANK_UI}/api/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('#login').fill(login);
  await page.locator('#password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(`${BANK_UI}/**`, { timeout: 20000 });
}

test.describe('an account holder never sees a control they cannot use', () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.get(`${BANK_UI}/`).catch(() => null);
    expect(response, 'the bank frontend must be running for this to mean anything').not.toBeNull();
  });

  test('the accounts list offers no "Open an account" toolbar', async ({ page }) => {
    await signIn(page, 'elena.duarte');
    await page.goto(`${BANK_UI}/accounts`);
    await expect(page.getByRole('link', { name: /open an account/i })).toHaveCount(0);
  });

  test('the card estate offers no "Issue a card" toolbar', async ({ page }) => {
    await signIn(page, 'elena.duarte');
    await page.goto(`${BANK_UI}/cards`);
    await expect(page.getByRole('link', { name: /issue a card/i })).toHaveCount(0);
  });

  test('/accounts/new refuses to draw the form for a role that cannot open one', async ({ page }) => {
    await signIn(page, 'elena.duarte');
    await page.goto(`${BANK_UI}/accounts/new`);
    await expect(page.getByText(/not available to your role/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /open the account/i })).toHaveCount(0);
  });

  test('/cards/new refuses to draw the form for a role that cannot issue one', async ({ page }) => {
    await signIn(page, 'elena.duarte');
    await page.goto(`${BANK_UI}/cards/new`);
    await expect(page.getByText(/not available to your role/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /issue the card/i })).toHaveCount(0);
  });

  test('an operator still sees the same toolbars, so this is a role gate and not a broken button', async ({ page }) => {
    await signIn(page, 'marta.oliveira');
    await page.goto(`${BANK_UI}/accounts`);
    await expect(page.getByRole('link', { name: /open an account/i })).toBeVisible();
    await page.goto(`${BANK_UI}/cards`);
    await expect(page.getByRole('link', { name: /issue a card/i })).toBeVisible();
  });

  test("an account holder's own account page offers recent activity, and no lifecycle controls", async ({ page }) => {
    await signIn(page, 'elena.duarte');
    await page.goto(`${BANK_UI}/accounts`);
    const rowLink = page.locator('[data-account-holder-reference] a, a[href^="/accounts/acc"]').first();
    if ((await rowLink.count()) === 0) return; // No accounts seeded for this run is a valid, if uninteresting, answer.
    await rowLink.click();
    await expect(page.getByText(/recent activity/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^block$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^close$/i })).toHaveCount(0);
  });
});

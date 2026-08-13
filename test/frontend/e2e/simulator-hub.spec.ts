/**
 * E2E: Simulator hub options (/simulator) + the transfer menu entry point.
 * Covers the share-by-QR option (URL resolved per environment) and the merchant-payment card.
 */
import { test, expect } from '@playwright/test';
import { loginAs } from './support/auth';

test.describe('Simulator hub: share with QR code', () => {
  test('shows a scannable QR with this environment demo URL', async ({ page, baseURL }) => {
    await page.goto('/simulator');
    await page.getByRole('button', { name: /Show QR code/i }).click();
    await expect(page.getByRole('heading', { name: /Share this demo/i })).toBeVisible();
    // The payload is rendered as a real QR (inline svg) plus a copyable link.
    await expect(page.locator('svg').first()).toBeVisible();
    await expect(page.getByText(`${baseURL}/simulator`, { exact: false })).toBeVisible();
  });

  test('closes the share panel', async ({ page }) => {
    await page.goto('/simulator');
    await page.getByRole('button', { name: /Show QR code/i }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('heading', { name: /Share this demo/i })).toBeHidden();
  });
});

test.describe('Transfer menu: merchant payment', () => {
  test('links to the card payment wizard', async ({ page, context }) => {
    await loginAs(context, 'customer');
    await page.goto('/system/transfer');
    const card = page.getByRole('link', { name: /New merchant payment/i });
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(card).toHaveAttribute('href', '/system/payment');
    await card.click();
    await expect(page).toHaveURL(/\/system\/payment$/);
  });
});

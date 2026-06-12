/**
 * E2E: Simulator Mode - Payment Flow (FR-v1-01)
 * Primary demo flow: card entry → masking → encryption explainer → confirmation.
 * Covers: card masking, 3-step wizard, PCI DSS note, fraud alert on creation.
 */
import { test, expect } from '@playwright/test';

test.describe('FR-v1-01: Simulator Payment Flow', () => {
  test.beforeEach(async ({ page }) => {
    // The simulator payment page reads sim_method from sessionStorage on mount.
    // Without it the component calls router.replace('/simulator'). Inject before nav.
    await page.addInitScript(() => {
      sessionStorage.setItem('sim_method', 'api-card');
    });
    await page.goto('/simulator/payment');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 8_000 });
  });

  test('01.1 renders Step 1 of the 3-step checkout wizard', async ({ page }) => {
    await expect(page).toHaveURL(/\/simulator\/payment/);
    await expect(page.locator('input').first()).toBeVisible();
  });

  test('01.2 masks PAN — pre-filled demo card is already shown masked', async ({ page }) => {
    // Page initialises maskedCard from simulatorConfig.defaultCard → ****-****-****-XXXX
    await expect(page.locator('text=/\\*{4}/').first()).toBeVisible({ timeout: 2_000 });
    // Static help text is always visible beneath the card selector
    await expect(page.locator('text=/raw PAN never stored/i').first()).toBeVisible();
  });

  test('01.3 Next advances to Step 2 with encryption explainer', async ({ page }) => {
    // Defaults are pre-filled; clicking Next passes validation and shows step 2
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    // Step 2 heading is "Review & Encryption"; table shows QE:equality fields
    await expect(page.locator('text=/encrypt/i').first()).toBeVisible({ timeout: 4_000 });
  });

  test('01.4 Back button returns to Step 1', async ({ page }) => {
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await page.locator('button:has-text("Back"), button:has-text("←")').first().click();
    await expect(page.locator('input').first()).toBeVisible();
  });

  test('01.5 Step 2 shows PCI DSS card token surrogate note', async ({ page }) => {
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    // "surrogate" appears in the visible paragraph at bottom of step 2
    await expect(
      page.locator('text=/surrogate/i').first()
    ).toBeVisible({ timeout: 4_000 });
  });

  test('01.6 Confirm with fraud case shows FraudAlert with countdown', async ({ page }) => {
    await page.route('**/api/v1/card-transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            cardTransactionInstanceReference: 'txn-e2e-sim-001',
            cardTransactionStatus: 'authorized',
            fraudCaseCreated: true,
            fraudDiagnosisInstanceReference: 'case-sim-001',
          }),
        });
      } else route.continue();
    });
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await page.locator('button:has-text("Confirm"), button:has-text("→")').last().click();
    await expect(page.locator('text=/fraud|suspicious|Redirecting/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('01.7 Confirm without fraud shows success screen', async ({ page }) => {
    await page.route('**/api/v1/card-transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            cardTransactionInstanceReference: 'txn-e2e-sim-002',
            cardTransactionStatus: 'authorized',
            fraudCaseCreated: false,
          }),
        });
      } else route.continue();
    });
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await page.locator('button:has-text("Confirm"), button:has-text("→")').last().click();
    await expect(page.locator('text=/Confirmed|✅/i').first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('FR-v1-01: Landing Page Navigation', () => {
  test('landing page has Simulator Mode and Application Mode cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=/Simulator/i').first()).toBeVisible();
    await expect(page.locator('text=/Application/i').first()).toBeVisible();
  });

  test('Simulator Mode card navigates to /simulator', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[href*="simulator"]').first().click();
    await expect(page).toHaveURL(/\/simulator/);
  });
});

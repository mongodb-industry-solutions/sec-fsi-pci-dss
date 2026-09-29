/**
 * E2E: Simulator Mode - Payment Flow (FR-v1-01)
 * Primary demo flow: card entry → masking → encryption explainer → confirmation.
 * Covers: card masking, 3-step wizard, PCI DSS note, fraud alert on creation.
 */
import { test, expect } from '@playwright/test';

// A number to type. The simulator used to pre-fill one of its own, and that is exactly what was
// wrong with it: it named a card no issuer on this platform had ever issued, so the payment it led
// to was declined for a card the system had never heard of. With no scenario loaded there is no
// payer and therefore no card on file, so a card is entered by hand, which is the other real path.
const TYPED_CARD = '4539000000000010';

async function enterCard(page: import('@playwright/test').Page) {
  await page.getByPlaceholder('Enter card number').fill(TYPED_CARD);
}

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

  test('01.2 masks PAN: a typed number is shown back masked, never in clear', async ({ page }) => {
    await enterCard(page);
    // Only the last four survive, and the masking happens as the digits are entered.
    await expect(page.getByText(`****-****-****-${TYPED_CARD.slice(-4)}`)).toBeVisible({ timeout: 4_000 });
    await expect(page.getByText(TYPED_CARD)).toHaveCount(0);
    await expect(page.locator('text=/raw PAN never leaves the browser/i').first()).toBeVisible();
  });

  test('01.3 Next advances to Step 2 with encryption explainer', async ({ page }) => {
    await enterCard(page);
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    // Step 2 heading is "Review & Encryption"; table shows QE:equality fields
    await expect(page.locator('text=/encrypt/i').first()).toBeVisible({ timeout: 4_000 });
  });

  test('01.4 Back button returns to Step 1', async ({ page }) => {
    await enterCard(page);
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await page.locator('button:has-text("Back"), button:has-text("←")').first().click();
    await expect(page.locator('input').first()).toBeVisible();
  });

  test('01.5 Step 2 shows PCI DSS card token surrogate note', async ({ page }) => {
    await enterCard(page);
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    // "surrogate" appears in the visible paragraph at bottom of step 2
    await expect(
      page.locator('text=/surrogate/i').first()
    ).toBeVisible({ timeout: 4_000 });
  });

  test('01.6 Confirm with fraud case shows FraudAlert with countdown', async ({ page }) => {
    // The payment is created via POST /api/v1/transactions; the terminal authorization
    // outcome (incl. fraud case) is delivered over the per-transaction SSE stream.
    await page.route('**/api/v1/transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            cardTransactionInstanceReference: 'txn-e2e-sim-001',
            cardTransactionStatus: 'pending',
          }),
        });
      } else route.continue();
    });
    await page.route('**/api/v1/transactions/txn-e2e-sim-001/stream', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ status: 'authorized', fraudCaseCreated: true, caseId: 'case-sim-001' })}\n\n`,
      });
    });
    await enterCard(page);
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await page.locator('button:has-text("Confirm"), button:has-text("→")').last().click();
    // FraudAlert renders: "🚨 Fraud Alert…" + "Switching to Investigation in Ns…" countdown
    await expect(page.locator('text=/fraud/i').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=/Switching to Investigation/i').first()).toBeVisible({ timeout: 8_000 });
  });

  test('01.7 Confirm without fraud shows success screen', async ({ page }) => {
    // Same shape as 01.6: the payment is created via POST /api/v1/transactions and the terminal
    // outcome arrives on the per-transaction SSE stream. Only the outcome differs (no fraud case).
    await page.route('**/api/v1/transactions', (route, req) => {
      if (req.method() === 'POST') {
        route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            cardTransactionInstanceReference: 'txn-e2e-sim-002',
            cardTransactionStatus: 'pending',
          }),
        });
      } else route.continue();
    });
    await page.route('**/api/v1/transactions/txn-e2e-sim-002/stream', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ status: 'authorized', fraudCaseCreated: false })}\n\n`,
      });
    });
    await enterCard(page);
    await page.locator('button:has-text("Next"), button:has-text("→")').first().click();
    await page.locator('button:has-text("Confirm"), button:has-text("→")').last().click();
    await expect(page.locator('text=/Payment Confirmed/i').first()).toBeVisible({ timeout: 8_000 });
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

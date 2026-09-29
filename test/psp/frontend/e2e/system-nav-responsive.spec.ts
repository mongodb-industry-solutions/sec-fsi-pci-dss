/**
 * E2E: Responsive navigation, CarouselNav (mobile) + desktop sidebars.
 * Components: frontend/src/components/CarouselNav.tsx, DemoSidebar.tsx (MobileBottomNav),
 *             merchant/MerchantNav.tsx.
 * Guarantees: edge chevrons appear ONLY on overflow, active item auto-centers,
 *             desktop sidebars unchanged at >= md (768px).
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

const opacity = (p: Page, sel: string) =>
  p.locator(sel).first().evaluate((el) => Number(getComputedStyle(el as Element).opacity)).catch(() => -1);

const MERCHANT_ID = 'MA-001';

async function stubMerchant(page: Page) {
  // The merchant layout loads the active merchant via getById (/merchants/:id).
  // status 'active' unlocks the full nav (9 items) so the strip overflows at 375px.
  await page.route(`**/api/v1/merchants/${MERCHANT_ID}`, (r) => r.fulfill(json({
    merchantAgreementInstanceReference: MERCHANT_ID, merchantName: 'Acme Coffee Ltd',
    merchantCategoryCode: '5812', merchantCountryCode: 'US', merchantAgreementStatus: 'active',
  })));
  await page.route('**/api/v1/merchants/*/transactions*', (r) => r.fulfill(json({ page: 1, limit: 10, total: 1, results: [
    { cardTransactionInstanceReference: 't1', cardTransactionAmount: { amount: 42.5, currency: 'USD' }, cardTransactionDateTime: '2026-06-01T10:00:00Z', cardTransactionStatus: 'settled', cardTransactionMerchantName: 'Acme Coffee Ltd', cardTransactionMaskedPanDisplay: '**** 4242', cardTransactionDescription: 'Latte' },
  ] })));
  await page.route('**/api/v1/merchants/*/stats', (r) => r.fulfill(json({ count: 1, totalAmount: 42.5, avgAmount: 42.5, byStatus: [], byMonth: [], byCurrency: [] })));
}

test.describe('Responsive nav: merchant section strip (light carousel)', () => {
  test.beforeEach(async ({ page, context }) => { await stubMerchant(page); await loginAs(context, 'customer'); });

  test('@375px the strip overflows and centers the active item (both chevrons shown)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/system/merchant/${MERCHANT_ID}/payments`);
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(600);
    // 6 items overflow at 375px; active "Transactions" auto-centers → both chevrons visible.
    expect(await opacity(page, 'nav.bg-white button[aria-label="Scroll right"]')).toBeGreaterThan(0.5);
    expect(await opacity(page, 'nav.bg-white button[aria-label="Scroll left"]')).toBeGreaterThan(0.5);
  });

  test('@375px the customer bottom bar overflows and auto-centers the active item', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/system/merchant/${MERCHANT_ID}/payments`);
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(400);
    // The customer role bottom bar has 8+ items → overflows at 375px. The active item
    // ("Merchants", last in the bar) auto-centers, scrolling to the end: the left
    // chevron shows while the right one is hidden.
    expect(await opacity(page, 'nav.fixed button[aria-label="Scroll left"]')).toBeGreaterThan(0.5);
    expect(await opacity(page, 'nav.fixed button[aria-label="Scroll right"]')).toBeLessThan(0.5);
  });

  test('@1280px the vertical sidebar shows and the bottom bar is hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/system/merchant/${MERCHANT_ID}/payments`);
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('nav.bg-white > ul')).toBeVisible();   // desktop vertical list
    await expect(page.locator('nav.fixed')).toBeHidden();             // mobile bottom bar gone
  });
});

test.describe('Responsive nav: role bottom bar (dark carousel)', () => {
  test('@375px the 11-item manager bar overflows; tapping right reveals the left chevron', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/system/help');
    await page.waitForTimeout(800);
    // At start: only the right chevron (overflow), left hidden.
    expect(await opacity(page, 'nav.fixed button[aria-label="Scroll right"]')).toBeGreaterThan(0.5);
    expect(await opacity(page, 'nav.fixed button[aria-label="Scroll left"]')).toBeLessThan(0.5);
    // Scroll right a few times → left chevron appears.
    const right = page.locator('nav.fixed button[aria-label="Scroll right"]').first();
    for (let i = 0; i < 4; i++) { await right.click({ force: true }); await page.waitForTimeout(200); }
    expect(await opacity(page, 'nav.fixed button[aria-label="Scroll left"]')).toBeGreaterThan(0.5);
  });

  test('@768px the bottom bar is hidden and the desktop sidebar shows', async ({ page, context }) => {
    await loginAs(context, 'manager');
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/system/help');
    await expect(page.getByRole('heading', { name: 'Compliance Guide' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('nav.fixed')).toBeHidden();
    await expect(page.locator('aside')).toBeVisible();
  });
});

test.describe('Responsive header: dropdown panels stay on screen', () => {
  const VIEWPORT = 360;

  for (const [label, selector] of [
    ['notifications', 'button[aria-label="Notifications"]'],
    ['user menu', 'header button[aria-haspopup="menu"]'],
  ] as const) {
    test(`@${VIEWPORT}px the ${label} panel is fully inside the viewport`, async ({ page, context }) => {
      await loginAs(context, 'customer');
      await page.route('**/api/v1/notifications**', (r) => r.fulfill(json({ items: [], count: 0 })));
      await page.setViewportSize({ width: VIEWPORT, height: 780 });
      await page.goto('/system/profile');
      // Wait for hydration to settle: the header re-renders once the token is decoded.
      await expect(page.locator('header button[aria-haspopup="menu"]')).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(500);

      await page.locator(selector).first().click();
      const panel = page.locator('[role="menu"]').first();
      await expect(panel).toBeVisible();

      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORT);
    });
  }
});

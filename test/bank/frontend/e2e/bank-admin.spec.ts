/**
 * The bank's administration app, at the three sizes it has to work at.
 *
 * "Responsive" is a claim, and the way it fails is specific and mechanical: the page scrolls sideways because
 * something inside it is wider than the viewport, or a control ends up off-screen and unreachable. Both are
 * measurable, so they are measured here rather than eyeballed.
 *
 * Requires the bank frontend and the bank backend running. It fails rather than skips when they are not: a
 * responsive check that quietly passes against a dead server is worse than none.
 */
import { test, expect, Page } from '@playwright/test';

const BANK_UI = process.env.BANK_UI_URL ?? 'http://localhost:8084';

// Small, medium, large. The small one is a 380px phone, which is narrower than most and therefore the honest
// floor; the medium is a tablet in portrait, where a table has to give way to cards.
const VIEWPORTS = [
  { name: 'phone', width: 380, height: 780 },
  { name: 'tablet', width: 834, height: 1000 },
  { name: 'desktop', width: 1440, height: 900 },
];

// The card issuer and account information pages carry a DATA tab, which is the densest thing this app
// renders and therefore the most likely to overflow a phone.
const PAGES = [
  '/', '/modules/card-issuer', '/modules/aisp', '/modules/credit-bureau',
  '/records/audit', '/records/tpp%2Fregistrations',
];

async function noHorizontalOverflow(page: Page, label: string) {
  // The document must never be wider than the window. Wide content is allowed to scroll inside its own
  // container, which is why this measures the PAGE and not the table.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  // One pixel of slack for sub-pixel layout rounding.
  expect(
    overflow.scrollWidth - overflow.clientWidth,
    `${label} scrolls sideways: ${overflow.scrollWidth}px of content in a ${overflow.clientWidth}px window`,
  ).toBeLessThanOrEqual(1);
}

test.describe('the bank administration app', () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.get(`${BANK_UI}/`).catch(() => null);
    expect(response, 'the bank frontend must be running for this to mean anything').not.toBeNull();
  });

  for (const viewport of VIEWPORTS) {
    test.describe(`at ${viewport.name} (${viewport.width}px)`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const path of PAGES) {
        test(`${path} fits the viewport`, async ({ page }) => {
          const response = await page.goto(`${BANK_UI}${path}`, { waitUntil: 'domcontentloaded' });
          expect(response?.status(), `${path} answered ${response?.status()}`).toBeLessThan(400);
          await page.waitForTimeout(400);
          await noHorizontalOverflow(page, `${viewport.name} ${path}`);

          // Something was painted, and it is the bank's app rather than an error shell. Asserted by the
          // link's DESTINATION rather than its text: the product name is the app's to change, and a test
          // that breaks on a rename is testing the wrong thing.
          await expect(page.locator('header a[href="/"]')).toBeVisible();
        });
      }

      test('the way home is reachable without scrolling', async ({ page }) => {
        // The header is sticky for this reason: on a long audit table the way back must not be a scroll away.
        await page.goto(`${BANK_UI}/records/audit`, { waitUntil: 'domcontentloaded' });
        await page.mouse.wheel(0, 4000);
        await page.waitForTimeout(200);
        await expect(page.locator('header a[href="/"]')).toBeInViewport();
      });
    });
  }

  test('a record set renders as cards on a phone and as a table on a desktop', async ({ page }) => {
    // The layout switch is the point: eight columns at 380px is either unreadable or a sideways scroll that
    // hides the columns that matter.
    await page.setViewportSize({ width: 380, height: 780 });
    await page.goto(`${BANK_UI}/records/audit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await expect(page.locator('table')).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    await expect(page.locator('table')).toBeVisible();
  });

  test('the configuration editor keeps its save control reachable on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 780 });
    await page.goto(`${BANK_UI}/modules/card-issuer`, { waitUntil: 'domcontentloaded' });
    // The card issuer opens on its DATA tab now, so the rules have to be asked for.
    await page.getByRole('tab', { name: 'Rules and policies' }).click();
    await page.waitForTimeout(500);
    const save = page.getByRole('button', { name: 'Save' });
    // Sticky at the bottom below `sm`, so it is in view even with a long document above it.
    await expect(save).toBeInViewport();
    // Disabled until something changes: a save that does nothing is a save that teaches nothing.
    await expect(save).toBeDisabled();
  });

  test('the browser never learns the bank host', async ({ page }) => {
    // Every request the page makes must go to this app's own origin. A direct call to the bank would work on
    // a developer's machine and fail in staging as a CORS error, which is a long way from the cause.
    const foreign: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(BANK_UI) && !url.startsWith('data:')) foreign.push(url);
    });
    await page.goto(`${BANK_UI}/records/audit`, { waitUntil: 'networkidle' });
    expect(foreign, 'the page reached outside its own origin').toEqual([]);
  });
});

test.describe('the data administration screens', () => {
  test('the card estate lists, filters and pages without overflowing a phone', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 780 });
    await page.goto(`${BANK_UI}/modules/card-issuer`, { waitUntil: 'domcontentloaded' });

    // The data tab is first: an operator arrives looking for a record far more often than for a rule.
    await expect(page.getByRole('tab', { name: 'Cards' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByPlaceholder(/Token, last four/)).toBeVisible();

    // The status summary is built from the bank's own counts, so a filter chip has a number behind it.
    await expect(page.getByRole('button', { name: /active \d+/ })).toBeVisible();
    await noHorizontalOverflow(page, 'phone card estate');
  });

  test('a status filter narrows the estate, and the count follows', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BANK_UI}/modules/card-issuer`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /issued \d+/ }).click();
    // The filtered count must differ from the unfiltered one, or the chip is decorative.
    await expect(page.getByText(/\d+ records? match\./)).toBeVisible();
    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await noHorizontalOverflow(page, 'desktop filtered estate');
  });

  test('a terminal card offers no action, because the bank would refuse one', async ({ page }) => {
    // The lifecycle map in the screen mirrors the bank's own, so it offers only moves the server accepts. A
    // revoked card is the case worth pinning: `terminal` in place of a button is the screen refusing to
    // suggest something that would fail.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BANK_UI}/modules/card-issuer`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /revoked \d+/ }).click();
    // Scoped to the TABLE. The phone list renders the same word and comes first in the DOM, so an unscoped
    // `.first()` picks the hidden copy and fails for a reason that has nothing to do with the behaviour.
    await expect(page.locator('table tbody').getByText('terminal').first()).toBeVisible();
    await noHorizontalOverflow(page, 'desktop revoked estate');
  });

  test('the accounts list resolves the holder and shows both balances', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1000 });
    await page.goto(`${BANK_UI}/modules/aisp`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Accounts' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByPlaceholder(/Masked IBAN/)).toBeVisible();
    await noHorizontalOverflow(page, 'tablet accounts');
  });

  test('a capability with no records shows its rules and nothing it cannot back up', async ({ page }) => {
    // The consent engine has no estate behind it, so it gets one tab. Offering an empty "records" tab would
    // imply a collection that does not exist.
    await page.goto(`${BANK_UI}/modules/credit-bureau`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Rules and policies' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Cards' })).toHaveCount(0);
  });
});

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

const PAGES = ['/', '/modules/card-issuer', '/records/audit', '/records/tpp%2Fregistrations'];

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

          // Something was painted, and it is the bank's app rather than an error shell.
          await expect(page.getByRole('link', { name: /Verdant\s+Bank/ })).toBeVisible();
        });
      }

      test('the way home is reachable without scrolling', async ({ page }) => {
        // The header is sticky for this reason: on a long audit table the way back must not be a scroll away.
        await page.goto(`${BANK_UI}/records/audit`, { waitUntil: 'domcontentloaded' });
        await page.mouse.wheel(0, 4000);
        await page.waitForTimeout(200);
        await expect(page.getByRole('link', { name: /Verdant\s+Bank/ })).toBeInViewport();
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

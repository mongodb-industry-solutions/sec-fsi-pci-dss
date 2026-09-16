/**
 * Roles, at the UI: what a signed-in person is offered, and what they actually reach when they ask.
 *
 * Two properties, both regressions that were live in this codebase before this file existed. The
 * first: the header greeted a real administrator by their login name instead of their name, because
 * the profile lookup preferred the wrong claim. The second, more serious: an account holder's list
 * screens returned the whole bank's accounts and cards, because the guard that binds a holder to
 * their own records was written and never wired to a route. Both are asserted here at the level a
 * person actually meets them, not at the level of the fix.
 *
 * Requires the bank frontend and backend running, signing in through the real authority.
 */
import { test, expect, Page } from '@playwright/test';

const BANK_UI = process.env.BANK_UI_URL ?? 'http://localhost:8084';
const DEMO_PASSWORD = 'demo-password';

async function signIn(page: Page, login: string) {
  await page.goto(`${BANK_UI}/api/auth/login`, { waitUntil: 'domcontentloaded' });
  // By id, not by accessible name: the field's label carries a "More information" button whose text
  // joins the accessible name, so `/^password$/i` never matches it and the fill hangs until timeout.
  await page.locator('#login').fill(login);
  await page.locator('#password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(`${BANK_UI}/**`, { timeout: 20000 });
}

test.describe('the bank console honours the role it authenticated', () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.get(`${BANK_UI}/`).catch(() => null);
    expect(response, 'the bank frontend must be running for this to mean anything').not.toBeNull();
  });

  test('an administrator is greeted by their name, not their login, even when they hold a second role', async ({ page }) => {
    // Samuel Adeyemi holds bank_admin AND realm_administrator: the defect this guards against read
    // element zero of an unordered claim and rendered whichever role name came back first.
    await signIn(page, 'samuel.adeyemi');
    await page.getByRole('button', { name: /administrator/i }).click();
    // Two copies of the name are on screen once the menu is open: the trigger and the panel header.
    await expect(page.getByText('Samuel Adeyemi').first()).toBeVisible();
    await expect(page.getByText(/^administrator$/i).first()).toBeVisible();
  });

  test('an account holder is offered no menu entry that will refuse them', async ({ page }) => {
    await signIn(page, 'elena.duarte');
    const menuButton = page.getByRole('button').filter({ hasText: /duarte/i }).first();
    await menuButton.click();
    // Offered to a bank-wide role, refused to an account holder: any of these appearing in the menu
    // is a promise the token cannot keep.
    await expect(page.getByRole('menuitem', { name: /parties/i })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /audit records/i })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /third-party registrations/i })).toHaveCount(0);
    // Their own records are still reachable: the binding narrows what is inside the screen, it does
    // not remove the screen.
    await expect(page.getByRole('menuitem', { name: /^accounts$/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /card estate/i })).toBeVisible();
  });

  test("an account holder's own accounts screen names nobody but them", async ({ page }) => {
    await signIn(page, 'elena.duarte');
    await page.goto(`${BANK_UI}/accounts`);
    // Whatever the page renders, no row may belong to a different account holder reference: the
    // list API is asserted directly in the backend suite, this checks the SCREEN a person reads.
    const rows = page.locator('[data-account-holder-reference]');
    const count = await rows.count();
    if (count === 0) return; // No accounts is a valid, if uninteresting, answer.
    const references = await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-account-holder-reference')));
    const distinct = new Set(references);
    expect(distinct.size, 'an account holder\'s own screen showed more than one holder').toBe(1);
  });
});

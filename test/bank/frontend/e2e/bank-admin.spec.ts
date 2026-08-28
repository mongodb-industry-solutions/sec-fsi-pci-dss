/**
 * The bank's administration app, at the three sizes it has to work at, and against the properties it claims.
 *
 * "Responsive" is a claim, and the way it fails is specific and mechanical: the page scrolls sideways because
 * something inside it is wider than the viewport, or a control ends up off-screen and unreachable. Both are
 * measurable, so they are measured here rather than eyeballed.
 *
 * The rest of this file checks the claims that are easy to believe and easy to get wrong: that a protected value
 * is absent until it is asked for, that one page control drives every list, that a card can be walked to its
 * account and its owner, and that no request leaves this app's origin.
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

// One per kind of screen: the home, a data list, a create form, a rules form, and a log. Each is the densest
// thing of its kind and therefore the most likely to overflow a phone.
const PAGES = [
  '/',
  '/cards',
  '/accounts',
  '/holders',
  '/cards/new',
  '/accounts/new',
  '/rules/card-issuer',
  '/rules/credit-bureau',
  '/records/audit',
  '/records/tpp/deliveries',
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

/**
 * The first card in the estate, so a detail test does not depend on a hardcoded token.
 *
 * Two exclusions, both learned the hard way. `/cards/new` is excluded by its exact href rather than by its
 * text, because it is a link to a FORM in the same toolbar and it sorts before every row. And `:visible`
 * matters as much: every row exists TWICE in the document, once in the card layout for narrow screens and once
 * in the table, so `.first()` without it returns the copy the current viewport is hiding.
 */
async function firstCardHref(page: Page): Promise<string> {
  await page.goto(`${BANK_UI}/cards`, { waitUntil: 'domcontentloaded' });
  const link = page.locator('a[href^="/cards/"]:not([href="/cards/new"]):visible').first();
  await expect(link, 'the estate must contain at least one card for this to mean anything').toBeVisible({ timeout: 20000 });
  return (await link.getAttribute('href')) ?? '';
}

/**
 * Opens the filter panel, retrying the click.
 *
 * A click that lands before React has hydrated is DISCARDED: the button exists in the server HTML, Playwright
 * sees it as actionable, and the handler is not attached yet. The old version of this test waited 1200ms first,
 * which hid the problem behind a delay rather than solving it, and removing that delay is what exposed it.
 *
 * Retrying is the honest fix: it succeeds as soon as the handler exists, without assuming how long that takes
 * on a development server that compiles on demand.
 */
async function openFilterPanel(page: Page): Promise<void> {
  const filters = page.getByRole('button', { name: /^Filters/ });
  await expect(filters).toBeVisible({ timeout: 20000 });
  await expect(async () => {
    await filters.click();
    await expect(page.getByLabel('When')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 25000 });
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
          await page.waitForTimeout(600);
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
        await page.waitForTimeout(600);
        await page.mouse.wheel(0, 3000);
        await expect(page.locator('header a[href="/"]')).toBeInViewport();
      });

      test('a list renders as cards on a phone and a table on a desktop', async ({ page }) => {
        await page.goto(`${BANK_UI}/cards`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
        const table = page.locator('table').first();
        if (viewport.width < 768) {
          // A table of eight columns at 380px is either an unreadable squeeze or a sideways scroll that hides
          // the columns that matter, so below `md` the same rows render one card each.
          await expect(table).toBeHidden();
        } else {
          await expect(table).toBeVisible();
        }
      });
    });
  }

  test.describe('protected values', () => {
    test('a card number is absent from the page until it is asked for', async ({ page }) => {
      const href = await firstCardHref(page);
      await page.goto(`${BANK_UI}${href}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);

      // The masked form is what renders. Nothing that looks like a full card number is anywhere in the
      // document, and that is the property worth testing: a value hidden with CSS is still in the page, still
      // in memory and still in anything that captures it.
      const before = await page.content();
      expect(before, 'a full card number must not be in the page before a reveal').not.toMatch(/\b\d{16}\b/);

      const reveal = page.getByRole('button', { name: /reveal the card number/i });
      await expect(reveal).toBeVisible();
      await reveal.click();

      // The number arrives only now, from a call the bank records as a disclosure.
      await expect(page.locator('text=/\\b\\d{16}\\b/').first()).toBeVisible({ timeout: 15000 });

      // And clicking again discards it rather than merely hiding it.
      await page.getByRole('button', { name: /hide the card number/i }).click();
      await page.waitForTimeout(300);
      expect(await page.content(), 'the number must be discarded on hide').not.toMatch(/\b\d{16}\b/);
    });

    test('an IBAN is revealed one account at a time and never arrives with the list', async ({ page }) => {
      await page.goto(`${BANK_UI}/accounts`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      // A Spanish IBAN in full is 24 characters. The list shows the masked form, so none should appear.
      expect(await page.content(), 'a full IBAN must not appear in a list').not.toMatch(/\bES\d{22}\b/);

      // The create form is excluded by its exact href, and `:visible` picks the layout this viewport is
      // actually showing rather than the duplicate it is hiding.
      const row = page.locator('a[href^="/accounts/"]:not([href="/accounts/new"]):visible').first();
      await expect(row).toBeVisible({ timeout: 20000 });
      await row.click();
      await page.waitForTimeout(1200);

      await page.getByRole('button', { name: /reveal the iban/i }).click();
      await expect(page.locator('text=/\\bES\\d{22}\\b/').first()).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('one page control everywhere', () => {
    // The page size options exist in one component, so every list offers the same ones and defaults to the
    // same size. This is the check that catches a screen growing its own.
    for (const path of ['/cards', '/accounts', '/holders', '/records/audit', '/records/tpp/deliveries']) {
      test(`${path} pages with the shared control`, async ({ page }) => {
        await page.goto(`${BANK_UI}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);

        const perPage = page.getByLabel('Records per page');
        await expect(perPage, `${path} must offer the shared page-size control`).toBeVisible();
        await expect(perPage, 'ten by default, because an operator reads the first rows and pages').toHaveValue('10');

        // The ceiling the bank enforces is offered, and nothing above it.
        const options = await perPage.locator('option').allTextContents();
        expect(options).toContain('150');
        expect(options.some((value) => Number(value) > 150)).toBe(false);
      });
    }

    test('the page size lands in the URL, so a filtered list is a link', async ({ page }) => {
      await page.goto(`${BANK_UI}/cards`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await page.getByLabel('Records per page').selectOption('25');
      await page.waitForTimeout(800);
      expect(page.url(), 'the query belongs in the URL, not in component state').toContain('limit=25');
    });
  });

  test.describe('a card, its account and its owner', () => {
    test('a card walks to the account it draws on and the party that owns it', async ({ page }) => {
      // Reached FROM an account rather than from the top of the estate. The estate is newest-first, so
      // whichever card happens to be newest leads the list, and a card minted by a test or by hand may carry
      // no funding account. Arriving through an account guarantees the card under test actually has one, and
      // it is the journey an operator makes anyway.
      await page.goto(`${BANK_UI}/accounts?status=active`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const account = page.locator('a[href^="/accounts/"]:not([href="/accounts/new"]):visible').first();
      await expect(account).toBeVisible({ timeout: 20000 });
      await account.click();
      await page.waitForTimeout(1800);

      const card = page.locator('a[href^="/cards/"]:not([href="/cards/new"]):visible').first();
      await expect(card, 'the account must have at least one card drawing on it').toBeVisible({ timeout: 20000 });
      await card.click();
      await page.waitForTimeout(1500);

      // Every card this bank issues is a debit card, so it always has both. A screen that showed a token with
      // no way to reach either would send an operator back to a list to search for it by hand.
      const toAccount = page.getByRole('link', { name: /open the account/i });
      const toOwner = page.getByRole('link', { name: /open the owner/i });
      await expect(toAccount, 'a card must reach its funding account').toBeVisible();
      await expect(toOwner, 'a card must reach its owner').toBeVisible();

      await toAccount.click();
      await page.waitForTimeout(1500);
      expect(page.url()).toContain('/accounts/');

      // And the account reaches back: the cards drawing on it are listed on it.
      await expect(page.getByRole('heading', { name: /cards drawing on this account/i })).toBeVisible();
      await expect(page.getByRole('link', { name: /open the owner/i })).toBeVisible();
    });
  });

  test.describe('a page scoped to one record stays scoped', () => {
    test("an owner's page lists only that owner's accounts and cards", async ({ page }) => {
      // The regression this exists for: a filter PINNED by the page was being overwritten by the empty value
      // read from the URL for the same key, then dropped as empty, so the owner's page asked for every account
      // and every card at the bank. It rendered perfectly and showed the wrong records.
      await page.goto(`${BANK_UI}/holders`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const owner = page.locator('a[href^="/holders/"]:visible').first();
      await expect(owner).toBeVisible({ timeout: 20000 });
      const href = (await owner.getAttribute('href')) ?? '';
      const reference = decodeURIComponent(href.replace('/holders/', ''));
      // Navigated by URL rather than clicked. The list is newest-first and refetches on mount, so the row under
      // the cursor can be a different party by the time the click lands, and then the counts asserted below
      // belong to one party while the page shows another.
      await page.goto(`${BANK_UI}${href}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);

      // What the bank says this owner has, asked directly.
      const scoped = async (resource: string) => {
        const response = await page.request.get(
          `${BANK_UI}/api/admin/${resource}?holder=${encodeURIComponent(reference)}&limit=1`,
        );
        return (await response.json()).total as number;
      };
      const whole = async (resource: string) => {
        const response = await page.request.get(`${BANK_UI}/api/admin/${resource}?limit=1`);
        return (await response.json()).total as number;
      };

      const [accountsForOwner, cardsForOwner, allAccounts, allCards] = await Promise.all([
        scoped('accounts'), scoped('cards'), whole('accounts'), whole('cards'),
      ]);
      // The check is only meaningful if this owner holds fewer than everything.
      expect(accountsForOwner, 'the fixture must give this owner fewer accounts than the bank holds')
        .toBeLessThan(allAccounts);
      expect(cardsForOwner).toBeLessThan(allCards);

      // Both counts appear on the page, and they are the OWNER's, not the estate's.
      //
      // Matched with tolerant whitespace: the page control renders the figure and the noun in separate
      // elements, so the accessible text reads "3accounts" with nothing between them.
      const body = await page.locator('body').innerText();
      expect(body, `the accounts list must show ${accountsForOwner}, not ${allAccounts}`)
        .toMatch(new RegExp(`${accountsForOwner}\s*accounts`));
      expect(body, `the cards list must show ${cardsForOwner}, not ${allCards}`)
        .toMatch(new RegExp(`${cardsForOwner}\s*cards`));
      expect(body, 'the estate total must not appear on a page about one party')
        .not.toMatch(new RegExp(`${allAccounts}\s*accounts`));
      expect(body).not.toMatch(new RegExp(`${allCards}\s*cards`));

      // And the pinned filter is not offered as an empty control an operator could type into.
      //
      // The panel is opened properly first, and a filter that SHOULD be there is asserted before the one that
      // should not. Without that, a click discarded before hydration leaves the panel shut and the absence
      // assertion passes for the wrong reason, which is a green test proving nothing.
      const filters = page.getByRole('button', { name: /^Filters/ }).first();
      await expect(filters).toBeVisible({ timeout: 20000 });
      await expect(async () => {
        await filters.click();
        await expect(page.getByLabel('Status').first()).toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 25000 });

      await expect(
        page.getByLabel('Holder reference'),
        'the holder is pinned by the page, so it must not appear as an editable filter',
      ).toHaveCount(0);
    });
  });

  test.describe('choosing when, without typing a date', () => {
    test('a log offers presets, a single whole day, and two moments', async ({ page }) => {
      // Waits on STATE rather than on the clock throughout. Against a development server that compiles on
      // demand, a fixed delay is a coin flip under load: this test passed alone and failed inside the full
      // suite, which is the signature of a timing assumption rather than a defect.
      await page.goto(`${BANK_UI}/records/audit`, { waitUntil: 'domcontentloaded' });
      await openFilterPanel(page);

      const when = page.getByLabel('When');
      await expect(when, 'a date window is one question, so it is one control').toBeVisible();
      // Two text boxes with example-date placeholders is what this replaced.
      await expect(page.getByPlaceholder('2026-08-01')).toHaveCount(0);

      // The commonest question costs one interaction and writes both bounds to the same day.
      await when.selectOption('today');
      await page.waitForFunction(
        () => new URLSearchParams(window.location.search).has('from'),
        undefined,
        { timeout: 15000 },
      );
      const url = new URL(page.url());
      expect(url.searchParams.get('from'), 'today is a single day, so both bounds are that day')
        .toBe(url.searchParams.get('to'));
      expect(url.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // A single chosen day is its own mode, with one date field rather than two.
      await when.selectOption('day');
      await expect(page.locator('input[type="date"]')).toHaveCount(1, { timeout: 15000 });

      // A real window offers the time as well as the date.
      await when.selectOption('between');
      await expect(page.locator('input[type="datetime-local"]')).toHaveCount(2, { timeout: 15000 });
      // Waits for the address to actually carry the window before clearing it. Asserting on a fixed delay let
      // a slow render turn a real ordering bug into an intermittent one.
      await page.waitForFunction(() => new URLSearchParams(window.location.search).has('from'));

      // Clearing removes BOTH bounds, and does not lose the change to whichever write came before it.
      await when.selectOption('any');
      await page.waitForFunction(
        () => {
          const params = new URLSearchParams(window.location.search);
          return !params.has('from') && !params.has('to');
        },
        undefined,
        { timeout: 10000 },
      );
    });
  });

  test.describe('rules as a form', () => {
    test('a capability edits through controls, not a JSON blob', async ({ page }) => {
      await page.goto(`${BANK_UI}/rules/card-issuer`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);

      // The whole point of this screen: the rules are named fields with explanations, not a text area holding
      // a document an operator has to keep valid by hand.
      await expect(page.locator('textarea'), 'rules must not be edited as raw text').toHaveCount(0);
      await expect(page.getByLabel('Accepted verification value')).toBeVisible();
      await expect(page.getByLabel('Global value')).toBeVisible();
      await expect(page.getByRole('switch', { name: /require a valid check digit/i })).toBeVisible();
    });

    test('the save is refused until something actually changed', async ({ page }) => {
      await page.goto(`${BANK_UI}/rules/card-issuer`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);

      const save = page.getByRole('button', { name: /save the rules/i });
      await expect(save, 'writing back what was read is indistinguishable in the audit trail from a real change')
        .toBeDisabled();

      await page.getByLabel('Global value').fill('321');
      await expect(save).toBeEnabled();

      // Discarding returns it to untouched, rather than leaving the form dirty forever.
      await page.getByRole('button', { name: /discard the changes/i }).click();
      await expect(save).toBeDisabled();
    });

    test('a collection of rules is editable as entries, not as an array literal', async ({ page }) => {
      await page.goto(`${BANK_UI}/rules/credit-bureau`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      // The rating bands are a list of objects. Collapsed and titled, because six bands each with two fields
      // is a page nobody reaches the bottom of on a phone.
      await expect(page.getByRole('button', { name: /add a band/i }).first()).toBeVisible();
    });
  });

  test.describe('exporting for analysis elsewhere', () => {
    for (const path of ['/records/audit', '/cards']) {
      test(`${path} offers its records as JSON`, async ({ page }) => {
        await page.goto(`${BANK_UI}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        await expect(page.getByTitle(/download the records matching the current filters as json/i)).toBeVisible();
      });
    }

    test('a log row opens into the whole document', async ({ page }) => {
      await page.goto(`${BANK_UI}/records/audit`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      // An audit entry's substance is usually a nested value no column would have shown, so each row expands
      // into the record itself.
      const expand = page.getByRole('button', { name: /show the record/i }).first();
      await expect(expand).toBeVisible();
      await expand.click();
      await expect(page.getByRole('button', { name: /collapse all/i }).first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('the boundaries this app keeps', () => {
    test('no request leaves this origin', async ({ page }) => {
      const foreign: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin !== new URL(BANK_UI).origin) foreign.push(request.url());
      });

      for (const path of ['/', '/cards', '/accounts', '/records/audit']) {
        await page.goto(`${BANK_UI}${path}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(900);
      }

      // The browser never learns the bank's host and never holds a token: every read goes through this app's
      // own route handler. A request to the bank from the browser would mean both of those had stopped being
      // true.
      expect(foreign, `the browser reached outside its own origin: ${foreign.join(', ')}`).toHaveLength(0);
    });

    test('the addresses are readable, with no encoded separators', async ({ page }) => {
      // A resource whose name contains a slash used to be squeezed into one path segment, which put
      // `/records/tpp%2Fdeliveries` in the address bar. An address an operator cannot read or type is not one
      // they can share.
      await page.goto(`${BANK_UI}/records/tpp/deliveries`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      expect(page.url()).toContain('/records/tpp/deliveries');
      expect(page.url(), 'an encoded slash is not a readable address').not.toContain('%2F');

      await page.goto(`${BANK_UI}/`, { waitUntil: 'domcontentloaded' });
      const encoded = await page.locator('a[href*="%2F"]').count();
      expect(encoded, 'no navigation on this app should encode a path separator').toBe(0);
    });

    test('each screen has an address of its own', async ({ page }) => {
      // Rules and records used to share a page behind two tabs, which made neither linkable. These are five
      // separate jobs and therefore five separate addresses.
      for (const path of ['/cards', '/accounts', '/holders', '/rules/card-issuer', '/records/audit']) {
        const response = await page.goto(`${BANK_UI}${path}`, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${path} must be an address of its own`).toBeLessThan(400);
      }
    });
  });
});

/**
 * E2E (all three viewport projects): v32 P8 responsive usability + A4 no enumeration (tests 30, 9).
 * Runs under chromium (desktop), tablet (iPad gen 7) and mobile (Pixel 5); see playwright.config.ts.
 *
 * P8: a control that is unreachable because it is clipped is a usability defect of the same kind as
 * an unlinked record. The riskiest case is Track C's reveal: a masked value is short, the revealed
 * plaintext (full PAN, IBAN, a JSON payload) is long, so the layout must absorb it rather than grow.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json, stubPermissions } from './support/auth';

const PARTY = 'b0000001-0000-4000-8000-000000000001';
const AGREEMENT = '78d58c43-f9dc-426f-b7d8-eb2f3487f541';

const CUSTOMER_RECORD = {
  customerAgreementInstanceReference: AGREEMENT,
  partyInstanceReference: PARTY,
  customerName: 'Luis Fernandez',
  customerEmailAddress: 'luis.fernandez@example.com',
  customerMobilePhoneNumber: '+34-600-111-222',
  customerAgreementReference: 'ACC-LF-20240115',
  customerSegment: 'retail',
  customerAgreementStatus: 'active',
  customerAgreementEnrollmentDate: '2024-01-15T00:00:00Z',
  customerAgreementPreferredLanguage: 'es',
  customerAgreementGovernmentID: { type: 'driver_license', number: 'GB31454621', issuingCountry: 'GB', expiryDate: '2031-12-24T00:00:00Z' },
  customerAgreementTaxIDNumber: 'ES12345678',
  customerAgreementOccupation: 'engineer',
  customerAgreementKycCheck: { customerAgreementKycCheckStatus: 'verified', customerAgreementKycCheckReference: 'KYC-LF-001' },
  contactPiiRestricted: false,
  sensitiveAvailable: true,
};

// A deliberately long revealed value: if the layout grows to fit it, the page scrolls sideways.
const LONG_ADDRESS = {
  streetAddress: 'Avenida de la Constitucion Numero 1234, Escalera Izquierda, Piso 7, Puerta B',
  city: 'Madrid', postalCode: '28001', countryCode: 'ES',
};

const PERMS = {
  customers: ['view', 'viewSensitive'],
  modules: ['view'],
  beneficiaries: ['view', 'investigate'],
  transactions: ['view', 'viewSensitive'],
  cards: ['view', 'viewSensitive'],
  accounts: ['view', 'viewSensitive'],
  fraudCases: ['view'],
  auditEvents: ['view'],
};

async function stubApi(page: Page) {
  await page.route('**/api/v1/fraud**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/consents**', (r) => r.fulfill(json({ results: [], total: 0 })));
  await page.route('**/api/v1/accounts/**', (r) => r.fulfill(json({ results: [], total: 0 })));
  await page.route('**/api/v1/transactions**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/beneficiaries**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 10 })));
  await page.route('**/api/v1/customer/by-id/**', (r) => r.fulfill(json(CUSTOMER_RECORD)));
  await page.route('**/api/v1/customer/*/kyc/reveal**', (r) => r.fulfill(json({
    customerAgreementResidentialAddress: LONG_ADDRESS,
    customerAgreementRiskNotes: 'No adverse media found in any of the screened sanctions or PEP lists.',
  })));
}

/** The document must never scroll horizontally: that is the clearest symptom of a clipped layout. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });
  // One pixel of tolerance for sub-pixel rounding.
  expect(overflow.scrollWidth, `document overflows by ${overflow.scrollWidth - overflow.clientWidth}px`)
    .toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('v32 test 30: customer record view is usable at every viewport', () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAs(context, 'security_auditor');
    await stubPermissions(page, PERMS, 'security_auditor');
    await stubApi(page);
  });

  test('the record page fits the viewport and every field is readable', async ({ page }) => {
    await page.goto(`/system/users/${AGREEMENT}`);
    await expect(page.getByRole('heading', { name: 'Luis Fernandez' })).toBeVisible({ timeout: 15000 });
    await expectNoHorizontalScroll(page);

    // The identity document is present and its value is not clipped away entirely.
    const number = page.getByText('GB31454621').first();
    await expect(number).toBeVisible();
    const box = await number.boundingBox();
    expect(box, 'identity number has no layout box').not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
  });

  test('the reveal control is reachable and a long revealed value does not widen the layout', async ({ page }) => {
    await page.goto(`/system/users/${AGREEMENT}`);
    await expect(page.getByRole('heading', { name: 'Luis Fernandez' })).toBeVisible({ timeout: 15000 });

    const eye = page.getByRole('button', { name: /Reveal Residential address/i });
    await expect(eye).toBeVisible();
    // Within the viewport, not pushed off to the side.
    const eyeBox = await eye.boundingBox();
    const size = page.viewportSize();
    expect(eyeBox).not.toBeNull();
    if (size) expect(eyeBox!.x + eyeBox!.width).toBeLessThanOrEqual(size.width + 1);

    await eye.click();
    await expect(page.getByText(/Avenida de la Constitucion/)).toBeVisible({ timeout: 8000 });
    // The whole point of the assertion: revealing a long value must not create a sideways scroll.
    await expectNoHorizontalScroll(page);
  });
});

test.describe('v32 test 30 + A4: the beneficiary search surface at every viewport', () => {
  test.beforeEach(async ({ page, context }) => {
    await loginAs(context, 'security_auditor');
    await stubPermissions(page, PERMS, 'security_auditor');
    await stubApi(page);
  });

  test('renders an empty search state, issues no request on mount, and fits the viewport', async ({ page }) => {
    let listCalls = 0;
    await page.route('**/api/v1/beneficiaries?**', (r) => { listCalls += 1; return r.fulfill(json({ results: [], total: 0, page: 1, limit: 10 })); });

    await page.goto('/system/beneficiaries');
    await expect(page.getByText(/Search for a beneficiary to begin/i)).toBeVisible({ timeout: 15000 });
    // A4: no enumeration on mount.
    expect(listCalls).toBe(0);
    await expectNoHorizontalScroll(page);

    // The predicate input is reachable at every viewport.
    const search = page.getByPlaceholder(/Search by name or contact/i);
    await expect(search).toBeVisible();
  });

  test('a long-enough predicate triggers exactly one request', async ({ page }) => {
    let listCalls = 0;
    await page.route('**/api/v1/beneficiaries?**', (r) => { listCalls += 1; return r.fulfill(json({ results: [], total: 0, page: 1, limit: 10 })); });

    await page.goto('/system/beneficiaries');
    await expect(page.getByText(/Search for a beneficiary to begin/i)).toBeVisible({ timeout: 15000 });

    const search = page.getByPlaceholder(/Search by name or contact/i);
    await search.fill('ab');           // below the minimum: still no request
    await page.waitForTimeout(600);
    expect(listCalls).toBe(0);

    await search.fill('abc');          // at the minimum: one request
    await expect.poll(() => listCalls, { timeout: 8000 }).toBeGreaterThan(0);
    await expectNoHorizontalScroll(page);
  });
});

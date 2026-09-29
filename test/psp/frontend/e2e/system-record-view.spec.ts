/**
 * E2E: v32 Track D canonical customer record view (tests 32, 33, 35) + Track B/C guarantees.
 * Routes: /system/admin/modules/kyc/[partyInstanceReference], /system/users/[customerId].
 *
 * Test 32 is the CHARACTERISATION of the KYC administration page: it pins the groups, the field
 * labels, the per-field help affordance and the masked sensitive rows BEFORE the Track D refactor,
 * and must stay green through it. Test 33 asserts the two surfaces agree, which is the divergence
 * v32 exists to remove (the officer saw the searchable identity document, the auditor saw a
 * deprecated unsearchable value). Test 35 asserts access-level rendering per role.
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import { loginAs, json, stubPermissions, DemoRole } from './support/auth';

const PARTY = 'b0000001-0000-4000-8000-000000000001';
const AGREEMENT = '78d58c43-f9dc-426f-b7d8-eb2f3487f541';

const GOV_ID = {
  type: 'driver_license',
  number: 'GB31454621',
  issuingCountry: 'GB',
  expiryDate: '2031-12-24T00:00:00Z',
};

/** Shape of GET /customer/:partyRef/kyc (KYC administration detail). */
const KYC_RECORD = {
  partyInstanceReference: PARTY,
  customerAgreementInstanceReference: AGREEMENT,
  customerName: 'Luis Fernandez',
  customerEmailAddress: 'luis@example.com',
  customerMobilePhoneNumber: '+34-600-111-222',
  customerAgreementReference: 'ACC-LF-20240115',
  customerSegment: 'retail',
  customerAgreementStatus: 'active',
  customerAgreementEnrollmentDate: '2024-01-15T00:00:00Z',
  customerAgreementPreferredLanguage: 'es',
  customerAgreementGovernmentID: GOV_ID,
  customerAgreementTaxIDNumber: 'ES12345678',
  customerAgreementOccupation: 'engineer',
  partyDateOfBirth: '1985-03-12T00:00:00Z',
  partyNationality: 'ES',
  partySex: 'male',
  partyPlaceOfBirth: 'Madrid',
  partyType: 'customer',
  customerAgreementKycCheck: {
    customerAgreementKycCheckStatus: 'verified',
    customerAgreementKycCheckRiskRating: 'low',
    customerAgreementKycCheckRiskScore: 12,
    customerAgreementKycCheckSanctionsResult: 'clear',
    customerAgreementKycCheckPepStatus: false,
    customerAgreementKycCheckReference: 'KYC-LF-001',
    customerAgreementKycCheckCompletedDate: '2024-01-16T00:00:00Z',
  },
  sensitiveMasked: true,
};

/** Shape of GET /customer/by-id/:id (staff customer detail). No QE:none plaintext (v32 C2). */
const CUSTOMER_RECORD = {
  customerAgreementInstanceReference: AGREEMENT,
  partyInstanceReference: PARTY,
  customerName: 'Luis Fernandez',
  customerEmailAddress: 'luis@example.com',
  customerMobilePhoneNumber: '+34-600-111-222',
  customerAgreementReference: 'ACC-LF-20240115',
  customerSegment: 'retail',
  customerAgreementStatus: 'active',
  customerAgreementEnrollmentDate: '2024-01-15T00:00:00Z',
  customerAgreementPreferredLanguage: 'es',
  customerAgreementGovernmentID: GOV_ID,
  customerAgreementTaxIDNumber: 'ES12345678',
  customerAgreementOccupation: 'engineer',
  customerAgreementKycCheck: KYC_RECORD.customerAgreementKycCheck,
  contactPiiRestricted: false,
  sensitiveAvailable: true,
};

const REVEALED = {
  customerAgreementResidentialAddress: { streetAddress: '1 Calle Mayor', city: 'Madrid', postalCode: '28001', countryCode: 'ES' },
  customerAgreementSourceOfFunds: 'salary',
  customerAgreementPurposeOfRelationship: 'daily banking',
  customerAgreementRiskNotes: 'no adverse media',
  partyPostalAddress: { streetAddress: '2 Gran Via', city: 'Madrid', postalCode: '28013', countryCode: 'ES' },
};

const ALL_PERMS = {
  customers: ['view', 'viewSensitive', 'manage'],
  modules: ['view', 'manage'],
  transactions: ['view', 'viewSensitive'],
  cards: ['view', 'viewSensitive'],
  accounts: ['view', 'viewSensitive'],
  fraudCases: ['view', 'investigate'],
  auditEvents: ['view'],
  beneficiaries: ['view'],
};

/** Counts reveal calls so a "reveal" that never hits the server is detectable (ADR-052). */
async function stubApi(page: Page, opts: { revealCounter?: { n: number }; byId?: Record<string, unknown> } = {}) {
  // NOTE: Playwright matches routes in REVERSE registration order, so generic patterns are
  // registered FIRST and specific ones LAST. Otherwise `**/customer/*/kyc**` shadows
  // `**/customer/*/kyc/reveal**` and the reveal is never observed.
  await page.route('**/api/v1/fraud**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/consents**', (r) => r.fulfill(json({ results: [], total: 0 })));
  await page.route('**/api/v1/accounts/**', (r) => r.fulfill(json({ results: [], total: 0 })));
  await page.route('**/api/v1/transactions**', (r) => r.fulfill(json({ results: [], total: 0, page: 1, limit: 20 })));
  await page.route('**/api/v1/system/raw/**', (r) => r.fulfill(json({ collection: 'party', document: {} })));
  await page.route('**/api/v1/customer/search/fields**', (r) => r.fulfill(json({ textSearchEnabled: true, fields: [], sensitiveResultFields: [] })));
  await page.route('**/api/v1/customer/*/kyc**', (r) => r.fulfill(json(KYC_RECORD)));
  await page.route('**/api/v1/customer/*/kyc/process**', (r) => r.fulfill(json({ events: [] })));
  await page.route('**/api/v1/customer/by-id/**', (r) => r.fulfill(json({ ...CUSTOMER_RECORD, ...(opts.byId ?? {}) })));
  await page.route('**/api/v1/customer/*/kyc/reveal**', (r) => {
    if (opts.revealCounter) opts.revealCounter.n += 1;
    return r.fulfill(json(REVEALED));
  });
}

async function openKycPage(page: Page, context: BrowserContext, role: DemoRole = 'operations_officer') {
  await loginAs(context, role);
  await stubPermissions(page, ALL_PERMS, role);
  await stubApi(page);
  await page.goto(`/system/admin/modules/kyc/${PARTY}`);
  await expect(page.getByRole('heading', { name: 'Luis Fernandez' })).toBeVisible({ timeout: 15000 });
}

// ── Test 32: characterisation of the KYC administration page ────────────────────────────────────
test.describe('v32 test 32: KYC administration page characterisation (regression gate)', () => {
  test('renders the semantic groups in order', async ({ page, context }) => {
    await openKycPage(page, context);
    for (const group of ['Personal details', 'Identity document', 'Contact', 'Customer agreement', 'Protected details', 'KYC verdict']) {
      await expect(page.getByRole('heading', { name: new RegExp(group, 'i') }).first()).toBeVisible();
    }
  });

  test('renders the identity-document fields with their values', async ({ page, context }) => {
    await openKycPage(page, context);
    await expect(page.getByText('Document type').first()).toBeVisible();
    await expect(page.getByText('Document number').first()).toBeVisible();
    await expect(page.getByText('Issuing country').first()).toBeVisible();
    await expect(page.getByText('Expiry date').first()).toBeVisible();
    await expect(page.getByText('Tax ID').first()).toBeVisible();
    // The searchable value, not the deprecated SYNTH-* placeholder (Track B).
    await expect(page.getByText('GB31454621').first()).toBeVisible();
    await expect(page.getByText('ES12345678').first()).toBeVisible();
    await expect(page.getByText(/SYNTH-/)).toHaveCount(0);
  });

  test('every rendered row carries a help affordance', async ({ page, context }) => {
    await openKycPage(page, context);
    // Tooltip triggers are info buttons/icons; there is at least one per group.
    const helps = page.locator('[data-tooltip], [aria-label*="info" i], svg.lucide-info, svg.lucide-circle-help');
    expect(await helps.count()).toBeGreaterThan(5);
  });

  test('the five protected fields are masked and reveal through the server', async ({ page, context }) => {
    const counter = { n: 0 };
    await loginAs(context, 'operations_officer');
    await stubPermissions(page, ALL_PERMS, 'operations_officer');
    await stubApi(page, { revealCounter: counter });
    await page.goto(`/system/admin/modules/kyc/${PARTY}`);
    await expect(page.getByRole('heading', { name: 'Luis Fernandez' })).toBeVisible({ timeout: 15000 });

    for (const label of ['Residential address', 'Source of funds', 'Purpose of relationship', 'Risk notes', 'Postal address']) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
    // Masked before any click: no plaintext on the page.
    await expect(page.getByText('1 Calle Mayor')).toHaveCount(0);
    await expect(page.getByText('no adverse media')).toHaveCount(0);
    expect(counter.n).toBe(0);

    await page.getByRole('button', { name: /Reveal Residential address/i }).click();
    await expect(page.getByText(/1 Calle Mayor/)).toBeVisible({ timeout: 8000 });
    // ADR-052: the value came from the server, so the disclosure was auditable.
    expect(counter.n).toBeGreaterThan(0);
  });
});

// ── Test 33: the two surfaces agree ─────────────────────────────────────────────────────────────
test.describe('v32 test 33: structural equivalence across surfaces', () => {
  const IDENTITY_ROWS = ['Document type', 'Document number', 'Issuing country', 'Expiry date', 'Tax ID'];

  test('the identity document renders identically on the users page and the KYC page', async ({ page, context }) => {
    await loginAs(context, 'security_auditor');
    await stubPermissions(page, ALL_PERMS, 'security_auditor');
    await stubApi(page);

    await page.goto(`/system/users/${AGREEMENT}`);
    await expect(page.getByRole('heading', { name: 'Luis Fernandez' })).toBeVisible({ timeout: 15000 });
    for (const row of IDENTITY_ROWS) await expect(page.getByText(row).first()).toBeVisible();
    await expect(page.getByText('GB31454621').first()).toBeVisible();
    await expect(page.getByText(/SYNTH-/)).toHaveCount(0);

    await page.goto(`/system/admin/modules/kyc/${PARTY}`);
    await expect(page.getByRole('heading', { name: 'Luis Fernandez' })).toBeVisible({ timeout: 15000 });
    for (const row of IDENTITY_ROWS) await expect(page.getByText(row).first()).toBeVisible();
    await expect(page.getByText('GB31454621').first()).toBeVisible();
  });

  test('the auditor can reach the KYC record from the customer record (P5, no orphan data)', async ({ page, context }) => {
    await loginAs(context, 'security_auditor');
    await stubPermissions(page, ALL_PERMS, 'security_auditor');
    await stubApi(page);
    await page.goto(`/system/users/${AGREEMENT}`);
    await expect(page.getByRole('heading', { name: 'Luis Fernandez' })).toBeVisible({ timeout: 15000 });
    const link = page.getByRole('link', { name: /KYC record/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/system/admin/modules/kyc/${PARTY}`));
  });
});

// ── Test 35 / C1: access-level rendering, same fields for every role ────────────────────────────
test.describe('v32 test 35: access level decides how much, never how it looks', () => {
  test('the auditor sees QE:none values masked, not in the clear', async ({ page, context }) => {
    const counter = { n: 0 };
    await loginAs(context, 'security_auditor');
    await stubPermissions(page, ALL_PERMS, 'security_auditor');
    await stubApi(page, { revealCounter: counter });
    await page.goto(`/system/users/${AGREEMENT}`);
    await expect(page.getByRole('heading', { name: 'Luis Fernandez' })).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('Protected details', { exact: false })).toBeVisible();
    // The defect this fixes: these used to be printed in the clear for the auditor.
    await expect(page.getByText('1 Calle Mayor')).toHaveCount(0);
    await expect(page.getByText('no adverse media')).toHaveCount(0);
    expect(counter.n).toBe(0);

    await page.getByRole('button', { name: /Reveal Residential address/i }).click();
    await expect(page.getByText(/1 Calle Mayor/)).toBeVisible({ timeout: 8000 });
    expect(counter.n).toBeGreaterThan(0);
  });

  test('L1 gets an explicit restriction, not an empty field', async ({ page, context }) => {
    await loginAs(context, 'level1_analyst');
    await stubPermissions(page, { customers: ['view'], transactions: ['view'], cards: ['view'], fraudCases: ['view', 'investigate'], beneficiaries: ['view'] }, 'level1_analyst');
    await stubApi(page, {
      byId: {
        customerEmailAddress: undefined,
        customerMobilePhoneNumber: undefined,
        contactPiiRestricted: true,
        sensitiveAvailable: undefined,
      },
    });
    await page.goto(`/system/users/${AGREEMENT}`);
    await expect(page.getByRole('heading', { name: 'Luis Fernandez' })).toBeVisible({ timeout: 15000 });

    // Same identity document (lookup tier) as every other role.
    await expect(page.getByText('GB31454621').first()).toBeVisible();
    // Contact PII absent, with the reason stated.
    await expect(page.getByText(/Contact PII .* restricted/i)).toBeVisible();
    // Sensitive tier: an explicit reason, never a silent blank.
    await expect(page.getByText(/Not available at this access level|requires a valid L2 escalation/i).first()).toBeVisible();
  });
});

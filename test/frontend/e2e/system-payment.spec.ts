/**
 * E2E: Customer payment (FR-v1-01/03), new-payment wizard + history.
 * Routes: /system/payment, /system/payment/history.
 *
 * The payment wizard was redesigned: step 1 no longer offers preset saved-card
 * buttons; it presents a "New card" entry form (card number / MM/YY / CVV) that
 * is tokenized in-browser on Next. On Confirm the page POSTs /api/v1/transactions
 * (returns PENDING) and then awaits the terminal outcome over the per-transaction
 * SSE stream GET /api/v1/transactions/:id/stream.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, json } from './support/auth';

const PICKER = { total: 1, results: [
  { merchantAgreementInstanceReference: 'MA-1', merchantName: 'TechGadgets Ltd.', merchantCategoryCode: '5999', merchantRiskCategory: 'low' },
] };

// A Luhn-valid VISA test card that passes in-browser tokenization (cardTokenize.ts).
const TEST_CARD = { pan: '4242 4242 4242 4242', expiry: '12/34', cvv: '123' };

async function stubPicker(page: Page) {
  await page.route('**/api/v1/merchants/picker**', (r) => r.fulfill(json(PICKER)));
}

// No agreement → the page loads zero saved cards and defaults to new-card entry,
// keeping the wizard deterministic without depending on seeded customer data.
async function stubMe(page: Page) {
  await page.route('**/api/v1/auth/me', (r) => r.fulfill(json({
    sub: 'u-cust-001', email: 'luis.fernandez@back.es', name: 'Luis Fernandez',
    role: 'customer', domain: 'local', agreement: null,
  })));
}

// SSE frame carrying the terminal payment outcome that awaitPaymentOutcome() consumes.
function sseOutcome(outcome: Record<string, unknown>) {
  return { status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify(outcome)}\n\n` };
}

test.describe('FR-v1-01/03: new payment wizard', () => {
  test.beforeEach(async ({ page, context }) => {
    await stubPicker(page);
    await stubMe(page);
    await loginAs(context, 'customer');
  });

  test('renders step 1 with the card entry form and amount presets', async ({ page }) => {
    await page.goto('/system/payment');
    // Step indicator lists the three wizard steps.
    await expect(page.getByText('Card & amount')).toBeVisible({ timeout: 15000 });
    // New-card entry form is the current step-1 UI (no preset saved-card buttons).
    await expect(page.getByPlaceholder('Card number')).toBeVisible();
    await expect(page.getByPlaceholder('MM/YY')).toBeVisible();
    await expect(page.getByPlaceholder(/CVV/)).toBeVisible();
    // Amount preset + "Manage cards" affordance from the redesign.
    await expect(page.getByRole('button', { name: '$120.00' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage cards' })).toBeVisible();
  });

  // Drive the real wizard: enter a new card, pick an amount, advance to review, confirm.
  async function advanceToConfirmation(page: Page) {
    await page.goto('/system/payment');
    await expect(page.getByPlaceholder('Card number')).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder('Card number').fill(TEST_CARD.pan);
    await page.getByPlaceholder('MM/YY').fill(TEST_CARD.expiry);
    await page.getByPlaceholder(/CVV/).fill(TEST_CARD.cvv);
    await page.getByRole('button', { name: '$120.00' }).click();
    await page.getByRole('button', { name: /^Next/ }).click();
    // Step 2: review & describe → confirm.
    await expect(page.getByRole('button', { name: /Confirm Payment/i })).toBeVisible();
    await page.getByRole('button', { name: /Confirm Payment/i }).click();
  }

  test('completes the 3-step flow to a confirmation', async ({ page }) => {
    await page.route('**/api/v1/transactions/*/stream', (route) =>
      route.fulfill(sseOutcome({ status: 'authorized', fraudCaseCreated: false })));
    await page.route('**/api/v1/transactions', (route) => route.request().method() === 'POST'
      ? route.fulfill(json({ cardTransactionInstanceReference: 'txn-ok-1', cardTransactionStatus: 'pending' }, 201))
      : route.continue());
    await advanceToConfirmation(page);
    await expect(page.getByText(/Payment Confirmed/i)).toBeVisible({ timeout: 8000 });
    // Exact match: the sidebar's "Authorized Apps" link also contains the substring "Authorized",
    // which would otherwise trip Playwright strict mode.
    await expect(page.getByText('Authorized', { exact: true })).toBeVisible();
  });

  test('a fraud-flagged payment surfaces the fraud alert', async ({ page }) => {
    await page.route('**/api/v1/transactions/*/stream', (route) =>
      route.fulfill(sseOutcome({ status: 'authorized', fraudCaseCreated: true, caseId: 'FD-000009' })));
    await page.route('**/api/v1/transactions', (route) => route.request().method() === 'POST'
      ? route.fulfill(json({ cardTransactionInstanceReference: 'txn-fraud-1', cardTransactionStatus: 'pending' }, 201))
      : route.continue());
    await advanceToConfirmation(page);
    await expect(page.getByText(/Payment Confirmed/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/fraud|review|investigation/i).first()).toBeVisible({ timeout: 8000 });
    // Accepted, not completed: the amount is reserved until the review closes.
    await expect(page.getByText(/reserved on your account, not charged/i)).toBeVisible();
  });

  // A decline is a completed operation: it lands on the receipt with a link to the detail, never on
  // an inline error on the review step.
  test('a declined payment lands on the receipt with the operation detail link', async ({ page }) => {
    await page.route('**/api/v1/transactions/*/stream', (route) =>
      route.fulfill(sseOutcome({ status: 'declined', declineReason: 'insufficient_funds', fraudCaseCreated: false })));
    await page.route('**/api/v1/transactions', (route) => route.request().method() === 'POST'
      ? route.fulfill(json({ cardTransactionInstanceReference: 'txn-dec-1', cardTransactionStatus: 'pending' }, 201))
      : route.continue());
    await advanceToConfirmation(page);
    await expect(page.getByText(/Payment Not Completed/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Declined', { exact: true })).toBeVisible();
    await expect(page.getByText(/insufficient funds/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /your transactions/i })).toHaveAttribute('href', '/system/payment/history/txn-dec-1');
    await expect(page.getByRole('button', { name: /View Operation Detail/i })).toBeVisible();
  });
});

test.describe('FR-v1-01: payment history', () => {
  // v36 (ADR-063): the history reads the canonical collection, which returns normalized movement rows
  // for every kind. `/transactions/all` is gone.
  test('customer sees their transaction history', async ({ page, context }) => {
    await page.route('**/api/v1/transactions?**', (r) => r.fulfill(json({ page: 1, limit: 200, total: 2, results: [
      {
        kind: 'card', paymentExecutionInstanceReference: 'txn-h1', direction: 'sent',
        grossAmount: 42.5, currency: 'USD', paymentExecutionStatus: 'authorized', paymentExecutionRail: 'card',
        concept: 'TECHGADGETS', beneficiaryName: 'TechGadgets Ltd.', destinationAccountMasked: '****-****-****-4242',
        merchantCategoryCode: '5732', channel: 'online', initiatedAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T10:00:00Z',
        fraudCase: { created: false },
      },
      {
        kind: 'transfer', paymentExecutionInstanceReference: 'exec-h1', direction: 'sent',
        grossAmount: 90, currency: 'EUR', paymentExecutionStatus: 'completed', paymentExecutionRail: 'sepa',
        concept: 'Rent share', beneficiaryName: 'Carlos', destinationAccountMasked: 'ES12••••5477',
        initiatedAt: '2026-06-02T10:00:00Z', completedAt: '2026-06-02T11:00:00Z', fraudCase: { created: false },
      },
    ] })));
    await loginAs(context, 'customer');
    await page.goto('/system/payment/history');
    await expect(page.getByRole('heading', { name: 'Payment History', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('TechGadgets Ltd.').first()).toBeVisible({ timeout: 8000 });
    // One list, every movement kind: the transfer row comes from the same response.
    await expect(page.getByText('Rent share').first()).toBeVisible({ timeout: 8000 });
  });
});

/**
 * Regression (v36): the customer detail page used the 404 of GET /transactions/:id as the signal
 * "this reference is not a card payment, try the transfer / RTP endpoints". Once that route started
 * resolving EVERY movement kind, a transfer answered 200 with a movement row, the page took the card
 * branch and crashed on an undefined status. It must fall through to the transfer view instead.
 */
test.describe('customer detail page: a transfer reference', () => {
  const MOVEMENT_ROW = {
    kind: 'transfer', paymentExecutionInstanceReference: 'exec-c1', direction: 'sent',
    grossAmount: 800, currency: 'EUR', paymentExecutionStatus: 'pending', paymentExecutionRail: 'sepa',
    concept: 'Car deposit', beneficiaryName: 'Carlos', destinationAccountMasked: 'ES12••••5477',
    initiatedAt: '2026-07-08T09:20:00Z', completedAt: null, heldForReview: true,
  };
  const TRANSFER = {
    paymentExecutionInstanceReference: 'exec-c1',
    initiatorPartyReference: 'p-1', initiatorName: 'Luis Fernandez',
    beneficiaryPartyReference: 'p-2', beneficiaryName: 'Carlos',
    grossAmount: 800, netAmount: 800, feeAmount: 0, currency: 'EUR',
    paymentExecutionStatus: 'pending', paymentExecutionRail: 'sepa',
    routingNote: 'Car deposit',
    initiatedAt: '2026-07-08T09:20:00Z', direction: 'sent', fraudCase: null,
  };

  test('renders the transfer instead of crashing on a card-shaped read', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // The movement route answers 200 with the row (post-v36 behaviour), not 404.
    await page.route('**/api/v1/transactions/exec-c1', (r) => r.fulfill(json(MOVEMENT_ROW)));
    await page.route('**/api/v1/transactions/exec-c1/notes', (r) => r.fulfill(json({ caseFound: false, notes: [] })));
    await page.route('**/api/v1/accounts/transfer/exec-c1', (r) => r.fulfill(json(TRANSFER)));
    await page.route('**/api/v1/notifications**', (r) => r.fulfill(json({ count: 0, items: [] })));

    await loginAs(context, 'customer', { partyRef: 'p-1' });
    await page.goto('/system/payment/history/exec-c1');

    // The transfer view rendered, and nothing blew up.
    await expect(page.getByText(/Car deposit/i).first()).toBeVisible({ timeout: 15000 });
    expect(errors.filter((e) => /replace|undefined/i.test(e))).toEqual([]);
  });
});

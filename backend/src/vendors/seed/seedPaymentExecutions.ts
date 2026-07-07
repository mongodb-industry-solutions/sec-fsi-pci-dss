import { Db } from 'mongodb';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../../modules/gateway/models/paymentExecution.model';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../../modules/gateway/models/payoutAccount.model';

// Demo bank-transfer executions (SD-65) covering the three recipient-identity variants so the
// payment-history detail page (/system/payment/history/{ref}) shows a navigable link or full
// destination for each. All initiated by Luis (b0000001) from his default account.
//   1. To a saved beneficiary (SD-54 arrangement)      → links /system/beneficiaries/{cab…}
//   2. To a registered payout account (SD-66)          → links /system/accounts/{pau…}
//   3. To an unregistered external IBAN                → shows full IBAN (QE-encrypted at rest)
// destinationIban is QE:none — the seeder runs on the L2 encrypted client, so it is encrypted on insert.

const INITIATOR = 'b0000001-0000-4000-8000-000000000001';       // Luis
const SOURCE_ACCOUNT = 'pao00001-0000-4000-8000-000000000001';  // Luis' default (EUR)
const NOW = new Date('2026-07-01T10:00:00.000Z');

// v18: Espresso Works Ltd (SD-89) — merchant the commission fee is attributed to.
const ESPRESSO = 'm0000001-0000-4000-8000-000000000001';
const COMMISSION_RATE = 0.025;

// Build a merchant-commission execution (SD-65) with fee attribution (SD-89) so the merchant dashboard
// shows commissionRevenue after reseed. Deterministic; no balance movement (no source/resolved account).
function commissionExecution(ref: string, gross: number, collected: Date): PaymentExecutionProcedure {
  const feeAmount = Math.round(gross * COMMISSION_RATE * 100) / 100;
  return {
    paymentExecutionInstanceReference: ref,
    paymentOrderInstanceReference: ref,
    beneficiaryType: 'merchant',
    grossAmount: gross, netAmount: Math.round((gross - feeAmount) * 100) / 100, feeAmount, currency: 'EUR',
    fee: { feeMerchantReference: ESPRESSO, feeRateApplied: COMMISSION_RATE, feeCollectedDateTime: collected },
    paymentExecutionRail: 'sepa',
    paymentExecutionStatus: 'completed',
    initiatedAt: collected, completedAt: collected,
    resolutionLog: [{ stepName: 'merchant.commission.collected', stepOutcome: 'found', stepNote: `merchant=${ESPRESSO} rate=${COMMISSION_RATE}`, stepDateTime: collected }],
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: collected, recordUpdatedDateTime: collected, schemaVersion: 1,
  };
}

const DEMO_EXECUTIONS: PaymentExecutionProcedure[] = [
  // 1. Beneficiary transfer — Carlos (cab00002 → party b0000003 → account pau00007)
  {
    paymentExecutionInstanceReference: 'e0000001-0000-4000-8000-000000000001',
    paymentOrderInstanceReference:     'e0000001-0000-4000-8000-000000000001',
    beneficiaryType: 'user',
    initiatorPartyReference: INITIATOR,
    beneficiaryPartyReference: 'b0000003-0000-4000-8000-000000000003',
    beneficiaryArrangementReference: 'cab00002-0000-4000-8000-000000000002',
    sourcePayoutAccountReference: SOURCE_ACCOUNT,
    resolvedPayoutAccountReference: 'pau00007-0000-4000-8000-000000000007',
    grossAmount: 150, netAmount: 150, feeAmount: 0, currency: 'EUR',
    paymentExecutionRail: 'sepa',
    routingNote: 'Dinner split',
    paymentExecutionStatus: 'completed',
    initiatedAt: NOW, completedAt: new Date(NOW.getTime() + 3600_000),
    resolutionLog: [{ stepName: 'p2p.initiated', stepOutcome: 'found', stepNote: 'beneficiary=cab00002-0000-4000-8000-000000000002', stepDateTime: NOW }],
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: NOW, recordUpdatedDateTime: NOW, schemaVersion: 1,
  },
  // 2. Registered payout account destination (pau00001) — no beneficiary arrangement
  {
    paymentExecutionInstanceReference: 'e0000002-0000-4000-8000-000000000002',
    paymentOrderInstanceReference:     'e0000002-0000-4000-8000-000000000002',
    beneficiaryType: 'user',
    initiatorPartyReference: INITIATOR,
    sourcePayoutAccountReference: SOURCE_ACCOUNT,
    resolvedPayoutAccountReference: 'pau00001-0000-4000-8000-000000000001',
    grossAmount: 500, netAmount: 500, feeAmount: 0, currency: 'EUR',
    paymentExecutionRail: 'sepa',
    routingNote: 'Move to savings',
    paymentExecutionStatus: 'completed',
    initiatedAt: NOW, completedAt: new Date(NOW.getTime() + 3600_000),
    resolutionLog: [{ stepName: 'rail.selected', stepOutcome: 'found', stepNote: 'rail=sepa (registered account)', stepDateTime: NOW }],
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: NOW, recordUpdatedDateTime: NOW, schemaVersion: 1,
  },
  // 3. Unregistered external IBAN — full IBAN stored QE-encrypted, shown to the owner
  {
    paymentExecutionInstanceReference: 'e0000003-0000-4000-8000-000000000003',
    paymentOrderInstanceReference:     'e0000003-0000-4000-8000-000000000003',
    beneficiaryType: 'user',
    initiatorPartyReference: INITIATOR,
    sourcePayoutAccountReference: SOURCE_ACCOUNT,
    beneficiaryName: 'Marie Dubois',
    destinationIban: 'ES1215830001109043445477',
    destinationAccountMasked: 'ES12••••5477',
    destinationCountry: 'ES',
    grossAmount: 320, netAmount: 320, feeAmount: 0.35, currency: 'EUR',
    paymentExecutionRail: 'sepa',
    routingNote: 'Bank transfer: invoice 2026-118',
    paymentExecutionStatus: 'completed',
    initiatedAt: NOW, completedAt: new Date(NOW.getTime() + 3600_000),
    resolutionLog: [
      { stepName: 'rail.selected', stepOutcome: 'found', stepNote: 'rail=sepa (auto)', stepDateTime: NOW },
      { stepName: 'rail.validated', stepOutcome: 'found', stepNote: 'country=ES currency=EUR', stepDateTime: NOW },
    ],
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: NOW, recordUpdatedDateTime: NOW, schemaVersion: 1,
  },
  // v18: three Espresso Works commission executions across two months → dashboard revenue.
  commissionExecution('e0000101-0000-4000-8000-000000000101', 48.0, new Date('2026-06-12T09:00:00.000Z')),
  commissionExecution('e0000102-0000-4000-8000-000000000102', 120.0, new Date('2026-06-27T14:30:00.000Z')),
  commissionExecution('e0000103-0000-4000-8000-000000000103', 32.5, new Date('2026-07-03T11:15:00.000Z')),
];

export async function seedPaymentExecutions(db: Db) {
  const accountCol = db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION);
  let upserted = 0;
  for (const exec of DEMO_EXECUTIONS) {
    const res = await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
      { paymentExecutionInstanceReference: exec.paymentExecutionInstanceReference },
      { $set: exec },
      { upsert: true },
    );
    upserted++;

    // Apply the balance movement ONLY when the execution is newly inserted (idempotent across
    // reseeds), and only for settled (completed) transfers — so the seeded balances reconcile with
    // the account-movement ledger (opening deposit − Σ sent + Σ received). Debit the source; credit
    // an internal destination when present (external IBAN destinations leave the PSP → no credit).
    if (res.upsertedCount === 1 && exec.paymentExecutionStatus === 'completed') {
      if (exec.sourcePayoutAccountReference) {
        await accountCol.updateOne(
          { payoutAccountInstanceReference: exec.sourcePayoutAccountReference },
          { $inc: { 'payoutAccountBalance.availableAmount': -exec.netAmount }, $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date() } },
        );
      }
      if (exec.resolvedPayoutAccountReference) {
        await accountCol.updateOne(
          { payoutAccountInstanceReference: exec.resolvedPayoutAccountReference },
          { $inc: { 'payoutAccountBalance.availableAmount': exec.netAmount }, $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date() } },
        );
      }
    }
  }
  console.log(`  ${PAYMENT_EXECUTION_COLLECTION}: ${upserted} demo executions upserted (beneficiary / registered account / external IBAN); balances adjusted`);
}

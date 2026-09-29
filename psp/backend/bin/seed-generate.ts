/**
 * Generates synthetic seed data for all BIAN-compliant collections.
 * Run: ts-node bin/seed-generate.ts [--force]
 * Output: backend/data/*.json
 *
 * v2: *Sensitive files removed. Sensitive fields are inline in the main files.
 * The QE client (DEK-sensitive tier) encrypts them on write.
 *
 * v33 (F6): the generator is ADDITIVE and refuses to clobber. It loads the existing fixtures, keeps
 * every curated record exactly as it is, and only tops the synthetic population up to the target
 * size. `write()` refuses to reduce a collection's record count unless `--force` is passed. Before
 * v33 it rebuilt everything from scratch: since the fixtures had been hand-extended well past the
 * generator's targets, `npm run generate:data` silently deleted the curated demo cast.
 *
 * v33 (F5): the deprecated `governmentIdentificationReference` (`SYNTH-*`) is gone. Structured
 * identity documents come from `enrichKyc`, the same single source the seeder uses (ADR-050).
 *
 * v33 (F1/F2/F3): the shared, database-free integrity passes in `vendors/seed/dataIntegrity.ts` run
 * over the WHOLE population (curated plus generated) before the files are written, so the fixtures
 * themselves satisfy the invariants rather than relying on a runtime repair.
 *
 * BIAN collection mapping:
 *   parties.json                 → party (SD-13 Party Data Management)
 *   customerAgreements.json      → customerAgreementProcedure (SD-53) [includes address, govId]
 *   paymentCards.json            → paymentCardManagement (SD-88)
 *   payoutAccounts.json          → payoutAccountArrangement (SD-66)
 *   cardTransactions.json        → cardTransactionLog (SD-254) [includes gateway payload]
 *   fraudCases.json              → fraudDiagnosisCase (SD-83)
 *   fraudCaseEvents.json         → fraudDiagnosisCaseEvents (SD-83)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { faker } from '@faker-js/faker';
import { enrichKyc, type CustomerAgreementSeed } from '../src/vendors/seed/seedCustomers';
import {
  completeCustomerPopulation,
  repointTransactionsToCards,
  syncFraudCaseSnapshots,
  type AgreementSeed,
  type AuthenticationSeed,
  type CardSeed,
  type FraudCaseSeed,
  type PartySeed,
  type PayoutAccountSeed,
  type TransactionSeed,
} from '../src/vendors/seed/dataIntegrity';

// Honours the same PSP_SEED_DATA_DIR the seeder reads (config.app.seedDataDir), so the generator can
// be pointed at a temporary directory. Used by the integrity test to assert the no-shrink guard
// without touching the real fixtures.
const OUT_DIR = process.env.PSP_SEED_DATA_DIR ?? process.env.SEED_DATA_DIR ?? path.join(__dirname, '..', 'data');
const FORCE = process.argv.includes('--force');

// Target sizes for the SYNTHETIC population. They are floors, never ceilings: the fixtures hold more
// than this because the demo cast has been curated over many iterations, and that is fine.
const TARGET_CUSTOMERS = 50;
const TARGET_TRANSACTIONS_PER_CUSTOMER = 4;
const TARGET_FRAUD_CASES = 20;

function uuid(): string {
  return crypto.randomUUID();
}

function cardToken(): string {
  return `pm_${crypto.randomBytes(8).toString('hex')}`;
}

function maskedPan(): string {
  const last4 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `****-****-****-${last4}`;
}

function futureExpiry(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1 + Math.floor(Math.random() * 6 + 12)).padStart(2, '0');
  const year = String((now.getFullYear() + 2) % 100).padStart(2, '0');
  return `${month}/${year}`;
}

function caseRef(n: number): string {
  return `FD-2026-${String(n).padStart(6, '0')}`;
}

const NETWORKS = ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] as const;
const CHANNELS = ['online', 'pos', 'contactless', 'atm'] as const;
const STATUSES = ['authorized', 'settled', 'disputed'] as const;
const MCC_LIST = ['5812', '6011', '7995', '5734', '5411', '5912', '4814', '5999'];
const RISK_MCC = ['5812', '6011', '7995'];
const TX_TYPES = ['purchase', 'cash_advance', 'balance_transfer', 'refund', 'fee', 'adjustment'] as const;

const DESCRIPTOR_TEMPLATES = [
  (name: string) => `${name.toUpperCase().slice(0, 22)}`,
  (name: string) => `AMZN*${name.toUpperCase().slice(0, 17)}`,
  (name: string) => `SQ *${name.toUpperCase().slice(0, 18)}`,
  (name: string) => `PP*${name.toUpperCase().slice(0, 19)}`,
  (name: string) => `PAYPAL *${name.toUpperCase().slice(0, 14)}`,
];

function descriptorFor(merchantName: string, txType: string): { description: string; narrative: string } {
  const template = DESCRIPTOR_TEMPLATES[Math.floor(Math.random() * DESCRIPTOR_TEMPLATES.length)];
  const description = template(merchantName).slice(0, 22);
  const narrative = `${txType.replace('_', ' ').toUpperCase()} at ${merchantName} - ref ${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  return { description, narrative };
}

const NOW = new Date('2026-05-27T14:00:00Z');

// ── Additive fixture loading ──────────────────────────────────────────────────

/** Reads an existing fixture, or an empty population on a clean checkout. */
function load<T>(name: string): T[] {
  const filePath = path.join(OUT_DIR, name);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T[];
}

async function main() {

  // Curated population, kept verbatim. Everything below only appends.
  const parties = load<PartySeed>('parties.json');
  const customerAgreements = load<AgreementSeed>('customerAgreements.json');
  const paymentCards = load<CardSeed>('paymentCards.json');
  const payoutAccounts = load<PayoutAccountSeed>('payoutAccounts.json');
  const cardTransactions = load<TransactionSeed>('cardTransactions.json');
  const fraudCases = load<FraudCaseSeed>('fraudCases.json');
  const fraudCaseEvents = load<Record<string, unknown>>('fraudCaseEvents.json');

  const baseline = {
    'parties.json': parties.length,
    'customerAgreements.json': customerAgreements.length,
    'paymentCards.json': paymentCards.length,
    'payoutAccounts.json': payoutAccounts.length,
    'cardTransactions.json': cardTransactions.length,
    'fraudCases.json': fraudCases.length,
    'fraudCaseEvents.json': fraudCaseEvents.length,
  };

  const partyByEmail = new Map(parties.map((p) => [String(p.partyEmailAddress ?? '').toLowerCase(), p]));
  const takenEmails = new Set(partyByEmail.keys());
  const takenPhones = new Set(parties.map((p) => String(p.partyMobilePhoneNumber ?? '')).filter(Boolean));

  // -- 1. Parties (SD-13 Party Data Management) --------------------─
  // The three fixed staff parties the curated logins point at. Added only when absent.
  const employeeSpecs = [
    { partyEmailAddress: 'sarah.chen@back.es', partyMobilePhoneNumber: '+44 7900 000051', partyName: 'Sarah Chen' },
    { partyEmailAddress: 'michael.obi@back.es', partyMobilePhoneNumber: '+44 7900 000052', partyName: 'Michael Obi' },
    { partyEmailAddress: 'diego.sans@back.es', partyMobilePhoneNumber: '+44 7900 000053', partyName: 'Diego Sans' },
  ];

  for (const spec of employeeSpecs) {
    if (partyByEmail.has(spec.partyEmailAddress)) continue;
    const party: PartySeed = {
      partyInstanceReference: uuid(),
      ...spec,
      partyType: 'employee',
      partySex: 'unspecified',
      bianServiceDomain: 'Party Data Management',
      bianControlRecordType: 'Party',
      recordCreatedDateTime: NOW,
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    };
    parties.push(party);
    partyByEmail.set(spec.partyEmailAddress, party);
    takenEmails.add(spec.partyEmailAddress);
  }

  // Customer parties: top the synthetic population up to the floor. Each new party also gets an
  // SD-66 payout account, because a customer with no funding source cannot hold a card (D-3).
  const demoCustomers = [
    { partyEmailAddress: 'luis.fernandez@back.es', partyName: 'Luis Fernandez', partyMobilePhoneNumber: '+44 7900 000001' },
    { partyEmailAddress: 'julia.santos@back.es', partyName: 'Julia Santos', partyMobilePhoneNumber: '+44 7900 000002' },
  ];

  const newCustomerParties: PartySeed[] = [];
  const customerCount = () => parties.filter((p) => p.partyType === 'customer').length + newCustomerParties.length;

  while (customerCount() < TARGET_CUSTOMERS) {
    const demo = demoCustomers.find((d) => !takenEmails.has(d.partyEmailAddress));
    const email = demo?.partyEmailAddress ?? uniqueEmail(takenEmails);
    const name = demo?.partyName ?? faker.person.fullName();
    // faker v10 dropped the format-string overload of phone.number(); build the UK mobile shape explicitly.
    const phone = demo?.partyMobilePhoneNumber ?? uniquePhone(takenPhones);
    takenEmails.add(email);
    takenPhones.add(phone);

    const partyId = uuid();
    newCustomerParties.push({
      partyInstanceReference: partyId,
      partyEmailAddress: email,
      partyMobilePhoneNumber: phone,
      partyName: name,
      partyType: 'customer',
      partyDateOfBirth: faker.date.birthdate({ min: 18, max: 70, mode: 'age' }).toISOString().split('T')[0],
      partyNationality: 'GB',
      // SD-13 sex/gender demographic (QE:equality). Mostly male/female with a small share of
      // other/unspecified so the demo exercises the full vocabulary.
      partySex: faker.helpers.weightedArrayElement([
        { weight: 48, value: 'male' }, { weight: 48, value: 'female' },
        { weight: 2, value: 'other' }, { weight: 2, value: 'unspecified' },
      ]),
      bianServiceDomain: 'Party Data Management',
      bianControlRecordType: 'Party',
      recordCreatedDateTime: faker.date.past({ years: 2 }),
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    });

    payoutAccounts.push({
      payoutAccountInstanceReference: uuid(),
      partyInstanceReference: partyId,
      payoutAccountType: 'bank_account',
      payoutAccountStatus: 'active',
      payoutAccountIsDefault: true,
      payoutAccountAlias: 'Main account',
      payoutAccountBankName: 'Leafy Bank',
      payoutAccountCurrency: 'EUR',
      payoutAccountCountryCode: 'GB',
      payoutAccountPreferredRail: 'sepa',
      payoutAccountIban: faker.finance.iban({ countryCode: 'GB' }),
      payoutAccountBalance: {
        pendingAmount: 0,
        availableAmount: parseFloat((Math.random() * 8000 + 500).toFixed(2)),
        reservedAmount: 0,
        currency: 'EUR',
        lastUpdatedDateTime: NOW,
      },
      bianServiceDomain: 'Payment Initiation',
      bianControlRecordType: 'PayoutAccountArrangement',
      recordCreatedDateTime: NOW,
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    });
  }
  parties.push(...newCustomerParties);

  // -- 2. Customer authentication assessments (SD-91) ----------------
  // v39: logins are not generated here any more. Principals, their roles and their credentials
  // belong to the identity authority, which seeds them from its own fixtures into its own database.
  // Generating them here as well would produce a second set of people who look real to whoever
  // reads this database, and the two would drift the moment either side changed.

  // -- 3. F2 / D-3: complete every customer party --------------------
  // One code path serves both a freshly generated synthetic party and a curated one with a gap
  // (David Chen holds a login, a payout account and a merchant but no agreement and no card).
  const completion = completeCustomerPopulation(
    parties,
    customerAgreements,
    paymentCards,
    cardTransactions,
    payoutAccounts,
    { now: NOW },
  );
  // F5: structured identity documents from the single source (ADR-050). No SYNTH-* value is ever
  // written, and `governmentIdentificationReference` is stripped if a fixture still carries it.
  for (const agreement of completion.agreements) enrichKyc(agreement as CustomerAgreementSeed);
  customerAgreements.push(...completion.agreements);
  paymentCards.push(...completion.cards);
  cardTransactions.push(...completion.transactions);
  console.log(
    `  completeness: +${completion.agreements.length} agreements, +${completion.cards.length} cards, ` +
    `+${completion.transactions.length} transactions`,
  );

  // The curated agreements are deliberately NOT re-enriched: they already carry the v27 KYC leaves,
  // and seedCustomers enriches on write anyway, so touching them here would only rewrite curated
  // records (P7/F6: keep them byte-for-byte).

  // -- 4. Payment cards (SD-88) --------------------------------------
  // Card-on-file variety for the NEW agreements only: 3-4 cards each with a customer alias and one
  // preferred. Curated holders keep exactly the cards they have.
  const CARD_ALIASES = ['Personal', 'Work', 'Travel', 'Backup', 'Online shopping', 'Groceries', 'Subscriptions', 'Family', 'Everyday', 'Business'];
  const newAgreementRefs = new Set(completion.agreements.map((a) => a.customerAgreementInstanceReference));

  let cardIndex = 0;
  for (const agreement of completion.agreements) {
    const existing = paymentCards.filter(
      (c) => c.customerAgreementInstanceReference === agreement.customerAgreementInstanceReference,
    );
    const usedAliases = new Set(existing.map((c) => String(c.paymentCardAlias ?? '')));
    const target = 3 + (cardIndex % 2); // 3 or 4 cards
    for (let j = existing.length; j < target; j++) {
      let alias = CARD_ALIASES[(cardIndex + j) % CARD_ALIASES.length];
      let bump = 0;
      while (usedAliases.has(alias)) alias = CARD_ALIASES[(cardIndex + j + ++bump) % CARD_ALIASES.length];
      usedAliases.add(alias);
      paymentCards.push({
        paymentCardInstanceReference: uuid(),
        customerAgreementInstanceReference: agreement.customerAgreementInstanceReference,
        paymentCardReference: cardToken(),
        paymentCardExpirationDate: futureExpiry(),
        paymentCardMaskedPanDisplay: maskedPan(),
        paymentCardNetwork: NETWORKS[(cardIndex + j) % NETWORKS.length],
        paymentCardStatus: 'active',
        paymentCardIssuanceDateTime: faker.date.past({ years: 1 }),
        paymentCardIsPreferred: false,
        paymentCardAlias: alias,
        fundingPayoutAccountInstanceReference: existing[0]?.fundingPayoutAccountInstanceReference,
        bianServiceDomain: 'Payment Card',
        bianControlRecordType: 'PaymentCardManagement',
        recordCreatedDateTime: faker.date.past({ years: 1 }),
        schemaVersion: 1,
      });
    }
    cardIndex++;
  }

  // Shared cards (FDS/AML): one physical card (same token) held by several customers. One exceeds
  // the shared-card threshold (>3 holders) so it trips the compliance signal; the registry counts
  // distinct holders. Each holder gets their own arrangement row + alias. NOT a duplicate-token
  // defect: the SD-88 arrangement is keyed by (customer, token), which the unique compound index
  // enforces. Topped up to the holder count, never rebuilt.
  const SHARED_CARDS = [
    { token: 'pm_shared00000a4153', masked: '****-****-****-4153', network: 'VISA',       holders: 5 },
    { token: 'pm_shared00000b8821', masked: '****-****-****-8821', network: 'MASTERCARD', holders: 2 },
  ];
  const allAgreementRefs = customerAgreements.map((a) => a.customerAgreementInstanceReference);
  let sharedCursor = 0;
  for (const s of SHARED_CARDS) {
    const held = new Set(
      paymentCards.filter((c) => c.paymentCardReference === s.token).map((c) => c.customerAgreementInstanceReference),
    );
    while (held.size < s.holders && sharedCursor < allAgreementRefs.length * 2) {
      const agId = allAgreementRefs[sharedCursor % allAgreementRefs.length];
      sharedCursor++;
      if (held.has(agId)) continue;
      held.add(agId);
      const funding = paymentCards.find((c) => c.customerAgreementInstanceReference === agId)
        ?.fundingPayoutAccountInstanceReference;
      paymentCards.push({
        paymentCardInstanceReference: uuid(),
        customerAgreementInstanceReference: agId,
        paymentCardReference: s.token,
        paymentCardExpirationDate: futureExpiry(),
        paymentCardMaskedPanDisplay: s.masked,
        paymentCardNetwork: s.network,
        paymentCardStatus: 'active',
        paymentCardIssuanceDateTime: faker.date.past({ years: 1 }),
        paymentCardIsPreferred: false,
        paymentCardAlias: 'Shared',
        fundingPayoutAccountInstanceReference: funding,
        bianServiceDomain: 'Payment Card',
        bianControlRecordType: 'PaymentCardManagement',
        recordCreatedDateTime: faker.date.past({ years: 1 }),
        schemaVersion: 1,
      });
    }
  }

  // -- 5. Card transactions (SD-254) --------------------------------─
  // Topped up to the per-customer floor, spread over the new agreements first so a freshly generated
  // population has history everywhere.
  const targetTransactions = Math.max(
    cardTransactions.length,
    TARGET_TRANSACTIONS_PER_CUSTOMER * customerAgreements.length,
  );
  const spreadRefs = newAgreementRefs.size > 0
    ? customerAgreements.filter((a) => newAgreementRefs.has(a.customerAgreementInstanceReference))
    : customerAgreements;

  for (let i = 0; cardTransactions.length < targetTransactions; i++) {
    const agreement = spreadRefs[i % spreadRefs.length];
    const card = paymentCards.find(
      (c) => c.customerAgreementInstanceReference === agreement.customerAgreementInstanceReference,
    );
    if (!card) break; // nothing to attach a transaction to; F3 below would only flag it as unresolvable
    const amount = parseFloat((Math.random() * 1500 + 10).toFixed(2));
    const merchantName = faker.company.name();
    const txType = TX_TYPES[i % TX_TYPES.length];
    const { description, narrative } = descriptorFor(merchantName, txType);

    // v2: sensitive gateway fields (QE:none, DEK-sensitive tier) merged inline.
    cardTransactions.push({
      cardTransactionInstanceReference: uuid(),
      paymentCardReference: card.paymentCardReference,
      cardTransactionAccountReference: agreement.customerAgreementReference,
      rawGatewayPayload: {
        gatewayId: `GW-${uuid()}`,
        processorCode: `PROC${Math.floor(Math.random() * 9000 + 1000)}`,
        authCode: `AUTH${Math.floor(Math.random() * 900000 + 100000)}`,
      },
      processorTransactionMetadata: {
        networkId: 'VISA_NET',
        settlementDate: faker.date.soon({ days: 3 }),
        processingFlags: ['standard'],
      },
      cardTransactionAmount: { amount, currency: 'EUR' },
      cardTransactionDateTime: faker.date.recent({ days: 30 }),
      cardTransactionStatus: STATUSES[i % STATUSES.length],
      cardTransactionType: txType,
      cardTransactionChannel: CHANNELS[i % CHANNELS.length],
      cardTransactionInitiationType: 'customerInitiated',
      cardTransactionMerchantCategoryCode: MCC_LIST[i % MCC_LIST.length],
      cardTransactionMerchantName: merchantName,
      cardTransactionMaskedPanDisplay: card.paymentCardMaskedPanDisplay,
      cardTransactionDescription: description,
      cardTransactionNarrative: narrative,
      bianServiceDomain: 'Card Transaction',
      bianControlRecordType: 'CardTransactionLog',
      recordCreatedDateTime: faker.date.recent({ days: 30 }),
      recordUpdatedDateTime: NOW,
      schemaVersion: 3,
    });
  }

  // -- 6. Fraud cases + events (SD-83) ------------------------------
  // Topped up to the floor over transactions that do not already have a case.
  const casedTransactions = new Set(fraudCases.map((c) => c.cardTransactionInstanceReference));
  const usedCaseRefs = new Set(fraudCases.map((c) => String(c.fraudDiagnosisCaseReference ?? '')));
  const agreementByBusinessRef = new Map(customerAgreements.map((a) => [a.customerAgreementReference, a]));
  let caseCounter = 0;

  for (const txn of cardTransactions) {
    if (fraudCases.length >= TARGET_FRAUD_CASES) break;
    if (casedTransactions.has(txn.cardTransactionInstanceReference)) continue;
    const agreement = agreementByBusinessRef.get(txn.cardTransactionAccountReference);
    if (!agreement) continue;

    const amountValue = (txn.cardTransactionAmount as { amount: number }).amount;
    const mcc = String(txn.cardTransactionMerchantCategoryCode);
    const caseId = uuid();
    const isFraud = amountValue > 500 || RISK_MCC.includes(mcc);
    const severity = amountValue > 1000 ? 'critical' : amountValue > 500 ? 'high' : amountValue > 200 ? 'medium' : 'low';

    const riskIndicators: string[] = [];
    if (amountValue > 500) riskIndicators.push('amount_threshold');
    if (RISK_MCC.includes(mcc)) riskIndicators.push('high_risk_mcc');
    if (riskIndicators.length === 0) riskIndicators.push('manual_review');

    let ref = caseRef(++caseCounter);
    while (usedCaseRefs.has(ref)) ref = caseRef(++caseCounter);
    usedCaseRefs.add(ref);
    const index = fraudCases.length;

    fraudCases.push({
      fraudDiagnosisInstanceReference: caseId,
      fraudDiagnosisCaseReference: ref,
      cardTransactionInstanceReference: txn.cardTransactionInstanceReference,
      customerAgreementInstanceReference: agreement.customerAgreementInstanceReference,
      transactionSnapshot: {
        cardTransactionAmount: txn.cardTransactionAmount,
        cardTransactionMerchantName: txn.cardTransactionMerchantName,
        cardTransactionDateTime: txn.cardTransactionDateTime,
        cardTransactionStatus: txn.cardTransactionStatus,
        cardTransactionMaskedPanDisplay: txn.cardTransactionMaskedPanDisplay,
      },
      fraudDiagnosisCaseStatus: index < 5 ? 'open' : index < 10 ? 'under_review' : index < 15 ? 'escalated' : 'resolved_cleared',
      fraudDiagnosisCaseSeverity: severity,
      fraudDiagnosisRequestDateTime: txn.cardTransactionDateTime,
      fraudDiagnosisAssessment: {
        riskIndicators,
        fraudDiagnosisScore: Math.floor(Math.random() * 60 + 30),
        fraudDiagnosisConclusion: isFraud ? 'Suspicious activity detected' : 'Routine review',
      },
      bianServiceDomain: 'Fraud Diagnosis',
      bianControlRecordType: 'FraudDiagnosis',
      recordCreatedDateTime: txn.cardTransactionDateTime,
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    });
    casedTransactions.add(txn.cardTransactionInstanceReference);

    fraudCaseEvents.push({
      fraudDiagnosisInstanceReference: caseId,
      actionDateTime: txn.cardTransactionDateTime,
      actionType: 'case_opened',
      performedByInstanceReference: 'system',
      performedByRole: 'payment_service',
      actionDetails: { trigger: riskIndicators[0] ?? 'manual' },
      schemaVersion: 1,
    });
  }

  // -- 8. F3: the transaction-to-card link --------------------------
  const repoint = repointTransactionsToCards(cardTransactions, paymentCards, customerAgreements);
  const snapshots = syncFraudCaseSnapshots(fraudCases, cardTransactions);
  console.log(
    `  card link: ${repoint.repointed} transactions repointed, ${repoint.maskedPanAligned} masked PANs aligned, ` +
    `${snapshots} case snapshots refreshed, ${repoint.unresolvable.length} unresolvable`,
  );
  if (repoint.unresolvable.length > 0) {
    throw new Error(
      'Seed consistency check failed - transactions whose account reference resolves to no card holder:\n  - ' +
      repoint.unresolvable.slice(0, 10).join('\n  - '),
    );
  }

  // v39: the party-to-login drift guard moved with the logins.
  //
  // It checked that every login had a party whose email matched exactly, because the self-profile
  // lookup joins on that and a mismatch made a customer's own cards silently disappear. The logins
  // are the authority's now, so the check spans two systems and lives where both halves are
  // visible: the seed reconciliation test, which compares these parties against the migrated
  // principals. Keeping half of it here would check one side against nothing.

  // -- Write files --------------------------------------------------─
  // F6: refuse to shrink. A generator that produces fewer records than the fixtures hold is stale,
  // and overwriting would delete curated demo content. `--force` is the deliberate escape hatch.
  const shrunk: string[] = [];
  const write = (name: string, data: unknown[]) => {
    const before = baseline[name as keyof typeof baseline] ?? 0;
    if (data.length < before && !FORCE) {
      shrunk.push(`${name}: ${before} → ${data.length}`);
      return;
    }
    const filePath = path.join(OUT_DIR, name);
    // Trailing newline: the curated fixtures have one, so an unchanged collection stays a no-diff.
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`wrote ${filePath} (${data.length} records, was ${before})`);
  };

  write('parties.json', parties);
  write('customerAgreements.json', customerAgreements);
  write('paymentCards.json', paymentCards);
  write('payoutAccounts.json', payoutAccounts);
  write('cardTransactions.json', cardTransactions);
  write('fraudCases.json', fraudCases);
  write('fraudCaseEvents.json', fraudCaseEvents);

  if (shrunk.length > 0) {
    throw new Error(
      'Refusing to reduce a collection\'s record count (curated data would be lost):\n  - ' +
      `${shrunk.join('\n  - ')}\n  Re-run with --force only if the reduction is intended.`,
    );
  }

  console.log('Done.');
}

function uniqueEmail(taken: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const candidate = faker.internet.email().toLowerCase();
    if (!taken.has(candidate)) return candidate;
  }
  return `customer.${crypto.randomBytes(4).toString('hex')}@back.es`;
}

function uniquePhone(taken: Set<string>): string {
  for (let i = 0; i < 100; i++) {
    const candidate = `+44 7${faker.string.numeric(3)} ${faker.string.numeric(6)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `+44 7${crypto.randomInt(100, 999)} ${crypto.randomInt(100000, 999999)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

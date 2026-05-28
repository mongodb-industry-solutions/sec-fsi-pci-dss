/**
 * Generates synthetic seed data for all collections.
 * Run: ts-node data/generate.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';

const OUT_DIR = path.join(__dirname);

function uuid(): string {
  return crypto.randomUUID();
}

function cardToken(): string {
  return `tok_${crypto.randomBytes(8).toString('hex')}`;
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

function synthGovId(): string {
  return `SYNTH-${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
}

function caseRef(n: number): string {
  return `FD-2026-${String(n).padStart(6, '0')}`;
}

const NETWORKS = ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] as const;
const SEGMENTS = ['retail', 'premium', 'corporate', 'sme'] as const;
const CHANNELS = ['online', 'pos', 'contactless', 'atm'] as const;
const STATUSES = ['authorized', 'settled', 'disputed'] as const;
const MCC_LIST = ['5812', '6011', '7995', '5734', '5411', '5912', '4814', '5999'];
const RISK_MCC = ['5812', '6011', '7995'];

const NOW = new Date('2026-05-27T14:00:00Z');

async function main() {
  // ── 1. Demo users ────────────────────────────────────────────────
  const demoPassword = await bcrypt.hash('demo-password', 12);
  const users = [
    {
      partyAuthenticationInstanceReference: uuid(),
      partyAuthenticationUserEmailAddress: 'luis.fernandez@leafybank.demo',
      partyAuthenticationCredentialHash: demoPassword,
      partyAuthenticationUserRole: 'customer',
      partyAuthenticationUserName: 'Luis Fernandez',
      partyAuthenticationLoginDomain: 'local',
      partyAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'PartyAuthentication',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
    {
      partyAuthenticationInstanceReference: uuid(),
      partyAuthenticationUserEmailAddress: 'julia.santos@leafybank.demo',
      partyAuthenticationCredentialHash: demoPassword,
      partyAuthenticationUserRole: 'customer',
      partyAuthenticationUserName: 'Julia Santos',
      partyAuthenticationLoginDomain: 'local',
      partyAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'PartyAuthentication',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
    {
      partyAuthenticationInstanceReference: uuid(),
      partyAuthenticationUserEmailAddress: 'sarah.chen@leafybank.demo',
      partyAuthenticationCredentialHash: demoPassword,
      partyAuthenticationUserRole: 'level1_analyst',
      partyAuthenticationUserName: 'Sarah Chen',
      partyAuthenticationLoginDomain: 'local',
      partyAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'PartyAuthentication',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
    {
      partyAuthenticationInstanceReference: uuid(),
      partyAuthenticationUserEmailAddress: 'michael.obi@leafybank.demo',
      partyAuthenticationCredentialHash: demoPassword,
      partyAuthenticationUserRole: 'level2_investigator',
      partyAuthenticationUserName: 'Michael Obi',
      partyAuthenticationLoginDomain: 'local',
      partyAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'PartyAuthentication',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
    {
      partyAuthenticationInstanceReference: uuid(),
      partyAuthenticationUserEmailAddress: 'admin@leafybank.demo',
      partyAuthenticationCredentialHash: demoPassword,
      partyAuthenticationUserRole: 'security_auditor',
      partyAuthenticationUserName: 'Admin',
      partyAuthenticationLoginDomain: 'local',
      partyAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'PartyAuthentication',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
  ];

  // ── 2. Customer agreements ────────────────────────────────────────
  const customerIds: string[] = [];
  const customerAgreementRefs: string[] = [];
  const customerAgreements = [];
  const customerAgreementsSensitive = [];

  for (let i = 0; i < 50; i++) {
    const id = uuid();
    const ref = `ACC-${String(i + 1).padStart(3, '0')}`;
    customerIds.push(id);
    customerAgreementRefs.push(ref);

    customerAgreements.push({
      customerAgreementInstanceReference: id,
      customerEmailAddress: faker.internet.email().toLowerCase(),
      customerMobilePhoneNumber: faker.phone.number('+44 7### ######'),
      customerAgreementReference: ref,
      customerName: faker.person.fullName(),
      customerSegment: SEGMENTS[i % SEGMENTS.length],
      customerAgreementStatus: 'active',
      customerAgreementEnrollmentDate: faker.date.past({ years: 2 }),
      customerAgreementPreferredLanguage: 'en',
      bianServiceDomain: 'CustomerAgreement',
      bianControlRecordType: 'CustomerAgreement',
      recordCreatedDateTime: faker.date.past({ years: 2 }),
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    });

    customerAgreementsSensitive.push({
      customerAgreementInstanceReference: id,
      customerAgreementResidentialAddress: {
        streetAddress: faker.location.streetAddress(),
        city: faker.location.city(),
        postalCode: faker.location.zipCode(),
        countryCode: 'GB',
      },
      governmentIdentificationReference: synthGovId(),
      customerAgreementRiskNotes: 'No prior fraud history.',
      schemaVersion: 1,
    });
  }

  // ── 3. Payment cards ──────────────────────────────────────────────
  const cardTokenMap: Record<string, string> = {};
  const paymentCards = [];

  for (let i = 0; i < 50; i++) {
    const cardId = uuid();
    const token = cardToken();
    cardTokenMap[customerIds[i]] = token;

    paymentCards.push({
      paymentCardInstanceReference: cardId,
      customerAgreementInstanceReference: customerIds[i],
      paymentCardReference: token,
      paymentCardExpirationDate: futureExpiry(),
      paymentCardMaskedPanDisplay: maskedPan(),
      paymentCardNetwork: NETWORKS[i % NETWORKS.length],
      paymentCardStatus: 'active',
      paymentCardIssuanceDateTime: faker.date.past({ years: 1 }),
      paymentCardIsPreferred: false,
      bianServiceDomain: 'PaymentCard',
      bianControlRecordType: 'PaymentCardManagement',
      recordCreatedDateTime: faker.date.past({ years: 1 }),
      schemaVersion: 1,
    });
  }

  // ── 4. Card transactions ──────────────────────────────────────────
  const txnIds: string[] = [];
  const cardTransactions = [];
  const cardTransactionsSensitive = [];

  for (let i = 0; i < 200; i++) {
    const txnId = uuid();
    const custIdx = i % 50;
    const token = cardTokenMap[customerIds[custIdx]];
    const amount = parseFloat((Math.random() * 1500 + 10).toFixed(2));
    const mcc = MCC_LIST[i % MCC_LIST.length];
    txnIds.push(txnId);

    cardTransactions.push({
      cardTransactionInstanceReference: txnId,
      paymentCardReference: token,
      cardTransactionAccountReference: customerAgreementRefs[custIdx],
      cardTransactionAmount: { amount, currency: 'USD' },
      cardTransactionDateTime: faker.date.recent({ days: 30 }),
      cardTransactionStatus: STATUSES[i % STATUSES.length],
      cardTransactionChannel: CHANNELS[i % CHANNELS.length],
      cardTransactionInitiationType: 'customerInitiated',
      cardTransactionMerchantCategoryCode: mcc,
      cardTransactionMerchantName: faker.company.name(),
      cardTransactionMaskedPanDisplay: paymentCards[custIdx].paymentCardMaskedPanDisplay,
      bianServiceDomain: 'CardTransaction',
      bianControlRecordType: 'CardTransactionLog',
      recordCreatedDateTime: faker.date.recent({ days: 30 }),
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    });

    cardTransactionsSensitive.push({
      cardTransactionInstanceReference: txnId,
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
      schemaVersion: 1,
    });
  }

  // ── 5. Fraud cases + events ───────────────────────────────────────
  const fraudCases = [];
  const fraudCaseEvents = [];

  for (let i = 0; i < 20; i++) {
    const txn = cardTransactions[i];
    const custId = customerIds[i % 50];
    const caseId = uuid();
    const isFraud = txn.cardTransactionAmount.amount > 500 || RISK_MCC.includes(txn.cardTransactionMerchantCategoryCode);
    const severity = txn.cardTransactionAmount.amount > 1000 ? 'critical'
      : txn.cardTransactionAmount.amount > 500 ? 'high'
      : txn.cardTransactionAmount.amount > 200 ? 'medium' : 'low';

    const riskIndicators: string[] = [];
    if (txn.cardTransactionAmount.amount > 500) riskIndicators.push('amount_threshold');
    if (RISK_MCC.includes(txn.cardTransactionMerchantCategoryCode)) riskIndicators.push('high_risk_mcc');
    if (riskIndicators.length === 0) riskIndicators.push('manual_review');

    fraudCases.push({
      fraudDiagnosisInstanceReference: caseId,
      fraudDiagnosisCaseReference: caseRef(i + 1),
      linkedCardTransactionReference: txnIds[i],
      linkedCustomerAgreementReference: custId,

      // Extended Reference Pattern: stable display fields from cardTransaction
      transactionSnapshot: {
        cardTransactionAmount: txn.cardTransactionAmount,
        cardTransactionMerchantName: txn.cardTransactionMerchantName,
        cardTransactionDateTime: txn.cardTransactionDateTime,
        cardTransactionStatus: txn.cardTransactionStatus,
        cardTransactionMaskedPanDisplay: txn.cardTransactionMaskedPanDisplay,
      },

      fraudDiagnosisCaseStatus: i < 5 ? 'open' : i < 10 ? 'under_review' : i < 15 ? 'escalated' : 'resolved_cleared',
      fraudDiagnosisCaseSeverity: severity,
      fraudDiagnosisRequestDateTime: txn.cardTransactionDateTime,
      fraudDiagnosisAssessment: {
        riskIndicators,
        fraudDiagnosisScore: Math.floor(Math.random() * 60 + 30),
        fraudDiagnosisConclusion: isFraud ? 'Suspicious activity detected' : 'Routine review',
      },
      bianServiceDomain: 'FraudDiagnosis',
      bianControlRecordType: 'FraudDiagnosis',
      recordCreatedDateTime: txn.cardTransactionDateTime,
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    });

    // Audit event in separate collection (Unbounded Array anti-pattern fix)
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

  // ── Write files ───────────────────────────────────────────────────
  const write = (name: string, data: unknown[]) => {
    const filePath = path.join(OUT_DIR, name);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`wrote ${filePath} (${data.length} records)`);
  };

  write('users.json', users);
  write('customerAgreements.json', customerAgreements);
  write('customerAgreementsSensitive.json', customerAgreementsSensitive);
  write('paymentCards.json', paymentCards);
  write('cardTransactions.json', cardTransactions);
  write('cardTransactionsSensitive.json', cardTransactionsSensitive);
  write('fraudCases.json', fraudCases);
  write('fraudCaseEvents.json', fraudCaseEvents);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

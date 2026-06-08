/**
 * Generates synthetic seed data for all BIAN-compliant collections.
 * Run: ts-node bin/generate.ts
 * Output: backend/data/*.json
 *
 * v2: *Sensitive files removed. Sensitive fields are inline in the main files.
 * The QE client (DEK-sensitive tier) encrypts them on write.
 *
 * BIAN collection mapping:
 *   parties.json                 → party (SD-13 Party Data Management)
 *   customerAuthentications.json → customerAuthenticationAssessment (SD-91)
 *   customerAgreements.json      → customerAgreementProcedure (SD-53) [includes address, govId]
 *   paymentCards.json            → paymentCardManagement (SD-88)
 *   cardTransactions.json        → cardTransactionLog (SD-254) [includes gateway payload]
 *   fraudCases.json              → fraudDiagnosisCase (SD-83)
 *   fraudCaseEvents.json         → fraudDiagnosisCaseEvents (SD-83)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';

const OUT_DIR = path.join(__dirname, '..', 'data');

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
  const demoPassword = await bcrypt.hash('demo-password', 12);

  // ── 1. Parties (SD-13 Party Data Management) ─────────────────────
  // 50 customer parties + 3 employee parties
  const customerPartyIds: string[] = [];
  const customerEmails: string[] = [];
  const customerPhones: string[] = [];
  const customerNames: string[] = [];

  const parties = [];

  // Fixed employee parties (linked to customerAuthentications)
  const employeeParties = [
    {
      partyInstanceReference: uuid(),
      partyEmailAddress: 'sarah.chen@leafybank.demo',
      partyMobilePhoneNumber: '+44 7900 000051',
      partyName: 'Sarah Chen',
      partyType: 'employee',
    },
    {
      partyInstanceReference: uuid(),
      partyEmailAddress: 'michael.obi@leafybank.demo',
      partyMobilePhoneNumber: '+44 7900 000052',
      partyName: 'Michael Obi',
      partyType: 'employee',
    },
    {
      partyInstanceReference: uuid(),
      partyEmailAddress: 'diego.sans@leafybank.demo',
      partyMobilePhoneNumber: '+44 7900 000053',
      partyName: 'Diego Sans',
      partyType: 'employee',
    },
  ];

  // 50 customer parties (first 2 linked to demo customer auth users)
  const demoCustomerEmails = ['luis.fernandez@leafybank.demo', 'julia.santos@leafybank.demo'];
  const demoCustomerNames = ['Luis Fernandez', 'Julia Santos'];
  const demoCustomerPhones = ['+44 7900 000001', '+44 7900 000002'];

  for (let i = 0; i < 50; i++) {
    const partyId = uuid();
    const email = i < 2 ? demoCustomerEmails[i] : faker.internet.email().toLowerCase();
    const name = i < 2 ? demoCustomerNames[i] : faker.person.fullName();
    const phone = i < 2 ? demoCustomerPhones[i] : faker.phone.number('+44 7### ######');

    customerPartyIds.push(partyId);
    customerEmails.push(email);
    customerPhones.push(phone);
    customerNames.push(name);

    parties.push({
      partyInstanceReference: partyId,
      partyEmailAddress: email,
      partyMobilePhoneNumber: phone,
      partyName: name,
      partyType: 'customer',
      partyDateOfBirth: faker.date.birthdate({ min: 18, max: 70, mode: 'age' }).toISOString().split('T')[0],
      partyNationality: 'GB',
      bianServiceDomain: 'Party Data Management',
      bianControlRecordType: 'Party',
      recordCreatedDateTime: faker.date.past({ years: 2 }),
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    });
  }

  for (const ep of employeeParties) {
    parties.push({
      ...ep,
      bianServiceDomain: 'Party Data Management',
      bianControlRecordType: 'Party',
      recordCreatedDateTime: NOW,
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    });
  }

  // ── 2. Customer authentication assessments (SD-91) ────────────────
  const customerAuthentications = [
    {
      customerAuthenticationInstanceReference: uuid(),
      partyInstanceReference: customerPartyIds[0],
      customerAuthenticationEmailAddress: 'luis.fernandez@leafybank.demo',
      customerAuthenticationCredentialHash: demoPassword,
      customerAuthenticationUserRole: 'customer',
      customerAuthenticationUserName: 'Luis Fernandez',
      customerAuthenticationLoginDomain: 'local',
      customerAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'Customer Authentication',
      bianControlRecordType: 'CustomerAuthenticationAssessment',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
    {
      customerAuthenticationInstanceReference: uuid(),
      partyInstanceReference: customerPartyIds[1],
      customerAuthenticationEmailAddress: 'julia.santos@leafybank.demo',
      customerAuthenticationCredentialHash: demoPassword,
      customerAuthenticationUserRole: 'customer',
      customerAuthenticationUserName: 'Julia Santos',
      customerAuthenticationLoginDomain: 'local',
      customerAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'Customer Authentication',
      bianControlRecordType: 'CustomerAuthenticationAssessment',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
    {
      customerAuthenticationInstanceReference: uuid(),
      partyInstanceReference: employeeParties[0].partyInstanceReference,
      customerAuthenticationEmailAddress: 'sarah.chen@leafybank.demo',
      customerAuthenticationCredentialHash: demoPassword,
      customerAuthenticationUserRole: 'level1_analyst',
      customerAuthenticationUserName: 'Sarah Chen',
      customerAuthenticationLoginDomain: 'local',
      customerAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'Customer Authentication',
      bianControlRecordType: 'CustomerAuthenticationAssessment',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
    {
      customerAuthenticationInstanceReference: uuid(),
      partyInstanceReference: employeeParties[1].partyInstanceReference,
      customerAuthenticationEmailAddress: 'michael.obi@leafybank.demo',
      customerAuthenticationCredentialHash: demoPassword,
      customerAuthenticationUserRole: 'level2_investigator',
      customerAuthenticationUserName: 'Michael Obi',
      customerAuthenticationLoginDomain: 'local',
      customerAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'Customer Authentication',
      bianControlRecordType: 'CustomerAuthenticationAssessment',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
    {
      customerAuthenticationInstanceReference: uuid(),
      partyInstanceReference: employeeParties[2].partyInstanceReference,
      customerAuthenticationEmailAddress: 'diego.sans@leafybank.demo',
      customerAuthenticationCredentialHash: demoPassword,
      customerAuthenticationUserRole: 'security_auditor',
      customerAuthenticationUserName: 'Diego Sans',
      customerAuthenticationLoginDomain: 'local',
      customerAuthenticationAccountStatus: 'active',
      bianServiceDomain: 'Customer Authentication',
      bianControlRecordType: 'CustomerAuthenticationAssessment',
      recordCreatedDateTime: NOW,
      schemaVersion: 1,
    },
  ];

  // ── 3. Customer agreements (SD-53) ───────────────────────────────
  // PII removed: email, phone, name now live in party (SD-13)
  const customerAgreementIds: string[] = [];
  const customerAgreementRefs: string[] = [];
  const customerAgreements = [];

  for (let i = 0; i < 50; i++) {
    const id = uuid();
    const ref = `ACC-${String(i + 1).padStart(3, '0')}`;
    customerAgreementIds.push(id);
    customerAgreementRefs.push(ref);

    // v2: sensitive fields (QE:none, DEK-sensitive tier) merged inline.
    // The L2 QE client encrypts them on seed write; L1 client returns Binary.
    customerAgreements.push({
      customerAgreementInstanceReference: id,
      partyInstanceReference: customerPartyIds[i],
      customerAgreementReference: ref,
      customerAgreementResidentialAddress: {
        streetAddress: faker.location.streetAddress(),
        city: faker.location.city(),
        postalCode: faker.location.zipCode(),
        countryCode: 'GB',
      },
      governmentIdentificationReference: synthGovId(),
      customerAgreementRiskNotes: 'No prior fraud history.',
      customerSegment: SEGMENTS[i % SEGMENTS.length],
      customerAgreementStatus: 'active',
      customerAgreementEnrollmentDate: faker.date.past({ years: 2 }),
      customerAgreementPreferredLanguage: 'en',
      customerAgreementPreferredPaymentCardReference: null,
      bianServiceDomain: 'Customer Agreement',
      bianControlRecordType: 'CustomerAgreementProcedure',
      recordCreatedDateTime: faker.date.past({ years: 2 }),
      recordUpdatedDateTime: NOW,
      schemaVersion: 2,
    });
  }

  // ── 4. Payment cards (SD-88) ──────────────────────────────────────
  const cardTokenMap: Record<string, string> = {};
  const paymentCards = [];

  for (let i = 0; i < 50; i++) {
    const cardId = uuid();
    const token = cardToken();
    cardTokenMap[customerAgreementIds[i]] = token;

    paymentCards.push({
      paymentCardInstanceReference: cardId,
      customerAgreementInstanceReference: customerAgreementIds[i],
      paymentCardReference: token,
      paymentCardExpirationDate: futureExpiry(),
      paymentCardMaskedPanDisplay: maskedPan(),
      paymentCardNetwork: NETWORKS[i % NETWORKS.length],
      paymentCardStatus: 'active',
      paymentCardIssuanceDateTime: faker.date.past({ years: 1 }),
      paymentCardIsPreferred: false,
      bianServiceDomain: 'Payment Card',
      bianControlRecordType: 'PaymentCardManagement',
      recordCreatedDateTime: faker.date.past({ years: 1 }),
      schemaVersion: 1,
    });
  }

  // Update preferred card reference on agreements
  for (let i = 0; i < 50; i++) {
    customerAgreements[i].customerAgreementPreferredPaymentCardReference = paymentCards[i].paymentCardInstanceReference as unknown as null;
  }

  // ── 5. Card transactions (SD-254) ─────────────────────────────────
  const txnIds: string[] = [];
  const cardTransactions = [];

  for (let i = 0; i < 200; i++) {
    const txnId = uuid();
    const custIdx = i % 50;
    const token = cardTokenMap[customerAgreementIds[custIdx]];
    const amount = parseFloat((Math.random() * 1500 + 10).toFixed(2));
    const mcc = MCC_LIST[i % MCC_LIST.length];
    txnIds.push(txnId);

    // v2: sensitive gateway fields (QE:none, DEK-sensitive tier) merged inline.
    cardTransactions.push({
      cardTransactionInstanceReference: txnId,
      paymentCardReference: token,
      cardTransactionAccountReference: customerAgreementRefs[custIdx],
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
      cardTransactionAmount: { amount, currency: 'USD' },
      cardTransactionDateTime: faker.date.recent({ days: 30 }),
      cardTransactionStatus: STATUSES[i % STATUSES.length],
      cardTransactionChannel: CHANNELS[i % CHANNELS.length],
      cardTransactionInitiationType: 'customerInitiated',
      cardTransactionMerchantCategoryCode: mcc,
      cardTransactionMerchantName: faker.company.name(),
      cardTransactionMaskedPanDisplay: paymentCards[custIdx].paymentCardMaskedPanDisplay,
      bianServiceDomain: 'Card Transaction',
      bianControlRecordType: 'CardTransactionLog',
      recordCreatedDateTime: faker.date.recent({ days: 30 }),
      recordUpdatedDateTime: NOW,
      schemaVersion: 2,
    });
  }

  // ── 6. Fraud cases + events (SD-83) ──────────────────────────────
  const fraudCases = [];
  const fraudCaseEvents = [];

  for (let i = 0; i < 20; i++) {
    const txn = cardTransactions[i];
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
      cardTransactionInstanceReference: txnIds[i],
      customerAgreementInstanceReference: customerAgreementIds[i % 50],
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
      bianServiceDomain: 'Fraud Diagnosis',
      bianControlRecordType: 'FraudDiagnosis',
      recordCreatedDateTime: txn.cardTransactionDateTime,
      recordUpdatedDateTime: NOW,
      schemaVersion: 1,
    });

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

  write('parties.json', parties);
  write('customerAuthentications.json', customerAuthentications);
  write('customerAgreements.json', customerAgreements);
  write('paymentCards.json', paymentCards);
  write('cardTransactions.json', cardTransactions);
  write('fraudCases.json', fraudCases);
  write('fraudCaseEvents.json', fraudCaseEvents);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

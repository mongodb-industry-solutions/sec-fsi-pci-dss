/**
 * Generates synthetic seed data for all BIAN-compliant collections.
 * Run: ts-node bin/seed-generate.ts
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

async function main() {
  const demoPassword = await bcrypt.hash('demo-password', 12);

  // -- 1. Parties (SD-13 Party Data Management) --------------------─
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
      partyEmailAddress: 'sarah.chen@back.es',
      partyMobilePhoneNumber: '+44 7900 000051',
      partyName: 'Sarah Chen',
      partyType: 'employee',
    },
    {
      partyInstanceReference: uuid(),
      partyEmailAddress: 'michael.obi@back.es',
      partyMobilePhoneNumber: '+44 7900 000052',
      partyName: 'Michael Obi',
      partyType: 'employee',
    },
    {
      partyInstanceReference: uuid(),
      partyEmailAddress: 'diego.sans@back.es',
      partyMobilePhoneNumber: '+44 7900 000053',
      partyName: 'Diego Sans',
      partyType: 'employee',
    },
  ];

  // 50 customer parties (first 2 linked to demo customer auth users)
  const demoCustomerEmails = ['luis.fernandez@back.es', 'julia.santos@back.es'];
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

  // -- 2. Customer authentication assessments (SD-91) ----------------
  const customerAuthentications = [
    {
      customerAuthenticationInstanceReference: uuid(),
      partyInstanceReference: customerPartyIds[0],
      customerAuthenticationEmailAddress: 'luis.fernandez@back.es',
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
      customerAuthenticationEmailAddress: 'julia.santos@back.es',
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
      customerAuthenticationEmailAddress: 'sarah.chen@back.es',
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
      customerAuthenticationEmailAddress: 'michael.obi@back.es',
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
      customerAuthenticationEmailAddress: 'diego.sans@back.es',
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

  // -- 3. Customer agreements (SD-53) ------------------------------─
  // PII removed: email, phone, name now live in party (SD-13)
  const customerAgreementIds: string[] = [];
  const customerAgreementRefs: string[] = [];
  const customerAgreements = [];

  // Fixed account refs for the two demo customers (used in seeded fraud cases and transactions)
  const DEMO_ACCOUNT_REFS = ['ACC-LF-20240115', 'ACC-JS-20231201'];

  for (let i = 0; i < 50; i++) {
    const id = uuid();
    const ref = i < 2 ? DEMO_ACCOUNT_REFS[i] : `ACC-${String(i + 1).padStart(3, '0')}`;
    customerAgreementIds.push(id);
    customerAgreementRefs.push(ref);

    // v2: QE:equality + QE:none sensitive fields merged inline.
    // PII (name, email, phone) lives exclusively in party (SD-13). Do not add them here.
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
      // Ch-06: BQ:Step — KYC identity verification (BIAN SD-53 BQ:Step). PCI DSS Req 8.1.
      customerAgreementKycCheck: {
        customerAgreementKycCheckStatus: 'verified',
        customerAgreementKycCheckCompletedDate: faker.date.recent({ days: 365 }),
        customerAgreementKycCheckReference: `KYC-${faker.string.alphanumeric(8).toUpperCase()}`,
        customerAgreementKycCheckNotes: 'Identity verified via document check at onboarding',
      },
      bianServiceDomain: 'Customer Agreement',
      bianControlRecordType: 'CustomerAgreementProcedure',
      recordCreatedDateTime: faker.date.past({ years: 2 }),
      recordUpdatedDateTime: NOW,
      schemaVersion: 3,
    });
  }

  // -- 4. Payment cards (SD-88) --------------------------------------
  // Per-customer card-on-file arrangements: 3-4 cards each, with a customer alias and one preferred.
  // cardTokenMap[agreement] = the customer's PREFERRED card token (used to link their transactions).
  const cardTokenMap: Record<string, string> = {};
  const paymentCards = [];
  const CARD_ALIASES = ['Personal', 'Work', 'Travel', 'Backup', 'Online shopping', 'Groceries', 'Subscriptions', 'Family', 'Everyday', 'Business'];

  for (let i = 0; i < 50; i++) {
    const agId = customerAgreementIds[i];
    const count = 3 + (i % 2); // 3 or 4 cards
    const usedAliases = new Set<string>();
    let preferredCardId: string | null = null;
    let preferredToken: string | null = null;

    for (let j = 0; j < count; j++) {
      const cardId = uuid();
      const token = cardToken();
      let alias = CARD_ALIASES[(i + j) % CARD_ALIASES.length];
      while (usedAliases.has(alias)) alias = CARD_ALIASES[(i + j + usedAliases.size) % CARD_ALIASES.length];
      usedAliases.add(alias);

      const isPreferred = j === 0; // first card is the default
      if (isPreferred) { preferredCardId = cardId; preferredToken = token; }

      paymentCards.push({
        paymentCardInstanceReference: cardId,
        customerAgreementInstanceReference: agId,
        paymentCardReference: token,
        paymentCardExpirationDate: futureExpiry(),
        paymentCardMaskedPanDisplay: maskedPan(),
        paymentCardNetwork: NETWORKS[(i + j) % NETWORKS.length],
        paymentCardStatus: 'active',
        paymentCardIssuanceDateTime: faker.date.past({ years: 1 }),
        paymentCardIsPreferred: isPreferred,
        paymentCardAlias: alias,
        bianServiceDomain: 'Payment Card',
        bianControlRecordType: 'PaymentCardManagement',
        recordCreatedDateTime: faker.date.past({ years: 1 }),
        schemaVersion: 1,
      });
    }

    cardTokenMap[agId] = preferredToken!;
    customerAgreements[i].customerAgreementPreferredPaymentCardReference = preferredCardId as unknown as null;
  }

  // Shared cards (FDS/AML): one physical card (same token) held by several customers. One exceeds
  // the shared-card threshold (>3 holders) so it trips the compliance signal; the registry counts
  // distinct holders. Each holder gets their own arrangement row + alias.
  const SHARED_CARDS = [
    { token: 'tok_shared00000a4153', masked: '****-****-****-4153', network: 'VISA',       holders: 5 },
    { token: 'tok_shared00000b8821', masked: '****-****-****-8821', network: 'MASTERCARD', holders: 2 },
  ];
  let sharedCursor = 0;
  for (const s of SHARED_CARDS) {
    for (let h = 0; h < s.holders; h++) {
      const agId = customerAgreementIds[sharedCursor % 50];
      sharedCursor++;
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
        bianServiceDomain: 'Payment Card',
        bianControlRecordType: 'PaymentCardManagement',
        recordCreatedDateTime: faker.date.past({ years: 1 }),
        schemaVersion: 1,
      });
    }
  }

  // -- 5. Card transactions (SD-254) --------------------------------─
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
    const merchantName = faker.company.name();
    const txType = TX_TYPES[i % TX_TYPES.length];
    const { description, narrative } = descriptorFor(merchantName, txType);

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
      cardTransactionType: txType,
      cardTransactionChannel: CHANNELS[i % CHANNELS.length],
      cardTransactionInitiationType: 'customerInitiated',
      cardTransactionMerchantCategoryCode: mcc,
      cardTransactionMerchantName: merchantName,
      cardTransactionMaskedPanDisplay: paymentCards[custIdx].paymentCardMaskedPanDisplay,
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

  // -- Write files --------------------------------------------------─
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

// Realistic sample payloads per integration type.
// Outbound: what LeafyBank sends to the provider API.
// Inbound:  what an external provider posts to LeafyBank's webhook.

export const OUTBOUND_SAMPLES: Record<string, Record<string, unknown>> = {
  hrp_sanctions: {
    screeningRequestId: 'scr-20260611-87231',
    requestedAt: '2026-06-11T08:42:15.234Z',
    screeningType: 'SANCTIONS_PEP_HRP',
    subject: {
      type: 'INDIVIDUAL',
      firstName: 'Carlos',
      lastName: 'Mendez Ruiz',
      dateOfBirth: '1968-03-15',
      nationalities: ['CO', 'ES'],
      identifiers: [
        { type: 'NATIONAL_ID', value: '79654321', issuingCountry: 'CO' },
        { type: 'PASSPORT',    value: 'AE123456', issuingCountry: 'ES' },
      ],
      addresses: [{ line1: 'Calle 72 No. 10-34', city: 'Bogotá', postalCode: '110221', countryCode: 'CO' }],
    },
    transaction: {
      referenceId: 'TXN-20260611-00342',
      amount: 47500.00,
      currency: 'USD',
      type: 'INTERNATIONAL_TRANSFER',
      destinationCountry: 'AE',
      destinationBankBic: 'ADCBAEAA',
      destinationAccountIban: 'AE070331234567890123456',
    },
    requestedBy: 'leafybank-payment-processor',
    correlationId: 'corr-20260611-98734',
    callbackUrl: '/api/v1/webhooks/int-internal-hrp-001/callback',
  },

  fraud_detection: {
    requestId: 'fds-req-20260611-45123',
    timestamp: '2026-06-11T09:15:33.891Z',
    scoringModels: ['velocity', 'behavioural', 'device', 'geolocation'],
    transaction: {
      id: 'TXN-20260611-00342',
      amount: 2499.99,
      currency: 'EUR',
      merchantId: 'MERCH-78231',
      merchantName: 'Electronics Plus Madrid',
      merchantCategoryCode: '5732',
      channel: 'CARD_NOT_PRESENT',
      ipAddress: '185.220.101.45',
      deviceFingerprint: 'a3f7b2c9d8e4b1f0c6a2',
      geoLocation: { country: 'DE', city: 'Frankfurt', latitude: 50.1109, longitude: 8.6821 },
      timestamp: '2026-06-11T09:15:33.012Z',
    },
    cardholder: {
      accountId: 'ACC-20190842',
      customerId: 'CUST-10293847',
      accountAgeInDays: 1243,
      usualCountry: 'ES',
      last30DaysTransactionCount: 47,
      last30DaysSpendEur: 3217.40,
      previousDeclines30Days: 0,
    },
    requestedBy: 'leafybank-card-authorization',
    correlationId: 'corr-20260611-45123',
  },

  kyc_identity: {
    verificationRequestId: 'kyc-req-20260611-10234',
    requestedAt: '2026-06-11T10:22:45.123Z',
    verificationType: 'FULL_IDENTITY',
    checkLevel: 'ENHANCED_DUE_DILIGENCE',
    applicant: {
      firstName: 'María',
      lastName: 'González Torres',
      dateOfBirth: '1990-07-22',
      nationality: 'MX',
      email: 'maria.gonzalez@email.com',
      phoneNumber: '+52-55-1234-5678',
      address: {
        street: 'Av. Insurgentes Sur 1234',
        city: 'Ciudad de México',
        postalCode: '03100',
        countryCode: 'MX',
      },
    },
    documents: [
      { type: 'PASSPORT',         number: 'G12345678', issuingCountry: 'MX', expiryDate: '2030-07-21' },
      { type: 'PROOF_OF_ADDRESS', issueDate: '2026-03-15', issuer: 'CFE' },
    ],
    biometric: { faceMatchRequired: true, livenessCheckRequired: true },
    requestedBy: 'leafybank-onboarding-service',
    correlationId: 'corr-20260611-10234',
  },

  kyb_business: {
    verificationRequestId: 'kyb-req-20260611-30891',
    requestedAt: '2026-06-11T11:05:12.456Z',
    verificationType: 'BUSINESS_FULL',
    business: {
      legalName: 'Soluciones Tecnológicas del Sur S.A.',
      tradingName: 'TechSur',
      registrationNumber: '900-123-456-7',
      registrationCountry: 'CO',
      legalForm: 'SOCIEDAD_ANONIMA',
      incorporationDate: '2018-04-10',
      industrySector: 'TECHNOLOGY',
      sicCode: '7372',
      address: {
        street: 'Carrera 15 No. 88-64 Of. 301',
        city: 'Bogotá',
        countryCode: 'CO',
      },
    },
    ultimateBeneficialOwners: [
      { firstName: 'Ana', lastName: 'Restrepo', ownershipPercent: 55, isPep: false },
      { firstName: 'Jorge', lastName: 'Molina', ownershipPercent: 45, isPep: false },
    ],
    requestedBy: 'leafybank-commercial-onboarding',
    correlationId: 'corr-20260611-30891',
  },

  aml_monitoring: {
    monitoringRequestId: 'aml-req-20260611-67231',
    requestedAt: '2026-06-11T09:42:00.891Z',
    evaluationType: 'TRANSACTION_PATTERN',
    account: {
      id: 'ACC-20190842',
      customerId: 'CUST-10293847',
      accountType: 'CURRENT',
      openedDate: '2019-08-15',
      country: 'ES',
    },
    transactionWindow: {
      startDate: '2026-05-11',
      endDate: '2026-06-11',
      transactionCount: 143,
      totalDebits: 98234.50,
      totalCredits: 97810.20,
      currency: 'EUR',
      unusualPatterns: ['LARGE_ROUND_AMOUNTS', 'MULTIPLE_JURISDICTIONS'],
    },
    triggeredAlerts: [
      { alertCode: 'STR-001', description: 'Structuring pattern detected; 6 deposits just below €10,000', severity: 'HIGH' },
    ],
    requestedBy: 'leafybank-aml-engine',
    correlationId: 'corr-20260611-67231',
  },

  credit_bureau: {
    inquiryId: 'cbr-req-20260611-22108',
    requestedAt: '2026-06-11T14:31:09.234Z',
    inquiryType: 'FULL_CREDIT_REPORT',
    purpose: 'LOAN_ORIGINATION',
    applicant: {
      firstName: 'David',
      lastName: 'Martínez Soto',
      dateOfBirth: '1985-11-03',
      nationalId: '12345678A',
      countryCode: 'ES',
    },
    requestedProducts: ['CREDIT_SCORE', 'PAYMENT_HISTORY', 'CREDIT_UTILISATION', 'PUBLIC_RECORDS'],
    loanRequest: {
      amount: 25000,
      currency: 'EUR',
      termMonths: 60,
      purpose: 'HOME_IMPROVEMENT',
    },
    requestedBy: 'leafybank-lending-engine',
    correlationId: 'corr-20260611-22108',
    consentReference: 'CONSENT-20260611-DMS-001',
  },

  generic: {
    requestId: 'req-20260611-001',
    timestamp: '2026-06-11T08:00:00.000Z',
    payload: { key: 'value', nested: { field: 'example' } },
    requestedBy: 'leafybank-service',
    correlationId: 'corr-20260611-001',
  },
};

export const INBOUND_SAMPLES: Record<string, Record<string, unknown>> = {
  hrp_sanctions: {
    eventType: 'SCREENING_RESULT_READY',
    eventId: 'evt-20260611-45231',
    timestamp: '2026-06-11T08:42:17.123Z',
    screeningRequestId: 'scr-20260611-87231',
    correlationId: 'corr-20260611-98734',
    result: {
      overallRisk: 'HIGH',
      matchCount: 1,
      requiresManualReview: true,
      recommendedAction: 'BLOCK',
      matches: [
        {
          matchId: 'match-001',
          listName: 'UN_SANCTIONS',
          matchScore: 0.94,
          matchType: 'EXACT_NAME',
          entity: {
            name: 'Carlos Mendez Ruiz',
            entityType: 'INDIVIDUAL',
            designation: 'Listed for terrorism financing; UNSCR 1267',
            listedDate: '2019-07-22',
            listingAuthority: 'UN Security Council',
          },
        },
      ],
    },
    processingTimeMs: 892,
    providerReference: 'REFINITIV-WC-20260611-XK234',
  },

  fraud_detection: {
    requestId: 'fds-req-20260611-45123',
    responseId: 'fds-res-20260611-45123',
    processedAt: '2026-06-11T09:15:34.234Z',
    correlationId: 'corr-20260611-45123',
    fraudScore: 0.87,
    riskLevel: 'HIGH',
    decision: 'DECLINE',
    triggeredRules: [
      { ruleId: 'VEL-003', description: 'Unusual location; transaction in DE, account typically active in ES', weight: 0.38 },
      { ruleId: 'DEV-011', description: 'New device fingerprint not previously seen on this account', weight: 0.31 },
      { ruleId: 'AMT-007', description: 'Amount exceeds 90th percentile for merchant category 5732', weight: 0.18 },
    ],
    recommendedAction: 'BLOCK_AND_NOTIFY_CARDHOLDER',
    caseId: 'CASE-FDS-20260611-9823',
    processingTimeMs: 143,
  },

  kyc_identity: {
    eventType: 'VERIFICATION_COMPLETED',
    verificationRequestId: 'kyc-req-20260611-10234',
    correlationId: 'corr-20260611-10234',
    completedAt: '2026-06-11T10:24:18.780Z',
    overallStatus: 'APPROVED',
    checks: [
      { checkType: 'DOCUMENT_AUTHENTICITY', status: 'PASSED', confidence: 0.98 },
      { checkType: 'FACE_MATCH',            status: 'PASSED', confidence: 0.96 },
      { checkType: 'LIVENESS',              status: 'PASSED', confidence: 0.99 },
      { checkType: 'SANCTIONS_SCREEN',      status: 'PASSED', confidence: 1.0  },
    ],
    extractedData: {
      verifiedName: 'MARÍA GONZÁLEZ TORRES',
      verifiedDateOfBirth: '1990-07-22',
      documentType: 'PASSPORT',
      documentCountry: 'MX',
    },
    riskScore: 0.08,
    providerReference: 'ONFIDO-20260611-XC234',
  },

  kyb_business: {
    eventType: 'BUSINESS_VERIFICATION_COMPLETED',
    verificationRequestId: 'kyb-req-20260611-30891',
    correlationId: 'corr-20260611-30891',
    completedAt: '2026-06-11T11:21:45.123Z',
    overallStatus: 'APPROVED_WITH_MONITORING',
    checks: [
      { checkType: 'COMPANY_REGISTRY',     status: 'PASSED' },
      { checkType: 'BENEFICIAL_OWNERSHIP', status: 'PASSED' },
      { checkType: 'SANCTIONS_SCREEN',     status: 'PASSED' },
      { checkType: 'ADVERSE_MEDIA',        status: 'REVIEW', note: 'Minor adverse media detected; monitoring recommended' },
    ],
    riskRating: 'MEDIUM',
    reviewRequired: true,
    providerReference: 'COMPLY-ADVAN-20260611-BV891',
  },

  aml_monitoring: {
    eventType: 'SUSPICIOUS_ACTIVITY_ALERT',
    alertId: 'aml-alert-20260611-88341',
    monitoringRequestId: 'aml-req-20260611-67231',
    correlationId: 'corr-20260611-67231',
    generatedAt: '2026-06-11T09:42:04.567Z',
    severity: 'HIGH',
    alertCode: 'STR-001',
    description: 'Structuring pattern detected: 6 deposits between €8,000–€9,800 within 14-day window',
    affectedAccount: 'ACC-20190842',
    recommendedAction: 'FILE_SAR',
    regulatoryDeadline: '2026-06-21T23:59:59.000Z',
    supportingTransactions: [
      { txId: 'TXN-20260601-11234', amount: 9800, currency: 'EUR', date: '2026-06-01' },
      { txId: 'TXN-20260603-21891', amount: 9500, currency: 'EUR', date: '2026-06-03' },
    ],
    providerReference: 'ACTIMIZE-AML-20260611-SHA341',
  },

  credit_bureau: {
    eventType: 'CREDIT_REPORT_READY',
    inquiryId: 'cbr-req-20260611-22108',
    correlationId: 'corr-20260611-22108',
    reportGeneratedAt: '2026-06-11T14:31:12.890Z',
    reportId: 'EXPERIAN-RPT-20260611-DMS-001',
    creditScore: 724,
    scoreRange: { min: 300, max: 850 },
    riskBand: 'GOOD',
    summary: {
      totalAccounts: 8,
      openAccounts: 5,
      totalDebt: 12340.00,
      creditUtilisation: 0.24,
      monthsOfCreditHistory: 132,
      missedPaymentsLast24Months: 0,
      publicRecords: 0,
    },
    recommendation: 'APPROVE',
    maxRecommendedAmount: 30000,
    currency: 'EUR',
  },

  generic: {
    eventType: 'DATA_RECEIVED',
    eventId: 'evt-20260611-001',
    timestamp: '2026-06-11T08:00:01.000Z',
    payload: { result: 'success', value: 42 },
  },
};

export function getOutboundSample(type: string): string {
  const payload = OUTBOUND_SAMPLES[type] ?? OUTBOUND_SAMPLES.generic;
  return JSON.stringify(payload, null, 2);
}

export function getInboundSample(type: string): string {
  const payload = INBOUND_SAMPLES[type] ?? INBOUND_SAMPLES.generic;
  return JSON.stringify(payload, null, 2);
}

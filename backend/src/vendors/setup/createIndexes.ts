import { MongoClient } from 'mongodb';

export async function createIndexes(client: MongoClient) {
  const db = client.db(process.env.MONGODB_DB_NAME!);

  // SD-13: Party Data Management
  await db.collection('party').createIndexes([
    { key: { partyInstanceReference: 1 }, unique: true },
  ]);

  // SD-254: Card Transaction Log
  await db.collection('cardTransactionLog').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },
    { key: { cardTransactionDateTime: -1 } },
    { key: { cardTransactionStatus: 1 } },
    // Acquiring-side: list a merchant's received payments, newest first (SD-89)
    { key: { merchantAgreementInstanceReference: 1, cardTransactionDateTime: -1 } },
  ]);

  // SD-53: Customer Agreement Procedure
  await db.collection('customerAgreementProcedure').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
    { key: { customerAgreementStatus: 1 } },
  ]);

  // SD-88: Payment Card Management
  await db.collection('paymentCardManagement').createIndexes([
    { key: { paymentCardInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },
    { key: { customerAgreementInstanceReference: 1 } },
  ]);

  // SD-83: Fraud Diagnosis
  await db.collection('fraudDiagnosisCase').createIndexes([
    { key: { fraudDiagnosisInstanceReference: 1 }, unique: true },
    { key: { cardTransactionInstanceReference: 1 } },
    { key: { customerAgreementInstanceReference: 1 } },
    { key: { fraudDiagnosisCaseStatus: 1, fraudDiagnosisCaseSeverity: -1 } },
  ]);

  await db.collection('fraudDiagnosisCaseEvents').createIndexes([
    { key: { fraudDiagnosisInstanceReference: 1, actionDateTime: -1 } },
  ]);

  // SD-91: Customer Authentication Assessment
  await db.collection('customerAuthenticationAssessment').createIndexes([
    { key: { customerAuthenticationInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
    { key: { customerAuthenticationUserRole: 1 } },
  ]);

  // SD-16: Party Authentication Assessment
  await db.collection('partyAuthenticationAssessment').createIndexes([
    { key: { partyAuthenticationInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
  ]);

  // Authentication Domain config
  await db.collection('authenticationDomain').createIndexes([
    { key: { partyAuthenticationDomainInstanceReference: 1 }, unique: true },
    { key: { partyAuthenticationDomainName: 1 }, unique: true },
    { key: { partyAuthenticationDomainEnabled: 1 } },
  ]);

  // SD-60: Customer Credit Rating State
  await db.collection('customerCreditRatingState').createIndexes([
    { key: { customerCreditRatingInstanceReference: 1 }, unique: true },
    { key: { customerAgreementReference: 1 } },
  ]);

  // Open Banking: Consent Agreement
  await db.collection('consentAgreement').createIndexes([
    { key: { consentAgreementInstanceReference: 1 }, unique: true },
    { key: { partyInstanceReference: 1 } },
    { key: { consentRecipientIdentifier: 1 } },
    { key: { consentStatus: 1, consentExpiryDateTime: 1 } },
  ]);

  // Open Banking: Consent Access Log
  await db.collection('consentAccessLog').createIndexes([
    { key: { consentAccessLogInstanceReference: 1 }, unique: true },
    { key: { consentAgreementInstanceReference: 1, accessDateTime: -1 } },
    { key: { accessDateTime: -1 } },
  ]);

  // SD-89: Merchant Agreement Procedure
  await db.collection('merchantAgreementProcedure').createIndexes([
    { key: { merchantAgreementInstanceReference: 1 }, unique: true },
    { key: { merchantAgreementStatus: 1 } },
    { key: { merchantCategoryCode: 1 } },
    { key: { merchantOwnerPartyReference: 1 } },   // Ch-05: dual-role Party lookup
  ]);

  // SD-89: Merchant lifecycle audit trail (append-only, PCI DSS Req 10)
  await db.collection('merchantAgreementEvents').createIndexes([
    { key: { merchantAgreementInstanceReference: 1, eventDateTime: 1 } },
  ]);

  // SD-64: Checkout Session Log (TTL on expiry field)
  await db.collection('checkoutSessionLog').createIndexes([
    { key: { checkoutSessionInstanceReference: 1 }, unique: true },
    { key: { merchantAgreementInstanceReference: 1 } },
    { key: { checkoutSessionMerchantReference: 1, merchantAgreementInstanceReference: 1 } },
    { key: { checkoutSessionExpiresAt: 1 }, expireAfterSeconds: 0 },
  ]);

  // SD-64: Payment Link Record
  await db.collection('paymentLinkRecord').createIndexes([
    { key: { paymentLinkInstanceReference: 1 }, unique: true },
    { key: { paymentLinkCode: 1 }, unique: true },
    { key: { merchantAgreementInstanceReference: 1 } },
    { key: { paymentLinkStatus: 1 } },
    // Sparse TTL: only applies to documents with paymentLinkExpiresAt set
    { key: { paymentLinkExpiresAt: 1 }, expireAfterSeconds: 0, sparse: true },
  ]);

  // SD-193: Integration Registry (Ch-07)
  // Drop the old unique (type+endpoint) index if it still exists — replaced with non-unique
  // to support multi-provider configurations (ADR-010).
  await db.collection('integrationRegistry')
    .dropIndex('externalProviderArrangementType_1_externalProviderApiEndpoint_1')
    .catch(() => { /* index may not exist — safe to ignore */ });

  await db.collection('integrationRegistry').createIndexes([
    { key: { externalProviderArrangementInstanceReference: 1 }, unique: true },
    { key: { externalProviderArrangementType: 1, externalProviderArrangementStatus: 1 } },
    { key: { externalProviderIsInternal: 1 } },
    // Non-unique: allows multiple providers of same type at same endpoint (multi-provider support)
    { key: { externalProviderArrangementType: 1, externalProviderApiEndpoint: 1 }, sparse: true },
    { key: { routingGroupId: 1 }, sparse: true },
    { key: { routingPriority: 1, externalProviderArrangementType: 1 } },
  ]);

  // SD-193: Integration Routing Groups (Ch-07)
  await db.collection('integrationRoutingGroups').createIndexes([
    { key: { routingGroupInstanceReference: 1 }, unique: true },
    { key: { routingGroupProviderType: 1, routingGroupStatus: 1 } },
    { key: { isDefaultGroup: 1 }, sparse: true },
  ]);

  // SD-193: Integration Events — append-only audit log with 90-day TTL (PCI DSS Req 10.7)
  await db.collection('integrationEvents').createIndexes([
    { key: { integrationEventInstanceReference: 1 }, unique: true },
    { key: { externalProviderArrangementInstanceReference: 1, recordCreatedDateTime: -1 } },
    { key: { integrationEventType: 1, recordCreatedDateTime: -1 } },
    { key: { recordCreatedDateTime: 1 }, expireAfterSeconds: 7776000 },
  ]);
}

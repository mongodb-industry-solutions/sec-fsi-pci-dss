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
}

import { MongoClient } from 'mongodb';

export async function createIndexes(client: MongoClient) {
  const db = client.db(process.env.MONGODB_DB_NAME!);

  await db.collection('cardTransaction').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },
    { key: { cardTransactionDateTime: -1 } },
    { key: { cardTransactionStatus: 1 } },
  ]);

  await db.collection('cardTransactionSensitive').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
  ]);

  await db.collection('customerAgreement').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
    { key: { customerAgreementStatus: 1 } },
  ]);

  await db.collection('customerAgreementSensitive').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
  ]);

  await db.collection('paymentCard').createIndexes([
    { key: { paymentCardInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },
    { key: { customerAgreementInstanceReference: 1 } },
  ]);

  await db.collection('fraudDiagnosisCase').createIndexes([
    { key: { fraudDiagnosisInstanceReference: 1 }, unique: true },
    { key: { linkedCardTransactionReference: 1 } },
    { key: { fraudDiagnosisCaseStatus: 1, fraudDiagnosisCaseSeverity: -1 } },
  ]);

  await db.collection('partyAuthentication').createIndexes([
    { key: { partyAuthenticationInstanceReference: 1 }, unique: true },
    { key: { partyAuthenticationUserRole: 1 } },
  ]);

  await db.collection('authenticationDomain').createIndexes([
    { key: { partyAuthenticationDomainInstanceReference: 1 }, unique: true },
    { key: { partyAuthenticationDomainName: 1 }, unique: true },
    { key: { partyAuthenticationDomainEnabled: 1 } },
  ]);
}

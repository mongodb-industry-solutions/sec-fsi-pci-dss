import { MongoClient } from 'mongodb';

export async function createIndexes(client: MongoClient) {
  const db = client.db(process.env.MONGODB_DB_NAME!);

  await db.collection('cardTransactionQE').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },
    { key: { transactionDateTime: -1 } },
    { key: { transactionStatus: 1 } },
  ]);

  await db.collection('cardTransactionSensitiveQE').createIndexes([
    { key: { cardTransactionInstanceReference: 1 }, unique: true },
  ]);

  await db.collection('customerAgreementQE').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
    { key: { agreementStatus: 1 } },
  ]);

  await db.collection('customerAgreementSensitiveQE').createIndexes([
    { key: { customerAgreementInstanceReference: 1 }, unique: true },
  ]);

  await db.collection('paymentCardQE').createIndexes([
    { key: { paymentCardInstanceReference: 1 }, unique: true },
    { key: { paymentCardReference: 1 } },
    { key: { customerAgreementInstanceReference: 1 } },
  ]);

  await db.collection('fraudDiagnosisCase').createIndexes([
    { key: { fraudDiagnosisInstanceReference: 1 }, unique: true },
    { key: { linkedCardTransactionReference: 1 } },
    { key: { fraudDiagnosisCaseStatus: 1, fraudDiagnosisCaseSeverity: -1 } },
  ]);

  await db.collection('partyAuthenticationQE').createIndexes([
    { key: { partyAuthenticationInstanceReference: 1 }, unique: true },
    { key: { authenticationUserRole: 1 } },
  ]);
}

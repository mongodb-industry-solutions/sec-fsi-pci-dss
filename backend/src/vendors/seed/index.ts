import * as dotenv from 'dotenv';
import { getQEClient, closeQEClient } from '../encryption/qeClient';
import { seedUsers } from './seedUsers';
import { seedCustomers } from './seedCustomers';
import { seedCards } from './seedCards';
import { seedTransactions } from './seedTransactions';
import { seedCases } from './seedCases';

dotenv.config();

export async function runSeed() {
  const client = await getQEClient();
  const db = client.db(process.env.MONGODB_DB_NAME!);

  try {
    console.log('Seeding partyAuthenticationQE...');
    await seedUsers(db);

    console.log('Seeding customerAgreementQE + customerAgreementSensitiveQE...');
    await seedCustomers(db);

    console.log('Seeding paymentCardQE...');
    await seedCards(db);

    console.log('Seeding cardTransactionQE + cardTransactionSensitiveQE...');
    await seedTransactions(db);

    console.log('Seeding fraudDiagnosisCase...');
    await seedCases(db);

    console.log('\nSeed complete.');
  } finally {
    await closeQEClient();
  }
}

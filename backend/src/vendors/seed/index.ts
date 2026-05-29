import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { getQEClient, closeQEClient } from '../encryption/qeClient';
import { seedUsers } from './seedUsers';
import { seedCustomers } from './seedCustomers';
import { seedCards } from './seedCards';
import { seedTransactions } from './seedTransactions';
import { seedCases } from './seedCases';

// Load .env from project root — works regardless of CWD (npm --prefix changes CWD to backend/)
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

export async function runSeed() {
  const client = await getQEClient();
  const db = client.db(process.env.MONGODB_DB_NAME!);

  try {
    console.log('Seeding partyAuthentication...');
    await seedUsers(db);

    console.log('Seeding customerAgreement + customerAgreementSensitive...');
    await seedCustomers(db);

    console.log('Seeding paymentCard...');
    await seedCards(db);

    console.log('Seeding cardTransaction + cardTransactionSensitive...');
    await seedTransactions(db);

    console.log('Seeding fraudDiagnosisCase...');
    await seedCases(db);

    console.log('\nSeed complete.');
  } finally {
    await closeQEClient();
  }
}

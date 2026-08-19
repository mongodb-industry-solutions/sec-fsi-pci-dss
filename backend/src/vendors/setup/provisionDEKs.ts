import { MongoClient } from 'mongodb';
import { provisionDataEncryptionKeys, DEKs } from '../encryption/keyVault';

export async function provisionDEKs(client: MongoClient): Promise<DEKs> {
  // Repair then guarantee, both inside provisionDataEncryptionKeys so every provisioning path gets
  // it. Creating the index here only used to leave the runtime path (buildQEClient, once per QE
  // tier) free to duplicate an alt name, and a duplicated vault can never build the index again.
  const deks = await provisionDataEncryptionKeys(client);
  return deks;
}

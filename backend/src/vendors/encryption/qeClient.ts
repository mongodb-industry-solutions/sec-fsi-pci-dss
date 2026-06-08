/**
 * Legacy QE client — used only by setup/seed scripts that need full DEK access.
 * Application request handlers must use getDbForRole() from roleClients.ts instead.
 */
import { MongoClient } from 'mongodb';
import { getL2QEClient, closeRoleClients } from './roleClients';

/** Returns the Level 2 (full) QE MongoClient. Used by setup and seed scripts. */
export async function getQEClient(): Promise<MongoClient> {
  return getL2QEClient();
}

export async function closeQEClient(): Promise<void> {
  return closeRoleClients();
}

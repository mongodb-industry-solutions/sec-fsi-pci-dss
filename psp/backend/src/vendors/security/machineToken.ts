import { MachineTokenSource } from '@ist-sec/giam-client';
import { config } from '../../config';

/**
 * This service's own machine token, for the calls it makes as itself.
 *
 * The mechanics moved to the shared client (`@ist-sec/giam-client`): the bank needs the identical
 * exchange, and two copies of renewal-and-caching are two behaviours the day one of them is fixed.
 * What stays here is the binding to THIS service's configuration, which is the only part that
 * differs between them.
 *
 * Credentials are read lazily rather than at module load, because a test that sets them after
 * importing would otherwise get a source built from the values that were absent at import time.
 */

let source: MachineTokenSource | null = null;
let builtFrom = '';

function current(): MachineTokenSource {
  const key = `${config.giam.issuerUrl}|${config.giam.clientId}|${config.giam.clientSecret ?? ''}`;
  if (!source || builtFrom !== key) {
    source = new MachineTokenSource({
      issuerUrl: config.giam.issuerUrl,
      clientId: config.giam.clientId,
      clientSecret: config.giam.clientSecret,
    });
    builtFrom = key;
  }
  return source;
}

export async function authorityMachineToken(scope?: string): Promise<string | null> {
  return current().token(scope);
}

/** Drops the cache, for a test that needs the next call to fetch afresh. */
export function resetMachineTokenCache(): void {
  source?.reset();
  source = null;
  builtFrom = '';
}

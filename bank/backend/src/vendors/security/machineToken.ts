import { MachineTokenSource } from '@ist-sec/giam-client';
import { config } from '../../config';

/**
 * The bank's own machine token, for the calls it makes as itself at the authority.
 *
 * It had none. Its client id and secret were configured, seeded and held in the deployment secret,
 * and no code read them: the one call that needed authority, registering its permission catalog,
 * presented the authority's ADMIN token instead. That is a credential with far more reach than
 * declaring one's own enforcement points requires, and it made the bank depend on holding the
 * authority's master credential to complete its own boot.
 *
 * Same exchange as the PSP's, from the same shared client, under this bank's own prefix so the two
 * services never read each other's credential.
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

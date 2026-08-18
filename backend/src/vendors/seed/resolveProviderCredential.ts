import { absoluteEndpoint, resolvePlatformLinks } from '@leafypay/platform-links';
import { ExternalProviderArrangement } from '../../modules/provider/models/externalProviderArrangement.model';

// Turns the hostname-free fixture into the absolute, environment specific link, and fills in the TPP
// credential the PSP holds against the bank. Promoting local to staging to production is a re-seed.
//
// The credential VALUE comes from the environment at SEED time because a shared secret has to
// originate somewhere; at runtime only the record is read, with no fallback, since a silent fallback is
// how two environments end up disagreeing.
const DEFAULT_CLIENT_ID = 'leafypay-psp';
const DEFAULT_CLIENT_SECRET = 'dev-bankcore-tpp-secret';

function fromEnv(name: string, fallback: string): string {
  const value = process.env[`PSP_${name}`] ?? process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

/** Fills a provider record's `oauth2_cc` credential in place. A record without one is left untouched. */
export function resolveBankcoreLink(record: ExternalProviderArrangement): void {
  const oauth2 = record.authConfig?.scheme === 'oauth2_cc' ? record.authConfig.oauth2 : undefined;
  if (!oauth2) return;

  const { bankcoreBaseUrl } = resolvePlatformLinks();
  oauth2.clientId = fromEnv('BANKCORE_TPP_CLIENT_ID', DEFAULT_CLIENT_ID);
  oauth2.clientSecretPlaintext = fromEnv('BANKCORE_TPP_CLIENT_SECRET', DEFAULT_CLIENT_SECRET);
  // The fixture holds the relative standard path; the host is the environment's.
  if (!oauth2.tokenEndpoint.startsWith('http')) {
    oauth2.tokenEndpoint = absoluteEndpoint(bankcoreBaseUrl, oauth2.tokenEndpoint);
  }
  // The bank's base URL goes on the same record as its credential (P4.1). Picking the two from different
  // records is how a token ends up presented at the wrong bank.
  //
  // It lands in a field of its own rather than replacing `externalProviderApiEndpoint`, because that field
  // still holds the loopback path the built-in engine answers on, and the kill switch decides which of the
  // two is used. Flipping it would break the built-in path the moment the records are seeded.
  record.externalProviderBaseUrl = bankcoreBaseUrl;
}

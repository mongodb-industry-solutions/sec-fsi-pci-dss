import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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

  declareWhatItServes(record);
}

interface BankProfileFixture {
  bankProfileInstanceReference?: string;
  bankProfileIbanBankCodes?: string[];
  bankProfileBinRanges?: { binRangeFrom: string; binRangeTo: string; binRangeScheme?: string }[];
}

// Read from the BANK's own fixture rather than restated here, so the two cannot disagree about which
// institution this credential belongs to. Same reasoning as the card seeder reading its BIN ranges.
function bankProfile(): BankProfileFixture | undefined {
  const path = join(__dirname, '../../../../../bank/backend/data/bankProfile.json');
  if (!existsSync(path)) return undefined;
  const profiles = JSON.parse(readFileSync(path, 'utf8')) as BankProfileFixture[];
  return profiles[0];
}

/**
 * States which institution this provider serves, which is what makes it resolvable.
 *
 * v37 P6.2d: the entity-bound resolver matches an account's ASPSP against `externalProviderAspspReference`,
 * and a freshly typed IBAN's bank code against `externalProviderIbanBankCodes`. Without both, the resolver
 * refuses every route with "no active provider serves ASPSP ...", which is correct behaviour on an
 * undeclared record and exactly why the declaration belongs in the seed rather than in a runtime default:
 * guessing the institution is the one thing the resolver must never do.
 */
function declareWhatItServes(record: ExternalProviderArrangement): void {
  const profile = bankProfile();
  if (!profile?.bankProfileInstanceReference) return;
  record.externalProviderAspspReference = profile.bankProfileInstanceReference;
  if (profile.bankProfileIbanBankCodes?.length) {
    record.externalProviderIbanBankCodes = [...profile.bankProfileIbanBankCodes];
  }
  // The CARD capabilities route by BIN, not by IBAN bank code, so declaring only the latter left every card
  // unroutable: "no registered issuer covers BIN 453995" for a card this very bank had issued. The ranges come
  // from the bank's own profile, the same source the bank's card seeder mints numbers from, so an issuer
  // cannot claim a range it does not actually issue in.
  if (profile.bankProfileBinRanges?.length) {
    record.externalProviderBinRanges = profile.bankProfileBinRanges.map((range) => ({ ...range }));
  }
}

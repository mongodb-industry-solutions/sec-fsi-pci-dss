import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  absoluteEndpoint, hasLinkPlaceholder, linkPlaceholder, PLATFORM_ENVIRONMENTS,
} from '@leafypay/platform-links';
import { ExternalProviderArrangement } from '../../modules/provider/models/externalProviderArrangement.model';
import { clientSecretFor } from '@leafypay/platform-links';

// Declares the bank's address in EVERY environment on the provider record, and fills in the TPP
// credential the PSP holds against it. Promoting local to staging to production is one variable, not a
// re-seed: the record carries all three and the running deployment selects its own.
//
// The credential VALUE still comes from the environment at SEED time, because a shared secret has to
// originate somewhere and there is nothing environment-shaped about it: the same TPP registration is
// the one the bank holds. Addresses and secrets are treated differently on purpose.
const DEFAULT_CLIENT_ID = 'leafypay-psp';
const DEFAULT_CLIENT_SECRET = clientSecretFor('leafypay-psp');

function fromEnv(name: string, fallback: string): string {
  const value = process.env[`PSP_${name}`] ?? process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

/** Fills a provider record's `oauth2_cc` credential in place. A record without one is left untouched. */
export function resolveBankcoreLink(record: ExternalProviderArrangement): void {
  const oauth2 = record.authConfig?.scheme === 'oauth2_cc' ? record.authConfig.oauth2 : undefined;
  if (!oauth2) return;

  oauth2.clientId = fromEnv('BANKCORE_TPP_CLIENT_ID', DEFAULT_CLIENT_ID);
  oauth2.clientSecretPlaintext = fromEnv('BANKCORE_TPP_CLIENT_SECRET', DEFAULT_CLIENT_SECRET);
  // The fixture holds the relative standard path; the ISSUER is named, and bound where it is used.
  //
  // It is the AUTHORITY's host, not the bank's. The bank stopped issuing tokens and is a resource
  // server that only verifies them, so a credential resolved against the bank asks for a token at a
  // service that has none to give, and the call that follows arrives with no bearer at all.
  if (!oauth2.tokenEndpoint.startsWith('http') && !hasLinkPlaceholder(oauth2.tokenEndpoint)) {
    oauth2.tokenEndpoint = absoluteEndpoint(linkPlaceholder('authorityIssuer'), oauth2.tokenEndpoint);
  }
  // The bank's address goes on the same record as its credential (P4.1). Picking the two from different
  // records is how a token ends up presented at the wrong bank.
  //
  // EVERY environment's address, indexed by environment id, and not the one this seeder happens to be
  // run in. The same record is restored into local, staging and production, where the bank answers on
  // three different hosts (and in staging on an in-cluster name a browser could not reach at all), so a
  // single baked host is right in exactly the environment it was written in. The entry for the running
  // environment is selected at dispatch time by `providerBaseUrl`.
  //
  // The entries name the platform link rather than restating its hosts, because the bank IS a platform
  // service and its addresses are already declared in `LINK_MATRIX`. A third-party provider would carry
  // literal URLs here instead; both shapes resolve the same way.
  //
  // It lands in a field of its own rather than replacing `externalProviderApiEndpoint`, because that field
  // still holds the loopback path the built-in engine answers on, and the kill switch decides which of the
  // two is used. Flipping it would break the built-in path the moment the records are seeded.
  //
  // A fixture that already declares its own map is left alone: a real provider's hosts are its own, and
  // the seeder has no business overwriting them with the bank's.
  if (!record.externalProviderBaseUrlByEnvironment) {
    record.externalProviderBaseUrlByEnvironment = Object.fromEntries(
      PLATFORM_ENVIRONMENTS.map((environmentId) => [environmentId, linkPlaceholder('bankcore')]),
    );
  }
  // Kept as the single-address fallback for any reader that has not been taught about the map.
  record.externalProviderBaseUrl = linkPlaceholder('bankcore');

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

import { Db } from 'mongodb';
import { existsSync } from 'fs';
import { config, keyVaultNamespaceParts } from '../../config';
import { BANK_PROFILE_COLLECTION, BankProfileControlRecord } from '../../modules/aspsp/models/bankProfile.model';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../modules/aspsp/models/accountArrangement.model';
import { TPP_REGISTRATION_COLLECTION, TppRegistrationControlRecord } from '../../modules/tpp-trust/models/tppRegistration.model';

// What the bank reports about itself at boot, so "is it working" is answerable from the log alone
// instead of by opening Swagger and guessing. Every failure mode this project has actually hit shows up
// here: a wrong crypt_shared path, a key vault that is not the shared one, an unseeded database, a bank
// with no registered TPP. Each of those otherwise surfaces as a generic 503 or a blanket 401.
//
// Nothing secret is printed. The connection string is shown with its credentials removed, and a signing
// key is reported by its ORIGIN (configured or derived), never by its value.

export interface StartupLine {
  label: string;
  value: string;
  // 'warn' marks something that will break a call later, so it stands out in a wall of INFO lines.
  level?: 'info' | 'warn';
}

/**
 * Removes the credentials from a MongoDB connection string. The host, the options and the shape stay,
 * because those are what a reader needs to confirm they are pointed at the right cluster.
 */
export function redactMongoUri(uri: string): string {
  if (!uri) return '(not set)';
  // Hand-parsed rather than via URL: a mongodb+srv string with a comma separated host list is not a
  // valid WHATWG URL, and a throw here would hide the whole report.
  const match = /^(mongodb(?:\+srv)?:\/\/)([^@/]*@)?(.*)$/i.exec(uri);
  if (!match) return '(unparseable connection string)';
  const [, scheme, userinfo, rest] = match;
  if (!userinfo) return `${scheme}${rest}`;
  const user = userinfo.slice(0, -1).split(':')[0];
  return `${scheme}${user ? `${user}:***@` : '***@'}${rest}`;
}

function cryptSharedLine(): StartupLine {
  const path = config.mongodb.cryptSharedLibPath;
  if (!path) return { label: 'crypt_shared', value: '(not set) encrypted reads will fail', level: 'warn' };
  const present = existsSync(path);
  return {
    label: 'crypt_shared',
    value: present ? path : `${path} (MISSING: the whole connection fails and reads as a plain outage)`,
    level: present ? 'info' : 'warn',
  };
}

/** The static half of the report: process, bindings and configuration. Needs no database. */
export function configurationReport(): StartupLine[] {
  const { database, collection } = keyVaultNamespaceParts();
  return [
    { label: 'environment', value: `${config.nodeEnv}, node ${process.version}` },
    { label: 'listening', value: `http://${config.server.host}:${config.server.port}` },
    { label: 'private URL', value: `${config.server.baseUrl} (the PSP dispatches here)` },
    {
      label: 'public URL',
      value: config.server.publicUrl
        ? `${config.server.publicUrl} (docs only; operating needs a TPP token)`
        : '(none) this deployment does not publish the bank',
    },
    { label: 'swagger', value: `${config.server.baseUrl}/doc` },
    { label: 'health', value: `${config.server.baseUrl}/health` },
    { label: 'token endpoint', value: `${config.server.baseUrl}/v1/oauth/token (client_credentials)` },
    { label: 'database', value: config.mongodb.dbName },
    { label: 'cluster', value: redactMongoUri(config.mongodb.uri) },
    { label: 'key vault', value: `${database}.${collection} (shared with the PSP, shared DEKs)` },
    cryptSharedLine(),
    { label: 'consent mode', value: config.bank.consentMode },
    { label: 'event bus', value: `${config.app.eventBusEngine}, own store` },
    {
      label: 'TPP token key',
      // The origin, never the key. A derived key is not a weaker one, it is one less thing to configure.
      value: process.env.PSP_BANKCORE_ACCESS_TOKEN_SECRET
        ? 'configured (PSP_BANKCORE_ACCESS_TOKEN_SECRET)'
        : 'derived from the platform secret, distinct from it',
    },
    { label: 'PSP callback host', value: config.server.pspBaseUrl },
  ];
}

/** The live half: what the database actually holds. Reported as a warning when it is not usable. */
export async function readinessReport(db: Db | undefined, dbError: string | null): Promise<StartupLine[]> {
  if (dbError !== null || !db) {
    return [{ label: 'ledger', value: `UNAVAILABLE: ${dbError ?? 'no database handle'}`, level: 'warn' }];
  }
  const lines: StartupLine[] = [];
  try {
    const started = Date.now();
    await db.command({ ping: 1 });
    lines.push({ label: 'ledger', value: `reachable in ${Date.now() - started}ms` });
  } catch (err) {
    return [{ label: 'ledger', value: `ping failed: ${err instanceof Error ? err.message : String(err)}`, level: 'warn' }];
  }

  try {
    const profile = await db.collection<BankProfileControlRecord>(BANK_PROFILE_COLLECTION).findOne({});
    lines.push(profile
      ? {
        label: 'bank',
        value: `${profile.bankProfileName}, ${profile.bankProfileBic}, `
          + `bank codes ${(profile.bankProfileIbanBankCodes ?? []).join('/')}, `
          + `${(profile.bankProfileBinRanges ?? []).length} card range(s)`,
      }
      : { label: 'bank', value: 'no bankProfile: nothing can be routed here. Run setup:seed', level: 'warn' });

    const accounts = await db.collection(ACCOUNT_ARRANGEMENT_COLLECTION).estimatedDocumentCount();
    lines.push({
      label: 'accounts',
      value: accounts > 0 ? `${accounts} in the ledger` : 'none: the database is not seeded',
      level: accounts > 0 ? 'info' : 'warn',
    });

    const tpps = await db.collection<TppRegistrationControlRecord>(TPP_REGISTRATION_COLLECTION)
      .find({ tppRegistrationStatus: 'active' }, { projection: { _id: 0, tppRegistrationClientId: 1, tppRegistrationRoles: 1 } })
      .toArray();
    lines.push(tpps.length > 0
      ? {
        label: 'registered TPPs',
        value: tpps.map((t) => `${t.tppRegistrationClientId} (${(t.tppRegistrationRoles ?? []).join('/')})`).join(', '),
      }
      // Without one, every call is 401 and the cause looks like a token bug rather than empty data.
      : { label: 'registered TPPs', value: 'none active: every API call will be refused', level: 'warn' });
  } catch (err) {
    lines.push({
      label: 'readiness',
      value: `could not be read: ${err instanceof Error ? err.message : String(err)}`,
      level: 'warn',
    });
  }
  return lines;
}

export function formatReport(lines: StartupLine[]): string[] {
  const width = Math.max(...lines.map((line) => line.label.length));
  return lines.map((line) => `  ${line.level === 'warn' ? '!' : '·'} ${line.label.padEnd(width)}  ${line.value}`);
}

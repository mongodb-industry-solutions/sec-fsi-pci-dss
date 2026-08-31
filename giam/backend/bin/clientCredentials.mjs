/**
 * Prints the DEMO client credentials, so an integrator can configure an application without a
 * credential being written down in the repository to copy from.
 *
 * This exists because the secrets are derived rather than stored in the fixture. That removes the
 * literal, but it also removes the file people used to read to find out what to configure, and the
 * answer cannot be "read the hash in the database". This is that answer.
 *
 * It is a demo helper and says so on every run. In a real deployment the authority issues these and
 * delivers them to each integrator out of band, and nothing here applies.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The repo-root .env, because a pinned variable lives there and reporting "unset" while it is set
// would send someone configuring an application to the wrong value.
try {
  const { config } = await import('dotenv');
  config({ path: join(here, '../../../.env'), quiet: true });
} catch { /* no root .env in this context: every variable then reads as unset, which is true */ }

const { clientSecretFor, CLIENT_SECRET_REFS } = await import('@leafypay/platform-links');

const clients = JSON.parse(readFileSync(join(here, '../data/clients.json'), 'utf8'));

const confidential = clients.filter((client) => client.clientType === 'confidential');

console.log('\n  Demo client credentials. Preconfiguration only, never a production credential.\n');

for (const client of confidential) {
  const ref = CLIENT_SECRET_REFS[client.clientId];
  const pinned = ref && process.env[ref]?.trim();
  console.log(`  ${client.clientName}`);
  console.log(`    realm         ${client.realm}`);
  console.log(`    client_id     ${client.clientId}`);
  console.log(`    client_secret ${clientSecretFor(client.clientId)}`);
  if (ref) {
    console.log(`    pinned by     ${ref} ${pinned ? '(set, so it wins over the derived value)' : '(unset, so the derived value is used)'}`);
  }
  console.log('');
}

console.log(`  ${confidential.length} confidential clients. Public clients hold no secret by design.\n`);

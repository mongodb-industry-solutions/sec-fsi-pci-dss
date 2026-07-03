/**
 * npm run setup:keys
 *
 * Generates and registers RSA-2048 OAuth signing keypair.
 * Behaviour depends on PSP_OAUTH_KEY_PROVIDER:
 *
 *   local (default)
 *     - Writes private.pem to PSP_OAUTH_KEY_STORE_DIR (default: ./keys/)
 *     - Registers public key in Atlas partyAuthenticationKey collection
 *     - Safe to re-run: skips if private.pem already exists (use --force to regenerate)
 *
 *   aws
 *     - If PSP_OAUTH_AWS_KEY_ARN is set: uses existing CMK, fetches public key from KMS
 *     - If PSP_OAUTH_AWS_KEY_ARN is empty: creates a new RSA_2048 CMK in KMS, prints ARN
 *     - Registers public key in Atlas partyAuthenticationKey collection
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { MongoClient } from 'mongodb';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const force = process.argv.includes('--force');
const provider = process.env.PSP_OAUTH_KEY_PROVIDER ?? process.env.OAUTH_KEY_PROVIDER ?? 'local';

async function run(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required in .env');

  const dbName = process.env.MONGODB_DB_NAME ?? 'pci_demo';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const col = db.collection('partyAuthenticationKey');

    if (provider === 'aws') {
      await runAwsProvider(col);
    } else {
      await runLocalProvider(col);
    }
  } finally {
    await client.close();
  }
}

async function runLocalProvider(col: any): Promise<void> {
  const storeDir = path.resolve(process.env.PSP_OAUTH_KEY_STORE_DIR ?? process.env.OAUTH_KEY_STORE_DIR ?? './keys');
  const privateKeyPath = path.join(storeDir, 'private.pem');
  const publicKeyPath = path.join(storeDir, 'public.pem');

  if (fs.existsSync(privateKeyPath) && !force) {
    console.log(`\n[setup:keys] Private key already exists at ${privateKeyPath}`);
    console.log('  Use --force to regenerate.\n');
    // Still register public key in case collection is empty
    const pem = fs.readFileSync(privateKeyPath, 'utf8');
    const privKey = crypto.createPrivateKey(pem);
    const pubKey = crypto.createPublicKey(privKey);
    const der = pubKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const kid = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
    const publicKeyPem = pubKey.export({ type: 'spki', format: 'pem' }) as string;
    // Ensure the public key is also present on disk (derived from the private key)
    fs.writeFileSync(publicKeyPath, publicKeyPem, { mode: 0o644 });
    await upsertPublicKey(col, kid, publicKeyPem);
    console.log(`  kid: ${kid}`);
    console.log(`  Public key:  ${publicKeyPath}`);
    return;
  }

  fs.mkdirSync(storeDir, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.writeFileSync(privateKeyPath, privateKey as string, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey as string, { mode: 0o644 });

  const der = crypto.createPublicKey(publicKey as string).export({ type: 'spki', format: 'der' }) as Buffer;
  const kid = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);

  await upsertPublicKey(col, kid, publicKey as string);

  // Add backend/keys/ to .gitignore if not already there
  const gitignorePath = path.resolve(__dirname, '../../../.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('backend/keys/')) {
      fs.appendFileSync(gitignorePath, '\n# OAuth / RSA private keys (never commit)\nbackend/keys/\n');
      console.log('  Added backend/keys/ to .gitignore');
    }
  }

  console.log('\n[setup:keys] RSA-2048 keypair generated:');
  console.log(`  kid:         ${kid}`);
  console.log(`  Private key: ${privateKeyPath}  (chmod 600, never committed)`);
  console.log(`  Public key:  ${publicKeyPath}  (chmod 644) + registered in Atlas partyAuthenticationKey`);
  console.log('\nNext steps:');
  console.log('  npm run setup:seed');
  console.log('  npm run dev\n');
}

async function runAwsProvider(col: any): Promise<void> {
  // @ts-ignore — optional peer dependency
  const { KMSClient, GetPublicKeyCommand, CreateKeyCommand } = await import('@aws-sdk/client-kms');
  const region = process.env.PSP_OAUTH_AWS_REGION ?? process.env.OAUTH_AWS_REGION ?? 'us-east-1';
  const kms = new KMSClient({ region });

  let keyArn = process.env.PSP_OAUTH_AWS_KEY_ARN ?? process.env.OAUTH_AWS_KEY_ARN;

  if (!keyArn) {
    console.log('[setup:keys] OAUTH_AWS_KEY_ARN not set — creating new RSA_2048 CMK in KMS...');
    const result = await kms.send(new CreateKeyCommand({
      Description: 'PSP OAuth RS256 JWT signing key',
      KeyUsage: 'SIGN_VERIFY',
      KeySpec: 'RSA_2048',
    }));
    keyArn = result.KeyMetadata!.Arn!;
    console.log(`  Created CMK: ${keyArn}`);
    console.log(`  Add to .env: OAUTH_AWS_KEY_ARN=${keyArn}`);
  }

  const result = await kms.send(new GetPublicKeyCommand({ KeyId: keyArn }));
  const der = Buffer.from(result.PublicKey!);
  const keyObj = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  const publicKeyPem = keyObj.export({ type: 'spki', format: 'pem' }) as string;
  const kid = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);

  await upsertPublicKey(col, kid, publicKeyPem);

  console.log('\n[setup:keys] AWS KMS key registered:');
  console.log(`  kid:         ${kid}`);
  console.log(`  CMK ARN:     ${keyArn}`);
  console.log('  Public key:  registered in Atlas partyAuthenticationKey');
  console.log('  Private key: never leaves AWS KMS hardware\n');
}

async function upsertPublicKey(col: any, kid: string, publicKeyPem: string): Promise<void> {
  const existing = await col.findOne({ keyId: kid });
  if (!existing) {
    await col.insertOne({
      keyId: kid,
      keyStatus: 'active',
      keyAlgorithm: 'RS256',
      keyModulusLength: 2048,
      publicKeyPem,
      keyCreatedDateTime: new Date(),
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'AuthenticationKey',
      schemaVersion: 1,
    });
    console.log(`  Registered kid=${kid} in Atlas partyAuthenticationKey`);
  } else {
    console.log(`  Key kid=${kid} already registered in Atlas`);
  }
}

run().catch((err) => {
  console.error('[setup:keys] Error:', err.message);
  process.exit(1);
});

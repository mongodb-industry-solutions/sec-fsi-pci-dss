import { randomBytes } from 'crypto';

// MongoDB Queryable Encryption local KMS requires a 96-byte master key.
const key = randomBytes(96).toString('base64');

console.log('\n🔑  Local Master Key generated (96 bytes, base64)\n');
console.log('Add the following line to your .env file:\n');
console.log(`LOCAL_MASTER_KEY_BASE64=${key}`);
console.log('\nAlso ensure:\n  KMS_PROVIDER=local\n');

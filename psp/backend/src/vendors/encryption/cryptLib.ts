import { resolveCryptSharedLibPath } from '@ist-sec/mongo-compat';
import { config } from '../../config';

/**
 * Resolves the path to the MongoDB Automatic Encryption Shared Library
 * (mongo_crypt_v1.dll / .dylib / .so), using the shared resolution chain in
 * `@ist-sec/mongo-compat` (explicit path → platform defaults → node_modules), and logs the
 * outcome in PSP's own style.
 *
 * If the library cannot be found, returns undefined and the caller should
 * set cryptSharedLibRequired: false so MongoDB falls back to auto-discovery
 * or mongocryptd (if installed).
 *
 * Download the library from:
 *   https://www.mongodb.com/try/download/enterprise
 *   → Select platform → "Cryptography Library (crypt_shared)"
 */

export interface CryptLibOptions {
  /** Absolute path to the crypt_shared library, or undefined if not found. */
  cryptSharedLibPath?: string;
  /**
   * When true, MongoDB throws if the library is not loaded.
   * When false, it attempts auto-discovery and falls back to mongocryptd.
   */
  cryptSharedLibRequired: boolean;
}

const LIB_NAME: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'mongo_crypt_v1.dll',
  darwin: 'mongo_crypt_v1.dylib',
  linux: 'mongo_crypt_v1.so',
};

export function resolveCryptLibOptions(): CryptLibOptions {
  const envPath = config.mongodb.cryptSharedLibPath;
  const resolved = resolveCryptSharedLibPath(envPath);
  if (envPath && resolved.source !== 'explicit') {
    console.warn(`[crypt] WARNING: MONGODB_CRYPT_SHARED_LIB_PATH="${envPath}" does not exist  -  ignoring.`);
  }

  if (resolved.path) {
    if (resolved.source === 'explicit') {
      console.log(`[crypt] Using library from MONGODB_CRYPT_SHARED_LIB_PATH: ${resolved.path}`);
    } else if (resolved.source === 'default-path') {
      console.log(`[crypt] Found library at default path: ${resolved.path}`);
      console.log(`[crypt] Tip: set MONGODB_CRYPT_SHARED_LIB_PATH=${resolved.path} in .env to skip auto-detection.`);
    } else {
      console.log(`[crypt] Found library in node_modules: ${resolved.path}`);
    }
    return { cryptSharedLibPath: resolved.path, cryptSharedLibRequired: true };
  }

  // Not found  -  warn with download instructions
  const libName = LIB_NAME[process.platform];
  console.warn(
    '\n[crypt] WARNING: mongo_crypt_v1 shared library not found.\n' +
    '  MongoDB Queryable Encryption requires this library.\n' +
    '\n' +
    '  1. Download from: https://www.mongodb.com/try/download/enterprise\n' +
    '     → Select your platform → "Cryptography Library (crypt_shared)"\n' +
    '\n' +
    '  2. Add to .env:\n' +
    `     MONGODB_CRYPT_SHARED_LIB_PATH=/path/to/${libName ?? 'mongo_crypt_v1.*'}\n` +
    '\n' +
    '  3. Re-run: npm run setup:seed\n'
  );

  // cryptSharedLibRequired: false → attempt auto-discovery; will error if truly absent
  return { cryptSharedLibRequired: false };
}

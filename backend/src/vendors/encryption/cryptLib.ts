import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Resolves the path to the MongoDB Automatic Encryption Shared Library
 * (mongo_crypt_v1.dll / .dylib / .so).
 *
 * Resolution order:
 *   1. MONGODB_CRYPT_SHARED_LIB_PATH env var (explicit, highest priority)
 *   2. Platform-specific default install locations
 *
 * If the library cannot be found, returns undefined and the caller should
 * set cryptSharedLibRequired: false so MongoDB falls back to auto-discovery
 * or mongocryptd (if installed).
 *
 * Download the library from:
 *   https://www.mongodb.com/try/download/enterprise
 *   → Select platform → "Cryptography Library (crypt_shared)"
 */

const LIB_NAME: Partial<Record<NodeJS.Platform, string>> = {
  win32:  'mongo_crypt_v1.dll',
  darwin: 'mongo_crypt_v1.dylib',
  linux:  'mongo_crypt_v1.so',
};

const DEFAULT_PATHS: Partial<Record<NodeJS.Platform, string[]>> = {
  win32: [
    'C:/Program Files/MongoDB/Shared Library/bin/mongo_crypt_v1.dll',
    'C:/Program Files/MongoDB/Cryptography Library/bin/mongo_crypt_v1.dll',
    'C:/Program Files/MongoDB/Server/8.0/bin/mongo_crypt_v1.dll',
    'C:/Program Files/MongoDB/Server/7.0/bin/mongo_crypt_v1.dll',
  ],
  darwin: [
    '/usr/local/lib/mongo_crypt_v1.dylib',
    '/opt/homebrew/lib/mongo_crypt_v1.dylib',
    '/usr/lib/mongo_crypt_v1.dylib',
  ],
  linux: [
    '/usr/lib/mongo_crypt_v1.so',
    '/usr/local/lib/mongo_crypt_v1.so',
    '/usr/lib/x86_64-linux-gnu/mongo_crypt_v1.so',
  ],
};

export interface CryptLibOptions {
  /** Absolute path to the crypt_shared library, or undefined if not found. */
  cryptSharedLibPath?: string;
  /**
   * When true, MongoDB throws if the library is not loaded.
   * When false, it attempts auto-discovery and falls back to mongocryptd.
   */
  cryptSharedLibRequired: boolean;
}

export function resolveCryptLibOptions(): CryptLibOptions {
  const libName = LIB_NAME[process.platform];

  // 1. Explicit env var takes highest priority
  const envPath = process.env.MONGODB_CRYPT_SHARED_LIB_PATH;
  if (envPath) {
    if (existsSync(envPath)) {
      console.log(`[crypt] Using library from MONGODB_CRYPT_SHARED_LIB_PATH: ${envPath}`);
      return { cryptSharedLibPath: envPath, cryptSharedLibRequired: true };
    }
    console.warn(`[crypt] WARNING: MONGODB_CRYPT_SHARED_LIB_PATH="${envPath}" does not exist  -  ignoring.`);
  }

  // 2. Default platform locations
  if (libName) {
    const defaults = DEFAULT_PATHS[process.platform] ?? [];
    for (const candidate of defaults) {
      if (existsSync(candidate)) {
        console.log(`[crypt] Found library at default path: ${candidate}`);
        console.log(`[crypt] Tip: set MONGODB_CRYPT_SHARED_LIB_PATH=${candidate} in .env to skip auto-detection.`);
        return { cryptSharedLibPath: candidate, cryptSharedLibRequired: true };
      }
    }

    // 3. Try resolving from node_modules (some versions ship it there)
    try {
      const pkgJson = require.resolve('mongodb-client-encryption/package.json');
      const pkgDir  = join(pkgJson, '..', 'lib', 'binding');
      const libPath = join(pkgDir, libName);
      if (existsSync(libPath)) {
        console.log(`[crypt] Found library in node_modules: ${libPath}`);
        return { cryptSharedLibPath: libPath, cryptSharedLibRequired: true };
      }
    } catch { /* package not found  -  skip */ }
  }

  // Not found  -  warn with download instructions
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

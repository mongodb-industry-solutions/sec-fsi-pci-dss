import * as crypto from 'crypto';

// -- Atlas Admin API Basic Auth (over HTTPS) ---------------------------------─

export function buildBasicAuthHeader(publicKey: string, privateKey: string): string {
    const token = Buffer.from(`${publicKey}:${privateKey}`).toString('base64');
    return `Basic ${token}`;
}

export function sha256(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
}

export function jwtSecret(): string {
    return process.env.PSP_JWT_SECRET ?? 'demo-local-secret-change-in-production';
}

// -- Blind index (deterministic keyed HMAC over encrypted PII) ----------------─
//
// Queryable Encryption cannot enforce a unique index on an encrypted field, so to
// guarantee uniqueness on QE fields (e.g. party.partyMobilePhoneNumber) we store a
// keyed HMAC of the normalized value in a separate NON-encrypted field and put a
// unique index on that. The HMAC reveals nothing without the key, so it is safe to
// index in plaintext. See technical-spec §Blind Index and ADR-036 (key management).

function pspEnvVar(name: string): string | undefined {
    return process.env[`PSP_${name}`] ?? process.env[name];
}

/**
 * Resolve the HMAC key material for the blind index, in priority order:
 *   1. PSP_BLIND_INDEX_KEY: explicit dedicated key (recommended for prod)
 *   2. KMS_LOCAL_MASTER_KEY (QE key): derive a dedicated subkey via HKDF-SHA256 so the
 *                                       QE master key is never reused verbatim for HMAC
 *                                       (domain separation; it is also the CHD CMK).
 *   3. demo default: dev only; predictable, never use in production.
 * Changing whichever source is active invalidates all existing digests (requires a re-seed
 * or backfill), so the resolution must stay stable across every process.
 */
export function blindIndexKey(): Buffer {
    const explicit = pspEnvVar('BLIND_INDEX_KEY');
    if (explicit) return Buffer.from(explicit, 'utf8');

    const master = pspEnvVar('KMS_LOCAL_MASTER_KEY') ?? pspEnvVar('LOCAL_MASTER_KEY');
    if (master) {
        const ikm = Buffer.from(master, 'base64');
        return Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), 'psp-blind-index-v1', 32));
    }

    return Buffer.from('demo-blind-index-key-change-in-production', 'utf8');
}

/** Normalize a phone number to a canonical form: keep a leading '+', strip everything non-digit. */
export function normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
}

/** Deterministic keyed HMAC-SHA256 blind index of an already-normalized value. */
export function blindIndex(normalizedValue: string): string {
    return crypto.createHmac('sha256', blindIndexKey()).update(normalizedValue).digest('hex');
}

/** Convenience: normalize + blind-index a phone number for the uniqueness digest. */
export function phoneDigest(phone: string): string {
    return blindIndex(normalizePhone(phone));
}
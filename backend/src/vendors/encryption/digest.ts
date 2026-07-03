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

export function blindIndexKey(): string {
    return process.env.PSP_BLIND_INDEX_KEY ?? 'demo-blind-index-key-change-in-production';
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
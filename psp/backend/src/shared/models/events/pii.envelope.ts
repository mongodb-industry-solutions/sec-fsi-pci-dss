// Sensitive-data classes (architecture §7.9). Two regimes: do NOT conflate.
// CHD (PAN/CVV/expiry): PCI DSS, encrypted `chd` envelope (§7.8), issuer-adapter decrypt only.
// PII (name/DOB/email/...): GDPR, reference-first; encrypted `pii` envelope only when the party is
// not in our store. Same crypto scheme as §7.8, but the decrypt grant also includes the
// case/investigation service.

/** Data sensitivity class an attribute belongs to (§7.9). */
export type SensitiveDataClass = 'chd' | 'pii';

/**
 * Encrypted PII envelope for an external party not present in the QE store.
 * Opaque ciphertext using the §7.8 scheme; carried on the bus only when a reference cannot be used.
 */
export interface PiiEnvelope {
  pii: string;                              // application-encrypted PII (opaque token, §7.8 format)
}

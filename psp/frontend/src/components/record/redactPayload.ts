// What a raw or debug panel may render: BSON Binary subType 06 becomes a hex preview plus a
// ciphertext marker, and sensitive-tier keys are redacted by name at any depth.

/** QE:none / sensitive-tier keys. Redacted by name in any raw or debug payload. */
export const SENSITIVE_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  // customer agreement
  'customerAgreementResidentialAddress',
  'customerAgreementRiskNotes',
  'customerAgreementSourceOfFunds',
  'customerAgreementPurposeOfRelationship',
  'customerAgreementKycCheckScreeningProviderRef',
  'governmentIdentificationReference', // legacy, still redacted for pre-v32 documents
  // party
  'partyPostalAddress',
  // card transaction
  'rawGatewayPayload',
  'processorTransactionMetadata',
  // / vault
  'paymentCardNumber',
  'cardServiceCode',
  // payout and execution
  'payoutAccountIban',
  'payoutAccountRoutingNumber',
  'destinationIban',
  // request to pay
  'payeeAlias',
  'payerAlias',
  'unstructuredRemittance',
  'structuredAddress',
  'payeeName',
]);

export const REDACTED_MARKER = '[redacted: QE:none, reveal is audited]';
export const CIPHERTEXT_MARKER = 'QE ciphertext';

function isBinary(v: unknown): v is { $binary: { base64?: string; subType?: string } } {
  if (v === null || typeof v !== 'object') return false;
  const b = (v as Record<string, unknown>)['$binary'];
  return !!b && typeof b === 'object' && (b as Record<string, unknown>)['subType'] === '06';
}

/** Short hex preview of a ciphertext value, e.g. `\\x0a\\x1b... QE ciphertext`. */
export function ciphertextPreview(v: { $binary: { base64?: string } }): string {
  const b64 = v.$binary.base64 ?? '';
  let hex = '';
  try {
    // atob, not Buffer: this module renders in the browser, where Next.js does not
    // polyfill Buffer (the preview would silently come back empty).
    const bytes = atob(b64).slice(0, 8);
    hex = Array.from(bytes, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
  } catch {
    hex = '';
  }
  return `${hex}... ${CIPHERTEXT_MARKER}`;
}

/**
 * Deep copy of a payload that is safe to render in a raw or debug panel: ciphertext becomes a hex
 * preview, sensitive-tier keys become a redaction marker, everything else is untouched.
 */
export function redactForDisplay(value: unknown): unknown {
  if (isBinary(value)) return ciphertextPreview(value);
  if (Array.isArray(value)) return value.map(redactForDisplay);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_PAYLOAD_KEYS.has(k) ? REDACTED_MARKER : redactForDisplay(v);
    }
    return out;
  }
  return value;
}

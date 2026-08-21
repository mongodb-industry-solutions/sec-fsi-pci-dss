/**
 * Unit tests: v32 C4 raw/debug panels never render a sensitive value (test 25)
 * Source: frontend/src/components/record/redactPayload.ts
 *
 * Before v32 the ciphertext formatter lived only inside RawDocumentPanel, so RawMongoPanel's
 * `kind: 'static'` sections and DebugRawJson rendered their payload verbatim. On the investigation
 * page that dumped the decrypted customer profile (QE:none address and risk notes) into the debug
 * JSON, unmasked and unlogged: a disclosure with no audit event (PCI DSS).
 */
import { describe, it, expect } from 'vitest';
import {
  redactForDisplay,
  ciphertextPreview,
  SENSITIVE_PAYLOAD_KEYS,
  REDACTED_MARKER,
  CIPHERTEXT_MARKER,
} from '../../../../../psp/frontend/src/components/record/redactPayload';

const binary = (b64: string) => ({ $binary: { base64: b64, subType: '06' } });

describe('ciphertextPreview', () => {
  it('renders a short hex preview plus the ciphertext marker', () => {
    const out = ciphertextPreview(binary(Buffer.from('0123456789abcdef0011', 'hex').toString('base64')));
    expect(out).toContain(CIPHERTEXT_MARKER);
    expect(out).toMatch(/^(\\x[0-9a-f]{2}){8}\.\.\./);
  });

  it('does not throw on a malformed base64 payload', () => {
    expect(() => ciphertextPreview({ $binary: { base64: '!!!not base64!!!' } })).not.toThrow();
  });
});

describe('redactForDisplay', () => {
  it('previews QE ciphertext instead of the raw binary', () => {
    const doc = { partyName: binary('AQIDBAUGBwgJ'), customerSegment: 'retail' };
    const out = redactForDisplay(doc) as Record<string, unknown>;
    expect(String(out.partyName)).toContain(CIPHERTEXT_MARKER);
    expect(out.customerSegment).toBe('retail');
  });

  it('redacts every sensitive-tier key by name, whatever its shape', () => {
    const doc = {
      customerAgreementResidentialAddress: { streetAddress: '1 Calle Mayor', city: 'Madrid' },
      customerAgreementRiskNotes: 'no adverse media',
      rawGatewayPayload: { pan: '4111111111111111' },
      payoutAccountIban: 'ES9121000418450200051332',
      customerSegment: 'retail',
    };
    const out = redactForDisplay(doc) as Record<string, unknown>;
    expect(out.customerAgreementResidentialAddress).toBe(REDACTED_MARKER);
    expect(out.customerAgreementRiskNotes).toBe(REDACTED_MARKER);
    expect(out.rawGatewayPayload).toBe(REDACTED_MARKER);
    expect(out.payoutAccountIban).toBe(REDACTED_MARKER);
    expect(out.customerSegment).toBe('retail');
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('Calle Mayor');
    expect(serialized).not.toContain('adverse media');
    expect(serialized).not.toContain('4111111111111111');
    expect(serialized).not.toContain('ES9121000418450200051332');
  });

  it('redacts nested occurrences, including inside arrays', () => {
    const doc = {
      results: [
        { customerName: 'Luis', sensitive: { customerAgreementRiskNotes: 'flagged' } },
        { customerName: 'Ana', sensitive: { customerAgreementRiskNotes: 'clean' } },
      ],
    };
    const serialized = JSON.stringify(redactForDisplay(doc));
    expect(serialized).not.toContain('flagged');
    expect(serialized).not.toContain('clean');
    expect(serialized).toContain('Luis');
  });

  it('still redacts the deprecated government-ID reference on a pre-v32 document', () => {
    const out = redactForDisplay({ governmentIdentificationReference: 'SYNTH-LF-4821' }) as Record<string, unknown>;
    expect(out.governmentIdentificationReference).toBe(REDACTED_MARKER);
  });

  it('leaves the searchable identity document visible (lookup tier, the demo needs it)', () => {
    const doc = { customerAgreementGovernmentID: { number: 'GB31454621', type: 'driver_license' } };
    const out = redactForDisplay(doc) as Record<string, unknown>;
    expect(out.customerAgreementGovernmentID).toEqual({ number: 'GB31454621', type: 'driver_license' });
  });

  it('passes primitives and nulls through untouched', () => {
    expect(redactForDisplay(null)).toBeNull();
    expect(redactForDisplay(42)).toBe(42);
    expect(redactForDisplay('plain')).toBe('plain');
  });
});

describe('SENSITIVE_PAYLOAD_KEYS coverage', () => {
  // The QE:none set in backend/src/vendors/encryption/encryptedFieldsMaps.ts. Kept in sync by hand,
  // so this test states the expectation explicitly and fails loudly if one is dropped.
  const EXPECTED_QE_NONE = [
    'customerAgreementResidentialAddress',
    'customerAgreementRiskNotes',
    'customerAgreementSourceOfFunds',
    'customerAgreementPurposeOfRelationship',
    'partyPostalAddress',
    'rawGatewayPayload',
    'processorTransactionMetadata',
    'payoutAccountIban',
    'payoutAccountRoutingNumber',
    'destinationIban',
    'payeeAlias',
    'payerAlias',
    'unstructuredRemittance',
    'structuredAddress',
    'payeeName',
  ];

  it('covers every QE:none field the backend declares', () => {
    const missing = EXPECTED_QE_NONE.filter((k) => !SENSITIVE_PAYLOAD_KEYS.has(k));
    expect(missing).toEqual([]);
  });
});

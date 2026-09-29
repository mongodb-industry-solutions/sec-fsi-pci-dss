'use client';
import { redactForDisplay, SENSITIVE_PAYLOAD_KEYS, REDACTED_MARKER, CIPHERTEXT_MARKER } from './record/redactPayload';

interface Props {
  document: Record<string, unknown>;
  collection: string;
}

// v32 C4: the ciphertext preview and the sensitive-key redaction now live in one shared module
// (components/record/redactPayload.ts) so every raw/debug surface behaves identically.
function formatValue(key: string, val: unknown): { display: string; isCipher: boolean } {
  if (SENSITIVE_PAYLOAD_KEYS.has(key)) return { display: `"${REDACTED_MARKER}"`, isCipher: true };
  const redacted = redactForDisplay(val);
  if (typeof redacted === 'string' && redacted.includes(CIPHERTEXT_MARKER)) {
    return { display: `"${redacted}"`, isCipher: true };
  }
  return { display: JSON.stringify(redacted, null, 2), isCipher: false };
}

export function RawDocumentPanel({ document: doc, collection }: Props) {
  return (
    <div className="bg-gray-900 text-green-300 rounded-lg p-4 font-mono text-xs overflow-auto max-h-96">
      <div className="mb-2 text-gray-400 text-[11px]">
        Atlas · {collection} · raw document (no auto-decryption)
      </div>
      <pre className="whitespace-pre-wrap break-all">
        {'{'}
        {Object.entries(doc).map(([k, v]) => {
          const { display, isCipher } = formatValue(k, v);
          return (
            <div key={k} className={`pl-4 ${isCipher ? 'text-yellow-400' : ''}`}>
              <span className="text-blue-300">&quot;{k}&quot;</span>:{' '}
              {isCipher ? display : <span>{display}</span>}
            </div>
          );
        })}
        {'}'}
      </pre>
      <div className="mt-3 text-[11px] text-gray-500 space-x-4">
        <span>🔒 QE ciphertext</span>
        <span>✅ Plaintext (not CHD)</span>
      </div>
    </div>
  );
}

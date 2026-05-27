'use client';

interface Props {
  document: Record<string, unknown>;
  collection: string;
}

function formatValue(key: string, val: unknown): { display: string; isCipher: boolean } {
  if (val !== null && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    // BSON Binary (ciphertext) has $binary.subType === '06'
    if (obj['$binary'] && (obj['$binary'] as Record<string, unknown>)['subType'] === '06') {
      const b64 = (obj['$binary'] as Record<string, unknown>)['base64'] as string;
      const hex = Buffer.from(b64 ?? '', 'base64')
        .subarray(0, 8)
        .toString('hex')
        .replace(/../g, '\\x$&');
      return { display: `"${hex}..." 🔒 QE ciphertext`, isCipher: true };
    }
    return { display: JSON.stringify(val, null, 2), isCipher: false };
  }
  return { display: JSON.stringify(val), isCipher: false };
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

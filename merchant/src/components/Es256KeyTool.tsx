'use client';
// Standalone ES256 key generator (v25 profile utility). These are DISTINCT, THROWAWAY keys, NOT the
// login credential. They are generated extractable so they can be downloaded (JWK/PEM), are never stored
// in the login authenticator, are never enrolled at the PSP, and are never used to authenticate. Their
// download therefore has no impact on login/system security.
import { useState } from 'react';
import { KeyRound, Download, RefreshCw, TriangleAlert } from 'lucide-react';
import { generateEs256, downloadPublic, downloadKeyPair, type GeneratedKeyPair } from '@/lib/keygen';

export default function Es256KeyTool() {
  const [pair, setPair] = useState<GeneratedKeyPair | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try { setPair(await generateEs256()); } finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-line p-5">
      <h2 className="flex items-center gap-2 font-semibold text-ink">
        <KeyRound className="h-5 w-5 text-leaf-deep" aria-hidden /> ES256 key generator
      </h2>
      <p className="mt-1 text-sm text-muted">
        Generate a distinct, throwaway P-256 (ES256) key pair for testing. These keys are separate from your
        passwordless login credential: they are not enrolled and cannot be used to sign in, so downloading
        them is safe.
      </p>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Your login credential is never exported. This tool never touches it.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={generate} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden /> {pair ? 'Regenerate' : 'Generate key pair'}
        </button>
        {pair && (
          <>
            <button onClick={() => downloadPublic(pair)} className="btn-ghost inline-flex items-center gap-1.5 text-sm">
              <Download className="h-4 w-4" aria-hidden /> Download public
            </button>
            <button onClick={() => downloadKeyPair(pair)} className="btn-ghost inline-flex items-center gap-1.5 text-sm">
              <Download className="h-4 w-4" aria-hidden /> Download key pair
            </button>
          </>
        )}
      </div>

      {pair && (
        <pre className="mt-4 max-h-48 overflow-auto rounded-xl border border-line bg-surface-alt p-3 font-mono text-[11px] text-muted">
{pair.publicPem}
        </pre>
      )}
    </section>
  );
}

'use client';
// Enroll / manage the passwordless LOGIN credential for this browser (v25). Runs inside an authenticated
// session. Registration ceremony: generate a non-extractable ES256 key (browser) → fetch challenge →
// sign → register the PUBLIC key at the PSP → persist local metadata. The private key never leaves the
// browser and is never exported.
import { useEffect, useState } from 'react';
import { Fingerprint, Plus, ShieldCheck, Trash2, ExternalLink } from 'lucide-react';
import {
  hasCredential, createCredential, saveMeta, signWithCredential, deleteCredential,
} from '@/lib/authenticator';
import { BRAND } from '@/lib/brand';

export default function EnrollPasswordless({
  sub, email, credentialsUrl,
}: { sub: string; email?: string; credentialsUrl: string }) {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { hasCredential().then(setEnrolled).catch(() => setEnrolled(false)); }, []);

  const enroll = async () => {
    setBusy(true); setMsg(null);
    try {
      const cred = await createCredential();
      const chRes = await fetch('/api/auth/ciba/enroll/challenge', { method: 'POST' });
      const ch = await chRes.json();
      if (!chRes.ok) throw new Error(ch.error_description ?? 'Could not get an enrollment challenge');
      const signature = await signWithCredential(cred.credentialId, ch.challenge);
      const regRes = await fetch('/api/auth/ciba/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge: ch.challenge,
          publicKeyPem: cred.publicKeyPem,
          alg: cred.alg,
          signature,
          credentialId: cred.credentialId,
          authenticatorMetadata: { deviceName: 'This browser', createdVia: 'merchant-app' },
        }),
      });
      const reg = await regRes.json();
      if (!regRes.ok) throw new Error(reg.error_description ?? 'Enrollment failed');
      await saveMeta({ credentialId: cred.credentialId, alg: cred.alg, sub, email, createdAt: new Date().toISOString() });
      setEnrolled(true);
      setMsg({ tone: 'ok', text: 'Passwordless login enabled on this browser.' });
    } catch (e) {
      await deleteCredential().catch(() => {});
      setMsg({ tone: 'err', text: (e as Error).message || 'Enrollment failed' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true); setMsg(null);
    try {
      await deleteCredential();
      setEnrolled(false);
      setMsg({ tone: 'ok', text: `Removed from this browser. Revoke it at ${BRAND.full} to disable it everywhere.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="flex items-center gap-2 font-semibold text-ink">
        <Fingerprint className="h-5 w-5 text-leaf-deep" aria-hidden /> Passwordless login
        {enrolled && <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-leaf-deep"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Enabled</span>}
      </h2>
      <p className="mt-1 text-sm text-muted">
        Sign in without a password from this browser. A key pair is generated here; only the public key is
        sent to {BRAND.full}. The private key is non-extractable, stays in this browser, and is never exported.
      </p>

      {msg && (
        <p className={`mt-3 text-sm ${msg.tone === 'err' ? 'text-[var(--err)]' : 'text-leaf-deep'}`}>{msg.text}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {enrolled === null ? (
          <span className="text-sm text-muted">Checking…</span>
        ) : enrolled ? (
          <button onClick={remove} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-[var(--err)] hover:bg-[var(--err-bg)] disabled:opacity-50">
            <Trash2 className="h-4 w-4" aria-hidden /> Remove from this browser
          </button>
        ) : (
          <button onClick={enroll} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden /> {busy ? 'Enabling…' : 'Enable passwordless login'}
          </button>
        )}
        <a href={credentialsUrl} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center gap-1.5 text-sm">
          <ExternalLink className="h-4 w-4" aria-hidden /> Manage keys at {BRAND.full}
        </a>
      </div>
    </section>
  );
}

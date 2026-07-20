'use client';
// Passwordless login (v25). Shown ONLY when an enrolled credential exists in this browser (else nothing,
// so the SSO button remains the sole option — graceful fallback). Runs the CIBA same-device flow entirely
// redirect-free: start → fetch challenge → sign (IndexedDB key) → approve → poll → redirect. If the PSP
// says the credential is gone (revoked), we clear the local key and fall back to SSO.
import { useEffect, useState } from 'react';
import { Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import { hasCredential, getMeta, sign, loginHintToken, deleteCredential } from '@/lib/authenticator';

type Phase = 'idle' | 'starting' | 'confirm' | 'approving' | 'polling' | 'error';

// Friendly copy for the OAuth/CIBA error codes the PSP can return, so the UI never shows a raw
// "bc-authorize failed: 400 {…}" string. Unknown codes fall back to the server's description.
const FRIENDLY: Record<string, string> = {
  unauthorized_client: 'Passwordless sign-in is not enabled for this store yet. Please use “Login with Sec4 Pay”.',
  unknown_user_id: 'This device is not enrolled for passwordless sign-in. Enable it from your profile after signing in.',
  invalid_scope: 'This store is not allowed the permissions needed for passwordless sign-in.',
  access_denied: 'The request was denied.',
  expired_token: 'The request expired. Please try again.',
  bc_authorize_failed: 'Could not reach Sec4 Pay. Please try again.',
  invalid_grant: 'This device is no longer enrolled. Please sign in with Sec4 Pay and re-enable passwordless.',
};

function friendly(code?: string, fallback?: string): string {
  return (code && FRIENDLY[code]) || fallback || 'Passwordless sign-in failed. Please try again.';
}

export default function PasswordlessLoginButton() {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [binding, setBinding] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { hasCredential().then(setAvailable).catch(() => setAvailable(false)); }, []);

  if (!available) return null;

  const fail = (msg: string) => { setError(msg); setPhase('error'); };

  const run = async () => {
    setError('');
    try {
      const meta = await getMeta();
      if (!meta) { setAvailable(false); return; }

      // 1) Initiate the backchannel request (confidential client, server-side).
      setPhase('starting');
      const startRes = await fetch('/api/auth/ciba/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_hint_token: loginHintToken(meta.sub) }),
      });
      const start = await startRes.json();
      if (!startRes.ok) return fail(friendly(start.error, start.error_description));
      const authReqId: string = start.auth_req_id;

      // 2) Fetch the challenge + binding message (Authentication Device step).
      const chRes = await fetch(`/api/auth/ciba/challenge?auth_req_id=${encodeURIComponent(authReqId)}`);
      const ch = await chRes.json();
      if (!chRes.ok) return fail(friendly(ch.error, ch.error_description));
      setBinding(ch.binding_message ?? '');
      setPhase('confirm');

      // 3) Sign the challenge with the non-extractable key and submit the assertion.
      setPhase('approving');
      const { credentialId, signature } = await sign(ch.challenge);
      const apRes = await fetch('/api/auth/ciba/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_req_id: authReqId, credentialId, signature }),
      });
      if (!apRes.ok) {
        const ap = await apRes.json().catch(() => ({}));
        // Credential revoked / unknown at the PSP → clear locally and fall back to SSO.
        if (apRes.status === 401 || apRes.status === 400) {
          await deleteCredential().catch(() => {});
          setAvailable(false);
          return fail('This device is no longer enrolled. Please sign in with Sec4 Pay and re-enable passwordless.');
        }
        return fail(friendly(ap.error, ap.error_description));
      }

      // 4) Poll the token endpoint until the session is established, then redirect.
      setPhase('polling');
      const interval = Math.max(Number(start.interval) || 5, 2) * 1000;
      const deadline = Date.now() + (Math.max(Number(start.expires_in) || 300, 60) * 1000);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, interval));
        const pRes = await fetch('/api/auth/ciba/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_req_id: authReqId }),
        });
        const p = await pRes.json();
        if (p.status === 'done') { window.location.assign('/products'); return; }
        if (p.status === 'pending' || p.status === 'slow_down') {
          if (Date.now() > deadline) return fail('Login timed out. Please try again.');
          continue;
        }
        if (p.status === 'denied') return fail(friendly('access_denied'));
        if (p.status === 'expired') return fail(friendly('expired_token'));
        return fail(friendly(undefined, p.error));
      }
    } catch (e) {
      fail((e as Error).message || 'Passwordless login failed');
    }
  };

  const busy = phase !== 'idle' && phase !== 'error';
  const label =
    phase === 'starting' ? 'Starting…' :
    phase === 'confirm' || phase === 'approving' ? 'Confirming…' :
    phase === 'polling' ? 'Signing you in…' :
    'Log in without password';

  return (
    <div className="relative mt-3">
      <button
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-2.5 font-semibold text-white ring-1 ring-white/20 transition duration-200 hover:bg-white/20 active:scale-[.98] disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Fingerprint className="h-4 w-4" aria-hidden />}
        {label}
      </button>
      {phase !== 'idle' && (binding || error) && (
        <p className={`mt-2 flex items-center gap-1.5 text-sm ${error ? 'text-[var(--err)]' : 'text-white/80'}`}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {error || (binding ? `Confirm code: ${binding}` : '')}
        </p>
      )}
    </div>
  );
}

'use client';
// "Passwordless credentials / security keys" — the user's enrolled authenticators (WebAuthn-style).
// Self-scoped (the caller's own `sub`). Enroll generates a real ECDSA P-256 key pair in the browser with
// a NON-EXTRACTABLE private key stored in IndexedDB; only the public key is sent to the server. Revoke
// forces re-enrollment; rotate replaces the key. Revoking a credential removes it from the passwordless
// (CIBA) approval path for every client (distinct from revoking one client's authorization under
// "Authorized Applications").
import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, RotateCcw, ShieldCheck } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { api, type EnrolledCredential } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';
import { generateAuthenticator, signChallenge, forgetAuthenticator } from '../../../../lib/passwordlessAuthenticator';

export default function PasswordlessCredentialsPage() {
  const confirm = useConfirm();
  const notify = useNotify();
  const [token, setToken] = useState('');
  const [credentials, setCredentials] = useState<EnrolledCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState('');

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (!t) { setLoading(false); return; }
    api.credentials.list(t)
      .then((r) => setCredentials(r.credentials))
      .catch(() => setCredentials([]))
      .finally(() => setLoading(false));
  }, []);

  const refresh = async (t: string) => {
    const r = await api.credentials.list(t);
    setCredentials(r.credentials);
  };

  // Registration ceremony: generate key (browser) -> challenge -> sign -> register public key.
  const enroll = async () => {
    if (!token) return;
    setBusy('enroll');
    try {
      const gen = await generateAuthenticator();
      const { challenge } = await api.credentials.challenge(token);
      const signature = await signChallenge(gen.credentialId, challenge);
      await api.credentials.register({
        challenge,
        publicKeyPem: gen.publicKeyPem,
        alg: gen.alg,
        signature,
        credentialId: gen.credentialId,
        authenticatorMetadata: { deviceName: deviceName.trim() || 'This device', createdVia: 'psp-portal' },
      }, token);
      setDeviceName('');
      await refresh(token);
      notify('Passwordless credential enrolled on this device', 'success');
    } catch (e) {
      notify((e as Error).message || 'Enrollment failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const rotate = async (cred: EnrolledCredential) => {
    if (!token) return;
    const ok = await confirm({ title: 'Rotate credential', message: `Generate a new key on this device and revoke "${cred.deviceName ?? cred.credentialId}"?`, confirmLabel: 'Rotate' });
    if (!ok) return;
    setBusy(cred.credentialId);
    try {
      const gen = await generateAuthenticator();
      const { challenge } = await api.credentials.challenge(token);
      const signature = await signChallenge(gen.credentialId, challenge);
      await api.credentials.rotate(cred.credentialId, {
        challenge, publicKeyPem: gen.publicKeyPem, alg: gen.alg, signature, credentialId: gen.credentialId,
        authenticatorMetadata: { deviceName: cred.deviceName ?? 'This device', createdVia: 'psp-portal' },
      }, token);
      await forgetAuthenticator(cred.credentialId);
      await refresh(token);
      notify('Credential rotated', 'success');
    } catch (e) {
      notify((e as Error).message || 'Rotation failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (cred: EnrolledCredential) => {
    if (!token) return;
    const ok = await confirm({ title: 'Revoke credential', message: `Revoke "${cred.deviceName ?? cred.credentialId}"? This removes it from passwordless sign-in for all apps.`, confirmLabel: 'Revoke', tone: 'danger' });
    if (!ok) return;
    setBusy(cred.credentialId);
    try {
      await api.credentials.revoke(cred.credentialId, token);
      await forgetAuthenticator(cred.credentialId).catch(() => {});
      setCredentials((cs) => cs.map((c) => c.credentialId === cred.credentialId ? { ...c, status: 'revoked' } : c));
      notify('Credential revoked', 'success');
    } catch (e) {
      notify((e as Error).message || 'Revocation failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={KeyRound}
        title="Credentials"
        description="Security keys registered on your devices for passwordless (CIBA) sign-in. Your private key never leaves this device."
        debugInfo="SD-91/SD-16 · partyEnrolledCredential · WebAuthn/FIDO2 · CIBA · NIST SP 800-63B AAL1 · PCI DSS Req 8"
      />

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-gray-500 shrink-0" />
          <h2 className="font-semibold text-gray-800 text-sm">Register a new security key</h2>
        </div>
        <p className="text-xs text-gray-500">
          A key pair is generated in your browser. Only the public key is stored on the server; the private
          key stays on this device (non-extractable, IndexedDB).
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="Device name (e.g. My laptop)"
            className="border rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]"
          />
          <button
            onClick={enroll}
            disabled={!token || busy === 'enroll'}
            className="flex items-center justify-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[#001E2B]"
          >
            <Plus size={15} /> {busy === 'enroll' ? 'Enrolling…' : 'Enroll this device'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-gray-500 shrink-0" />
          <h2 className="font-semibold text-gray-800 text-sm">My credentials</h2>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : credentials.length === 0 ? (
          <p className="text-sm text-gray-400">No passwordless credentials yet. Enroll a device above.</p>
        ) : (
          <ul className="divide-y">
            {credentials.map((c) => (
              <li key={c.credentialId} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800 truncate">{c.deviceName ?? c.credentialId}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border font-mono ${c.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>{c.status}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded border font-mono bg-gray-50 text-gray-500 border-gray-200">{c.alg}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Added {new Date(c.createdAt).toLocaleDateString()}
                    {c.lastUsedAt ? ` · last used ${new Date(c.lastUsedAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                {c.status === 'active' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => rotate(c)} disabled={busy === c.credentialId}
                      className="inline-flex items-center gap-1 text-xs border rounded-lg px-2.5 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      <RotateCcw size={13} /> Rotate
                    </button>
                    <button onClick={() => revoke(c)} disabled={busy === c.credentialId}
                      className="inline-flex items-center gap-1 text-xs border rounded-lg px-2.5 py-1.5 text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50">
                      <Trash2 size={13} /> Revoke
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

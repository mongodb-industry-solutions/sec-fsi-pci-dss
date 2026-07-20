// Profile + permissions: the signed-in user's identity and the exact scopes they granted
// to this merchant via Securit4 Pay SSO. Read-only; permissions are managed in Securit4 Pay.
import { redirect } from 'next/navigation';
import { CircleUserRound, Store, ShieldCheck, KeyRound, RefreshCw, LogOut, Info } from 'lucide-react';
import { getSession } from '@/lib/session';
import { ENV } from '@/lib/env';
import { Chip, InfoHint } from '@/components/ui/Bits';
import CopyButton from '@/components/ui/CopyButton';
import EnrollPasswordless from '@/components/EnrollPasswordless';
import Es256KeyTool from '@/components/Es256KeyTool';

// Human-readable meaning of each scope (display only; source of truth is the PSP catalog).
const SCOPE_INFO: Record<string, { label: string; desc: string }> = {
  openid: { label: 'Identity', desc: 'Confirm who you are (sign-in).' },
  profile: { label: 'Basic profile', desc: 'Your display name.' },
  'read:beneficiaries': { label: 'View beneficiaries', desc: 'See your saved payees (masked).' },
  'write:beneficiaries': { label: 'Manage beneficiaries', desc: 'Add or update your payees.' },
  'read:transactions': { label: 'View history', desc: 'See your operations made here.' },
  'read:accounts': { label: 'View accounts', desc: 'See your payout accounts (masked IBAN).' },
  'write:transfers': { label: 'Send transfers', desc: 'Move money on your behalf.' },
  'read:merchant_profile': { label: 'Merchant profile', desc: 'Read the merchant profile.' },
  'read:notifications': { label: 'Notifications', desc: 'Read your notifications.' },
  'write:payments': { label: 'Create payments', desc: 'Charge on the merchant’s behalf.' },
};

function scopeInfo(scope: string) {
  return SCOPE_INFO[scope] ?? { label: scope, desc: 'Access to ' + scope };
}

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/');

  const localPart = session.email?.includes('@') ? session.email.split('@')[0] : session.email;
  const displayName = session.name?.trim() || localPart?.trim() || 'Account';
  const initial = displayName.charAt(0).toUpperCase();
  const scopes = [...session.grantedScopes].sort();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <CircleUserRound className="h-6 w-6 text-leaf-deep" aria-hidden /> Profile and permissions
        <InfoHint label="Your Securit4 Pay identity and the access you granted to Espresso Works. Managed in your Securit4 Pay account." />
      </h1>

      {/* Identity */}
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-leaf/15 text-xl font-bold text-leaf-deep ring-1 ring-leaf/25">
            {initial}
          </span>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-ink">{displayName}</div>
            {session.email && <div className="truncate text-sm text-muted">{session.email}</div>}
            <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted">
              <Store className="h-3.5 w-3.5" aria-hidden /> Espresso Works
            </div>
          </div>
        </div>
        <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Account reference</dt>
            <dd className="flex items-center gap-1.5 font-mono text-xs text-ink">
              <span className="max-w-[16rem] truncate" title={session.sub}>{session.sub}</span>
              <CopyButton value={session.sub} label="account reference" />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Sign-in</dt>
            <dd className="text-ink">Securit4 Pay SSO (OAuth 2.0 / OIDC)</dd>
          </div>
        </dl>
      </section>

      {/* Permissions */}
      <section className="glass rounded-2xl p-5">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          <ShieldCheck className="h-5 w-5 text-leaf-deep" aria-hidden /> Permissions granted
          <span className="ml-auto"><Chip tone="accent">{scopes.length}</Chip></span>
        </h2>
        <p className="mt-1 text-sm text-muted">
          What you allowed Espresso Works to do with your Securit4 Pay account. We never see your card, password or full IBAN.
        </p>
        <ul className="mt-3 divide-y divide-line">
          {scopes.map((s) => {
            const info = scopeInfo(s);
            return (
              <li key={s} className="flex items-start gap-3 py-2.5">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-leaf-deep" aria-hidden />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{info.label}</div>
                  <div className="text-xs text-muted">{info.desc}</div>
                </div>
                <code className="ml-auto shrink-0 rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[11px] text-muted">{s}</code>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Passwordless login (v25): enroll a browser credential + manage it at Securit4 Pay */}
      <EnrollPasswordless sub={session.sub} email={session.email} credentialsUrl={ENV.pspCredentialsUrl()} />

      {/* Standalone ES256 key generator (throwaway keys, distinct from the login credential) */}
      <Es256KeyTool />

      {/* Manage */}
      <section className="rounded-2xl border border-line p-5">
        <p className="flex items-start gap-2 text-sm text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Permissions are managed in your Securit4 Pay account. Re-authorize to change what Espresso Works can access, or sign out.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a href="/api/auth/login" className="btn-ghost inline-flex items-center gap-1.5 text-sm">
            <RefreshCw className="h-4 w-4" aria-hidden /> Re-authorize
          </a>
          <a href="/api/auth/logout" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-[var(--err)] hover:bg-[var(--err-bg)]">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </a>
        </div>
      </section>
    </div>
  );
}

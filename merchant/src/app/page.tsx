// Landing (C-12). SSO login, or the logged-in user (verified via PSP userinfo) + granted scopes.
import Link from 'next/link';
import { ArrowRight, BadgeCheck, LogIn, RefreshCw, ShieldCheck, ShoppingBag, TriangleAlert, Clapperboard, CreditCard, Search, Lock } from 'lucide-react';
import { PspClient } from '@/lib/PspClient';
import { getSession } from '@/lib/session';
import { ENV } from '@/lib/env';
import { Chip } from '@/components/ui/Bits';
import { Tip } from '@/components/ui/Tooltip';
import PasswordlessLoginButton from '@/components/PasswordlessLoginButton';

// Human-readable meaning for each OAuth scope (shown as tooltips).
const SCOPE_HELP: Record<string, string> = {
  openid: 'Confirms who you are (your Sec4 Pay identity).',
  profile: 'Share your name so we can greet you.',
  email: 'Share your email address.',
  'read:beneficiaries': 'View your saved payees (masked).',
  'write:transfers': 'Send bank transfers on your behalf.',
  'read:accounts': 'View your payout accounts (masked IBAN).',
  'read:transactions': 'View your payment and transfer history.',
  'write:payments': 'Let the merchant charge card payments.',
};

// Friendly, actionable copy for the OAuth error codes the callback can return.
const AUTH_ERROR_INFO: Record<string, { title: string; hint: string }> = {
  invalid_state: {
    title: 'Your sign-in session expired',
    hint: 'This can happen if the sign-in took too long, cookies were blocked, or you switched between "localhost" and "127.0.0.1". Please start again from the same browser tab.',
  },
  token_exchange_failed: {
    title: 'We could not complete sign-in',
    hint: 'Sec4 Pay approved the request but the token exchange failed. This is usually temporary. Please try again in a moment.',
  },
  access_denied: {
    title: 'Sign-in was cancelled',
    hint: 'You declined to share access with Espresso Works. You can try again whenever you are ready.',
  },
};

export default async function Home({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const { auth_error } = await searchParams;
  const session = await getSession();
  const simulatorUrl = ENV.pspSimulatorUrl();

  // Confirm the session against the PSP userinfo endpoint (openid scope).
  let displayName = session?.name ?? session?.email ?? session?.sub;
  if (session) {
    const c = await PspClient.fromSession();
    const info = await c?.userinfo().catch(() => null);
    if (info) displayName = info.name ?? info.preferred_username ?? info.email ?? info.sub;
  }

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-leaf-ink via-[#04322c] to-[#062b2b] p-8 text-white shadow-card sm:p-10">
        {/* Futuristic glow accents */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-leaf/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-highlight/20 blur-3xl" />
        <span className="relative inline-flex items-center gap-1.5 rounded-full bg-leaf/15 px-3 py-1 text-xs font-medium text-leaf ring-1 ring-leaf/30">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Powered by Sec4 Pay
        </span>
        <h1 className="relative mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Espresso Works Ltd</h1>
        <p className="relative mt-3 max-w-xl text-white/80">
          Premium coffee, powered by Sec4 Pay. Sign in with your Sec4 Pay account to shop, pay beneficiaries, and
          manage transfers, all without sharing your card details with us.
        </p>

        {auth_error && (
          <div className="relative mt-4 rounded-lg bg-[var(--err)]/20 px-4 py-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="h-4 w-4" aria-hidden /> {AUTH_ERROR_INFO[auth_error]?.title ?? 'Sign-in could not be completed'}
            </p>
            <p className="mt-1 text-white/80">
              {AUTH_ERROR_INFO[auth_error]?.hint ?? 'Something went wrong during sign-in. Please try again.'}
            </p>
            <a
              href="/api/auth/login"
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 font-medium ring-1 ring-white/20 transition hover:bg-white/20"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
            </a>
          </div>
        )}

        {session ? (
          <div className="relative mt-6 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm ring-1 ring-white/10">
              <BadgeCheck className="h-4 w-4 text-leaf" aria-hidden /> Signed in as <b>{displayName}</b>
            </span>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 rounded-xl bg-leaf px-4 py-2 font-semibold text-leaf-ink transition duration-200 hover:shadow-glow hover:brightness-105 active:scale-[.98]"
            >
              <ShoppingBag className="h-4 w-4" aria-hidden /> Browse products <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="relative mt-6">
            <Tip label="OAuth2 / OIDC single sign-on with PKCE. Card and password stay with the PSP.">
              <a
                href="/api/auth/login"
                className="inline-flex items-center gap-2 rounded-xl bg-leaf px-5 py-2.5 font-semibold text-leaf-ink transition duration-200 hover:shadow-glow hover:brightness-105 active:scale-[.98]"
              >
                <LogIn className="h-4 w-4" aria-hidden /> Login with Sec4 Pay
              </a>
            </Tip>
            {/* CIBA passwordless (v25): renders only when a credential exists in this browser. */}
            <PasswordlessLoginButton />
          </div>
        )}
      </section>

      {/* Marketing: what the Sec4 Pay PSP offers, with a CTA into the full demo simulator. */}
      <section className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink">
              <Clapperboard className="h-5 w-5 text-leaf-deep" aria-hidden /> One PSP, the whole payment story
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Espresso Works is just one way in. Behind it, <b>Sec4 Pay</b> powers the end-to-end PCI DSS journey on a
              single MongoDB data layer, from checkout to investigation, with sensitive data encrypted yet still searchable.
            </p>
          </div>
          <a
            href={simulatorUrl}
            className="btn-primary shrink-0 text-sm"
          >
            <Clapperboard className="h-4 w-4" aria-hidden /> Go to the demo simulator <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface-alt p-4">
            <CreditCard className="h-5 w-5 text-leaf-deep" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-ink">Pay any way</p>
            <p className="text-xs text-muted">API card, redirection, payment link and in-site, one flow per method.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-alt p-4">
            <Search className="h-5 w-5 text-leaf-deep" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-ink">Investigate fraud</p>
            <p className="text-xs text-muted">Search cases, transactions and masked PII from one analyst dashboard.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-alt p-4">
            <Lock className="h-5 w-5 text-leaf-deep" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-ink">Encrypted &amp; queryable</p>
            <p className="text-xs text-muted">Queryable Encryption keeps PAN/IBAN private yet searchable at rest.</p>
          </div>
        </div>
      </section>

      {session && (
        <section className="glass rounded-2xl p-6">
          <h2 className="font-semibold">Granted permissions</h2>
          <p className="mt-1 text-sm text-muted">
            Consent is granular. Features you did not grant are hidden automatically. Hover a permission to see what it
            allows.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {session.grantedScopes.map((s) => (
              <Tip key={s} label={SCOPE_HELP[s] ?? 'Granted permission.'}>
                <span>
                  <Chip tone="accent" className="cursor-help font-mono">{s}</Chip>
                </span>
              </Tip>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

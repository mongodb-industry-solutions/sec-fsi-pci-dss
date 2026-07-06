// Landing (C-12). Shows SSO login, or the logged-in user (verified via PSP userinfo) + granted scopes.
import Link from 'next/link';
import { PspClient } from '@/lib/PspClient';
import { getSession } from '@/lib/session';

export default async function Home({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const { auth_error } = await searchParams;
  const session = await getSession();

  // Confirm the session against the PSP userinfo endpoint (openid scope).
  let displayName = session?.name ?? session?.email ?? session?.sub;
  if (session) {
    const c = await PspClient.fromSession();
    const info = await c?.userinfo().catch(() => null);
    if (info) displayName = info.name ?? info.preferred_username ?? info.email ?? info.sub;
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-espresso text-crema p-10">
        <h1 className="text-3xl font-bold">Espresso Works Ltd</h1>
        <p className="mt-2 max-w-xl text-crema/80">
          Premium coffee, powered by Leafy Pay. Sign in with your Leafy Pay account to shop,
          pay beneficiaries, and manage transfers — all without sharing your card details with us.
        </p>
        {auth_error && (
          <p className="mt-4 rounded bg-red-500/20 px-3 py-2 text-sm">Sign-in failed: {auth_error}</p>
        )}
        {session ? (
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <span className="rounded-full bg-crema/20 px-4 py-2">Signed in as <b>{displayName}</b></span>
            <Link href="/products" className="rounded bg-crema text-espresso-dark px-4 py-2 font-medium">Browse products</Link>
          </div>
        ) : (
          <a href="/api/auth/login" className="mt-6 inline-block rounded bg-crema text-espresso-dark px-5 py-2.5 font-semibold">
            Login with Leafy Pay
          </a>
        )}
      </section>

      {session && (
        <section className="rounded-xl border border-espresso/10 bg-white p-6">
          <h2 className="font-semibold mb-2">Granted permissions</h2>
          <p className="text-sm text-espresso-light mb-3">
            Consent is granular — features you did not grant are hidden automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            {session.grantedScopes.map((s) => (
              <span key={s} className="rounded-full bg-crema px-3 py-1 text-xs font-mono">{s}</span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

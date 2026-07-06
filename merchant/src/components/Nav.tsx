// Server component nav bar. Shows the logged-in user + scope-gated links (E-12).
import Link from 'next/link';
import { getSession, hasScope } from '@/lib/session';

export default async function Nav() {
  const session = await getSession();

  const links: { href: string; label: string; show: boolean }[] = [
    { href: '/products', label: 'Products', show: true },
    { href: '/beneficiaries', label: 'Beneficiaries', show: hasScope(session, 'read:beneficiaries') },
    { href: '/transfers', label: 'Transfers', show: hasScope(session, 'write:transfers') },
    { href: '/accounts', label: 'Accounts', show: hasScope(session, 'read:accounts') },
    { href: '/history', label: 'History', show: hasScope(session, 'read:transactions') },
  ];

  return (
    <header className="bg-espresso text-crema">
      <nav className="max-w-5xl mx-auto flex items-center gap-6 px-4 py-3">
        <Link href="/" className="font-bold text-lg tracking-tight">☕ Espresso Works</Link>
        {session && (
          <div className="flex items-center gap-4 text-sm">
            {links.filter((l) => l.show).map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-white/90">{l.label}</Link>
            ))}
          </div>
        )}
        <div className="ml-auto text-sm">
          {session ? (
            <span className="flex items-center gap-3">
              <span className="opacity-90">{session.name ?? session.email ?? session.sub}</span>
              <a href="/api/auth/logout" className="rounded bg-crema/20 px-3 py-1 hover:bg-crema/30">Sign out</a>
            </span>
          ) : (
            <a href="/api/auth/login" className="rounded bg-crema text-espresso-dark px-3 py-1 font-medium hover:bg-white">
              Login with Leafy Pay
            </a>
          )}
        </div>
      </nav>
    </header>
  );
}

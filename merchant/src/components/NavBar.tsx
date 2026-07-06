'use client';
// Responsive top nav: inline links on desktop, hamburger drawer on mobile.
// Server passes plain data (icon keys, not components) across the RSC boundary.
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Coffee, LogIn, Menu, X, Package, Users, Send, Wallet, ReceiptText, HelpCircle } from 'lucide-react';
import { Tip } from './ui/Tooltip';
import ProfileMenu, { type ProfileUser } from './ProfileMenu';

export type NavIcon = 'products' | 'beneficiaries' | 'transfers' | 'accounts' | 'history' | 'help';
export interface NavLink { href: string; label: string; icon: NavIcon; tip: string }

const ICONS = {
  products: Package,
  beneficiaries: Users,
  transfers: Send,
  accounts: Wallet,
  history: ReceiptText,
  help: HelpCircle,
} as const;

export default function NavBar({ links, user }: { links: NavLink[]; user: ProfileUser | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const linkClass = (href: string) =>
    `flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm transition duration-200 ${
      pathname === href
        ? 'bg-leaf/15 text-leaf ring-1 ring-leaf/30'
        : 'text-white/75 hover:bg-white/10 hover:text-white'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-gradient-to-r from-leaf-ink via-[#032a26] to-leaf-ink text-white shadow-card [backdrop-filter:blur(12px)]">
      <nav className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight transition hover:opacity-90">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-leaf/15 ring-1 ring-leaf/30">
            <Coffee className="h-4 w-4 text-leaf" aria-hidden />
          </span>
          <span className="text-base sm:text-lg">Espresso Works</span>
        </Link>

        {/* Desktop links */}
        {user && (
          <div className="ml-4 hidden items-center gap-1 md:flex">
            {links.map((l) => {
              const Icon = ICONS[l.icon];
              return (
                <Tip key={l.href} label={l.tip}>
                  <Link href={l.href} className={linkClass(l.href)}>
                    <Icon className="h-4 w-4" aria-hidden />
                    {l.label}
                  </Link>
                </Tip>
              );
            })}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <ProfileMenu user={user} />
          ) : (
            <Tip label="Sign in with your Leafy Pay account (OAuth SSO). We never see your card or password.">
              <a
                href="/api/auth/login"
                className="flex items-center gap-2 rounded-xl bg-leaf px-3.5 py-2 text-sm font-semibold text-leaf-ink transition duration-200 hover:shadow-glow hover:brightness-105 active:scale-[.98]"
              >
                <LogIn className="h-4 w-4" aria-hidden /> Login with Leafy Pay
              </a>
            </Tip>
          )}

          {/* Mobile hamburger */}
          {user && (
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              className="rounded-xl p-2 text-white/85 transition hover:bg-white/10 md:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </nav>

      {/* Mobile drawer */}
      {user && open && (
        <div className="border-t border-white/10 md:hidden">
          <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-3">
            {links.map((l) => {
              const Icon = ICONS[l.icon];
              return (
                <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={linkClass(l.href)}>
                  <Icon className="h-4 w-4" aria-hidden />
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}

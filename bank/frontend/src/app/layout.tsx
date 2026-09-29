import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Landmark, LifeBuoy } from 'lucide-react';
import './globals.css';
import { AuthGate } from '../components/AuthGate';
import { UserMenu } from '../components/UserMenu';
import { DebugModeProvider } from '../lib/debugMode';
import { authorityUiPublic } from '../lib/authority';

export const metadata: Metadata = {
  title: 'BankCore',
  description: "The bank's own administration: its capabilities, its records, its Open Banking API.",
};

// Without this a phone renders the page at desktop width and scales it down, which is how a responsive
// layout ends up looking like a shrunken desktop instead of a phone screen.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: a browser extension (translation tools, password managers) can stamp
    // its own attribute onto <html> before React hydrates. That is not a real mismatch to fix, so
    // this is scoped to the one element extensions actually touch, not the tree beneath it.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {/* Wraps header and page: the toggle lives in the menu, the panels it reveals live in the page. */}
        <DebugModeProvider>
        {/* Sticky, so on a long audit table the way back is always one tap away rather than a scroll away. */}
        <header className="sticky top-0 z-20 border-b border-line bg-bank text-bank-ink">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4">
            <Landmark size={20} className="shrink-0 text-accent" aria-hidden />
            <Link href="/" className="font-semibold tracking-tight hover:underline">
              BankCore
            </Link>
            {/* The subtitle is the first thing to go on a narrow screen: the name and the way home are not. */}
            <span className="hidden text-xs text-bank-ink/60 sm:inline"></span>
            <span className="ml-auto rounded-full border border-bank-ink/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-bank-ink/70">
              ASPSP
            </span>
            {/* Public on purpose: it explains the roles and what each may do, which is exactly what
                somebody deciding whether to sign in, or which of several accounts to sign in with,
                needs to read first. Gating it behind the account menu meant it was reachable only
                after the choice it exists to inform. */}
            <Link
              href="/help"
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-bank-ink/80 transition hover:bg-white/10 hover:text-bank-ink"
            >
              <LifeBuoy size={15} aria-hidden />
              <span className="hidden sm:inline">Help</span>
            </Link>
            {/* Resolved here, server side, because this app inlines no NEXT_PUBLIC_* address into the
                browser bundle. Renders nothing until somebody is signed in. */}
            <UserMenu authorityUi={authorityUiPublic()} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <AuthGate>{children}</AuthGate>
        </main>
        </DebugModeProvider>
      </body>
    </html>
  );
}

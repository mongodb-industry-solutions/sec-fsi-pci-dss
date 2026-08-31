import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Landmark } from 'lucide-react';
import './globals.css';
import { AuthGate } from '../components/AuthGate';
import { UserMenu } from '../components/UserMenu';

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
    <html lang="en">
      <body className="min-h-screen antialiased">
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
            {/* Right of the badge, and it renders nothing until somebody is signed in. */}
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <AuthGate>{children}</AuthGate>
        </main>
      </body>
    </html>
  );
}

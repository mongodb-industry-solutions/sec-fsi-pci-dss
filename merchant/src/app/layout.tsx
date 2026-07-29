import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import './globals.css';
import Nav from '@/components/Nav';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Espresso Works · ${BRAND.full} Demo`,
  description: `Merchant demo integrating with the ${BRAND.full} PSP via OAuth2/OIDC + API.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: browser extensions (e.g. LanguageTool → data-lt-installed) inject
  // attributes on <html>/<body> before React hydrates, causing a benign hydration mismatch.
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans" suppressHydrationWarning>
        <TooltipProvider>
          <Nav />
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
          <footer className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-6 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-leaf-deep" aria-hidden />
            Espresso Works Ltd, external merchant demo. No card data handled here (PCI DSS SAQ A).
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}

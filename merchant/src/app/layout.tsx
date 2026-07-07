import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import './globals.css';
import Nav from '@/components/Nav';
import { TooltipProvider } from '@/components/ui/Tooltip';

export const metadata: Metadata = {
  title: 'Espresso Works · Leafy Pay Demo',
  description: 'Merchant demo integrating with the Leafy Pay PSP via OAuth2/OIDC + API.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <TooltipProvider>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <footer className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-6 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-leaf-deep" aria-hidden />
            Espresso Works Ltd, external merchant demo. No card data handled here (PCI DSS SAQ A).
          </footer>
        </TooltipProvider>
      </body>
    </html>
  );
}

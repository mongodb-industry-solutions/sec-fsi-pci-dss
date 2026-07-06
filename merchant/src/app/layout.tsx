import type { Metadata } from 'next';
import './globals.css';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: 'Espresso Works — Leafy Pay Demo',
  description: 'Merchant demo integrating with the Leafy Pay PSP via OAuth2/OIDC + API.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
        <footer className="max-w-5xl mx-auto px-4 py-6 text-xs text-espresso-light/70">
          Espresso Works Ltd — external merchant demo. No card data handled here (PCI DSS SAQ A).
        </footer>
      </body>
    </html>
  );
}

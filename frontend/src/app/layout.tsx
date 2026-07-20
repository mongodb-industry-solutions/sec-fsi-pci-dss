import type { Metadata } from 'next';
import './globals.css';
import { UIProvider } from '../components/ui/ConfirmProvider';

export const metadata: Metadata = {
  title: 'Sec4 Pay',
  description: 'MongoDB Queryable Encryption · AWS KMS · PCI DSS Payment Security Demo',
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico',       sizes: 'any' },
    ],
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: browser extensions (e.g. LanguageTool injects
  // `data-lt-installed` on <html>/<body>) mutate the DOM before React hydrates,
  // which otherwise triggers a spurious attribute-mismatch warning.
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <UIProvider>{children}</UIProvider>
      </body>
    </html>
  );
}

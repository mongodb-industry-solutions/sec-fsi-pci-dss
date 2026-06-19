import type { Metadata } from 'next';
import './globals.css';
import { UIProvider } from '../components/ui/ConfirmProvider';

export const metadata: Metadata = {
  title: 'Leafy Pay',
  description: 'MongoDB Queryable Encryption · AWS KMS · PCI DSS Payment Security Demo',
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

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PSP - Platform',
  description: 'MongoDB Queryable Encryption · AWS KMS · PCI DSS Payment Security Demo',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

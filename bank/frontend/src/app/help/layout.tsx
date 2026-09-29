import { HelpNav } from '../../components/help/HelpNav';

export const metadata = { title: 'Help' };

// Every help page carries the same tabs, so the section reads as one document rather than three pages.
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <HelpNav />
      {children}
    </div>
  );
}

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageTitle } from '../../../components/Tiles';
import { CardCreate } from '../../../components/cards/CardCreate';

export const metadata = { title: 'Issue a card' };

export default function NewCardPage() {
  return (
    <div className="space-y-6">
      <Link href="/cards" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft size={14} aria-hidden /> Card estate
      </Link>

      <PageTitle
        title="Issue a card"
        description="The bank mints the number inside one of its own declared ranges, so the card it hands out is one it can recognise later. It lands issued rather than active: an operator accepts it once the holder has it."
      />

      <CardCreate />
    </div>
  );
}

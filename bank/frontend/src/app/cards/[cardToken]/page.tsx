import { CardDetail } from '../../../components/cards/CardDetail';

export const metadata = { title: 'Card' };

// One card, at its own address, so it can be linked to from an alert, a report or a colleague's message.
export default async function CardPage({ params }: { params: Promise<{ cardToken: string }> }) {
  const { cardToken } = await params;
  return <CardDetail cardToken={decodeURIComponent(cardToken)} />;
}

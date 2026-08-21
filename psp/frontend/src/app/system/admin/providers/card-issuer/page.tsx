import { IntegrationCategoryPage } from '../../_components/IntegrationCategoryPage';

export default function CardIssuerPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'card_issuer',
      label: 'Card Issuer',
      description: 'CVV and PIN validation services from card-issuing processors',
    }} />
  );
}

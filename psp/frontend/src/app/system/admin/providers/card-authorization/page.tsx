import { IntegrationCategoryPage } from '../../_components/IntegrationCategoryPage';

export default function CardAuthorizationPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'card_authorization',
      label: 'Card Authorization',
      description: 'Card transaction authorization via payment networks',
    }} />
  );
}

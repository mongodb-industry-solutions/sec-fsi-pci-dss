import { IntegrationCategoryPage } from '../../_components/IntegrationCategoryPage';

export default function CreditBureauPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'credit_bureau',
      label: 'Credit Bureau',
      description: 'Credit scoring and bureau checks',
    }} />
  );
}

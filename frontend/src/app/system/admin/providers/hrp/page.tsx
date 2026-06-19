import { IntegrationCategoryPage } from '../../_components/IntegrationCategoryPage';

export default function HrpSanctionsPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'hrp_sanctions',
      label: 'HRP / Sanctions',
      description: 'High-risk person and sanctions list screening',
      bianSd: 'SD-13',
    }} />
  );
}

import { IntegrationCategoryPage } from '../../_components/IntegrationCategoryPage';

export default function FraudDetectionPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'fraud_detection',
      label: 'Fraud Detection',
      description: 'Real-time transaction scoring and fraud signals',
      bianSd: 'SD-63',
    }} />
  );
}

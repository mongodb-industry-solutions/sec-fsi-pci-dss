import { IntegrationCategoryPage } from '../_components/IntegrationCategoryPage';

export default function AmlMonitoringPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'aml_monitoring',
      label: 'AML Monitoring',
      description: 'Anti-money laundering pattern analysis',
    }} />
  );
}

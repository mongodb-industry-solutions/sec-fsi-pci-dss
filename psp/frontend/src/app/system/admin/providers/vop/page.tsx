import { IntegrationCategoryPage } from '../../_components/IntegrationCategoryPage';

export default function VopVerificationPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'vop_verification',
      label: 'Verification of Payee',
      description: 'Payee name-vs-account confirmation (VoP / UK CoP). Additional to FDS/AML/HRP; market-gated.',
    }} />
  );
}

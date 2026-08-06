import { IntegrationCategoryPage } from '../_components/IntegrationCategoryPage';

export default function KycIdentityPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'kyc_identity',
      label: 'KYC / Identity',
      description: 'Customer identity verification (KYC)',
    }} />
  );
}

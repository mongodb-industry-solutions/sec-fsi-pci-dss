import { IntegrationCategoryPage } from '../_components/IntegrationCategoryPage';

export default function KybBusinessPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'kyb_business',
      label: 'KYB / Business',
      description: 'Merchant business entity verification (KYB)',
      bianSd: 'SD-89',
    }} />
  );
}

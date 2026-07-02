import { IntegrationCategoryPage } from '../../_components/IntegrationCategoryPage';

export default function AccountInformationPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'account_information',
      label: 'Account Information (AIS)',
      description: 'Payout account status validation and internal ledger balance (PSD2 AIS / SD-36 Open Banking)',
      bianSd: 'SD-36',
    }} />
  );
}

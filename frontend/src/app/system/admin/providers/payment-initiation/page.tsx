import { IntegrationCategoryPage } from '../../_components/IntegrationCategoryPage';

export default function PaymentInitiationPage() {
  return (
    <IntegrationCategoryPage meta={{
      type: 'payment_initiation',
      label: 'Payment Initiation (PISP)',
      description: 'Bank transfer initiation over SEPA / ACH / internal rails with T+N settlement (PSD2 PISP)',
      bianSd: 'SD-65',
    }} />
  );
}

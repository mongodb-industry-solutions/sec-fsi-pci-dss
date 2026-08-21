import { WebhookEventType } from './merchantAgreement.model';

export const MERCHANT_WEBHOOK_LOG_COLLECTION = 'merchantWebhookDeliveryLog';

export interface MerchantWebhookDeliveryLog {
  logId: string;
  merchantAgreementInstanceReference: string;
  webhookId: string;
  webhookEventType: WebhookEventType;
  deliveryType: 'live' | 'test';
  requestUrl: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  delivered: boolean;
  attempts: number;
  error?: string;
  signature: string;
  deliveredAt: Date;
}

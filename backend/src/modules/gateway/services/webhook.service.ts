// Webhook delivery service
// Signs outgoing payloads with HMAC-SHA256 and delivers with retry.

import { createHmac } from 'crypto';

export interface WebhookEvent {
  event: string;        // e.g. 'payment.completed', 'checkout.expired'
  timestamp: string;    // ISO 8601
  data: Record<string, unknown>;
}

export function signWebhookPayload(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = signWebhookPayload(payload, secret);
  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function deliverWebhook(
  url: string,
  event: WebhookEvent,
  secret: string
): Promise<{ delivered: boolean; statusCode?: number; attempts: number }> {
  const payload = JSON.stringify(event);
  const signature = signWebhookPayload(payload, secret);

  const delays = [1000, 2000, 4000]; // exponential backoff (ms)
  let attempts = 0;

  for (const delay of delays) {
    attempts++;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': event.timestamp,
          'User-Agent': 'LeafyBank-Gateway/1.0',
        },
        body: payload,
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        return { delivered: true, statusCode: res.status, attempts };
      }

      // Non-2xx: wait and retry
      await new Promise((r) => setTimeout(r, delay));
    } catch {
      // Network error or timeout: wait and retry
      if (attempts < delays.length) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return { delivered: false, attempts };
}

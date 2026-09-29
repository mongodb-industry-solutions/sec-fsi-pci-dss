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

export interface WebhookDeliveryResult {
  delivered: boolean;
  statusCode?: number;
  attempts: number;
  // Full request + merchant response capture for the audit trail (PCI DSS). The HMAC
  // signature header is shown (it is not a secret); the signing secret is never included.
  request: { method: string; url: string; headers: Record<string, string>; body: WebhookEvent };
  response?: { status: number; headers: Record<string, string>; body: unknown };
  error?: string;
}

/**
 * Deliver an HMAC-signed webhook with retry, capturing the request and the merchant's response.
 * `opts.maxAttempts` bounds the retries: pass 1 for inline delivery (e.g. during a payment) so a
 * slow/unreachable endpoint never blocks the payment response; omit for background delivery.
 */
export async function deliverWebhook(
  url: string,
  event: WebhookEvent,
  secret: string,
  opts?: { maxAttempts?: number; extraHeaders?: Record<string, string> },
): Promise<WebhookDeliveryResult> {
  const payload = JSON.stringify(event);
  const signature = signWebhookPayload(payload, secret);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-Timestamp': event.timestamp,
    'User-Agent': 'PSP-Platform',
    ...(opts?.extraHeaders ?? {}),  // caller-supplied auth headers (e.g. the merchant's expected scheme)
  };
  const request = { method: 'POST', url, headers, body: event };

  const allDelays = [1000, 2000, 4000]; // exponential backoff (ms)
  const delays = allDelays.slice(0, Math.max(1, opts?.maxAttempts ?? allDelays.length));
  let attempts = 0;
  let lastError: string | undefined;

  for (const delay of delays) {
    attempts++;
    try {
      const res = await fetch(url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(5000) });
      let respBody: unknown;
      try { const t = await res.text(); try { respBody = JSON.parse(t); } catch { respBody = t; } } catch { /* no body */ }
      const response = { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: respBody };
      if (res.ok) return { delivered: true, statusCode: res.status, attempts, request, response };
      lastError = `HTTP ${res.status}`;
      if (attempts < delays.length) await new Promise((r) => setTimeout(r, delay));
      else return { delivered: false, statusCode: res.status, attempts, request, response, error: lastError };
    } catch (err) {
      lastError = (err as Error).message;
      if (attempts < delays.length) await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { delivered: false, attempts, request, error: lastError };
}

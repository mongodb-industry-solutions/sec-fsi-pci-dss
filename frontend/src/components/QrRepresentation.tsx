'use client';
// v28 Shared QR representation component. Renders a payable intent's encoded payload (signed deep link
// or EPC/EMVCo string) for RTP, payment links, and checkout. No new dependency: we render the payload
// as a scannable, copyable deep-link block (no canvas QR encoder). The backend owns the canonical
// payload (qrPaymentRepresentation.encodedPayload); this component never holds PII beyond that string.
import { useState, useMemo } from 'react';
import { QrCode, Copy, Check } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

export interface QrRepresentationProps {
  encodedPayload: string;
  payloadFormat?: string;
  label?: string;
}

export function QrRepresentation({ encodedPayload, payloadFormat = 'url', label }: QrRepresentationProps) {
  const [copied, setCopied] = useState(false);

  // The backend builds the deep link from URL_FRONTEND (which may default to a wrong host, e.g.
  // localhost:3000). For a `url` payload we rewrite the origin to the frontend's ACTUAL origin so the
  // link/QR always resolves in whatever environment we're running (local or production).
  const displayPayload = useMemo(() => {
    if (payloadFormat === 'url' && typeof window !== 'undefined') {
      try { const u = new URL(encodedPayload); return `${window.location.origin}${u.pathname}${u.search}${u.hash}`; }
      catch { return encodedPayload; }
    }
    return encodedPayload;
  }, [encodedPayload, payloadFormat]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(displayPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2 text-slate-700">
        <QrCode className="h-5 w-5" />
        <span className="text-sm font-medium">{label ?? 'Scan or share to pay'}</span>
        <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-500">{payloadFormat}</span>
      </div>

      {/* Real, scannable QR rendered client-side from the payload (encode-only; no external service). */}
      <div className="flex flex-col items-center justify-center rounded-md border border-slate-200 bg-white p-6">
        <QRCodeSVG value={displayPayload} size={192} level="M" marginSize={2} />
        <p className="mt-3 text-xs text-slate-500">Scan to open, or use the link below</p>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-xs text-slate-700" title={displayPayload}>{displayPayload}</code>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default QrRepresentation;

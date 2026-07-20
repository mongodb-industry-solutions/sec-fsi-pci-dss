'use client';
// v28: "Pay by QR" for products whose method produces a shareable/hosted payable URL (payment link,
// redirect/checkout, subscription). Clicking the QR icon creates the payable artifact via the same
// payForProduct server action (reusing the PSP API), then shows a modal with a scannable QR of the
// hosted URL so the customer can scan and complete the payment there. api_payment (direct tokenised
// charge) has no shareable URL, so no QR is offered for it.
import { useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { QrCode, Loader2, X, Copy } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { payForProduct } from '@/lib/actions';
import { Tip } from '@/components/ui/Tooltip';
import type { Product } from '@/config/products';

export default function ProductQrButton({ product }: { product: Product }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function onOpen() {
    setError(null);
    startTransition(async () => {
      const res = await payForProduct(product.id);
      const link = res.paymentUrl ?? res.redirectUrl ?? null;
      if (res.ok !== false && link) setUrl(link);
      else setError(res.message ?? 'Could not create a payable link for this product.');
    });
  }

  return (
    <>
      <Tip label="Show a QR to pay this product on the hosted page.">
        <button onClick={onOpen} disabled={pending} aria-label="Pay by QR"
          className="inline-flex items-center justify-center rounded-lg border border-line p-2 text-leaf-deep hover:bg-surface-alt disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <QrCode className="h-4 w-4" aria-hidden />}
        </button>
      </Tip>

      {/* Portal to <body>: the product card uses hover:-translate — a transformed ancestor would
          become the containing block for this position:fixed overlay and collapse it to the card
          width on hover. Rendering at body level keeps it viewport-fixed. */}
      {(url || error) && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setUrl(null); setError(null); }}>
          <div className="glass w-full max-w-sm rounded-2xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-ink"><QrCode className="h-5 w-5 text-leaf-deep" aria-hidden /> Pay by QR</h3>
              <button onClick={() => { setUrl(null); setError(null); }} aria-label="Close" className="text-muted hover:text-ink"><X className="h-5 w-5" aria-hidden /></button>
            </div>
            {error ? (
              <p className="text-sm text-[var(--err)]">{error}</p>
            ) : url ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">Scan to pay <span className="font-medium text-ink">{product.name}</span> on the hosted page.</p>
                <div className="flex justify-center rounded-xl border border-line bg-white p-6">
                  <QRCodeSVG value={url} size={192} level="M" marginSize={2} />
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-surface-alt px-2 py-1.5 text-xs text-ink" title={url}>{url}</code>
                  <button onClick={() => { navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-surface-alt">
                    <Copy className="h-3.5 w-3.5" aria-hidden /> {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

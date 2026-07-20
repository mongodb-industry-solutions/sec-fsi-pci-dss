'use client';
// Confirmation experience shown after a product payment resolves. Replaces the old
// raw status string with a friendly, accessible result panel. Success and error are
// visually distinct; the payment-link method surfaces a shareable/openable link.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2, XCircle, ExternalLink, Link2, RotateCcw, History, X, ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import type { ActionResult } from '@/lib/actions';
import type { Product } from '@/config/products';
import { Chip } from '@/components/ui/Bits';
import CopyButton from '@/components/ui/CopyButton';

// Map a PSP status string to a chip tone (kept consistent with the history view).
function statusTone(s?: string): 'ok' | 'warn' | 'err' | 'neutral' {
  const v = (s ?? '').toLowerCase();
  if (/(complete|settled|success|paid|done|authori[sz]ed|captured)/.test(v)) return 'ok';
  if (/(fail|declined|error|cancel|reject)/.test(v)) return 'err';
  if (/(pending|processing|initiat|hold)/.test(v)) return 'warn';
  return 'neutral';
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{children}</span>
    </div>
  );
}

export default function PaymentResultModal({
  product,
  commission,
  result,
  onClose,
  onRetry,
}: {
  product: Product;
  commission: number;
  result: ActionResult;
  onClose: () => void;
  onRetry: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fmt = (n: number) => `${product.currency} ${n.toFixed(2)}`;
  const ok = !!result.ok;
  const isLink = product.method === 'payment_link';
  const ref = result.reference;
  const txn = result.transactionRef;

  // Focus management: focus the close button on open, trap Esc, restore focus on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const titleId = 'payresult-title';
  const descId = 'payresult-desc';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-leaf-ink/40 p-4 backdrop-blur-sm [animation:tt-in_120ms_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`grid h-11 w-11 place-items-center rounded-2xl ${
                ok ? 'bg-[var(--ok-bg)] text-[var(--ok)]' : 'bg-[var(--err-bg)] text-[var(--err)]'
              }`}
              aria-hidden
            >
              {ok ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-ink">
                {ok ? (isLink ? 'Payment link ready' : 'Payment confirmed') : 'Payment failed'}
              </h2>
              <p id={descId} className="text-sm text-muted">
                {ok
                  ? isLink
                    ? 'Share this link so the buyer can pay on Sec4 Pay.'
                    : 'The charge was processed securely by Sec4 Pay.'
                  : 'The payment could not be completed.'}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition hover:bg-surface-alt hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf/60"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* What was purchased */}
        <div className="mt-5 rounded-xl border border-line bg-surface-alt/50 p-4">
          <Row label="Product">{product.name}</Row>
          <Row label="Amount">{fmt(product.price)}</Row>
          <Row label="Payment method">
            <span className="inline-flex items-center gap-1.5">{product.methodLabel}</span>
          </Row>
          <Row label="Merchant commission">{fmt(commission)}</Row>
        </div>

        {ok ? (
          <div className="mt-4 space-y-3">
            {result.status && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Status</span>
                <Chip tone={statusTone(result.status)}>{result.status}</Chip>
              </div>
            )}

            {ref && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted">{isLink ? 'Link reference' : 'Order reference'}</span>
                <span className="inline-flex items-center gap-1">
                  <code className="max-w-[9rem] truncate rounded bg-surface-alt px-1.5 py-0.5 text-xs text-ink">{ref}</code>
                  <CopyButton value={ref} label={isLink ? 'link reference' : 'order reference'} />
                </span>
              </div>
            )}

            {txn && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted">Transaction id</span>
                <span className="inline-flex items-center gap-1">
                  <code className="max-w-[9rem] truncate rounded bg-surface-alt px-1.5 py-0.5 text-xs text-ink">{txn}</code>
                  <CopyButton value={txn} label="transaction id" />
                </span>
              </div>
            )}

            {/* Payment-link method: shareable link block */}
            {isLink && result.paymentUrl && (
              <div className="rounded-xl border border-leaf/30 bg-[color-mix(in_srgb,var(--leaf)_10%,transparent)] p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-leaf-deep">
                  <Link2 className="h-3.5 w-3.5" aria-hidden /> Shareable payment link
                </div>
                <p className="mt-1 break-all font-mono text-xs text-ink">{result.paymentUrl}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CopyButton
                    value={result.paymentUrl}
                    label="payment link"
                    className="border border-line bg-surface px-2 py-1"
                  />
                  <a
                    href={result.paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-leaf-deep transition hover:bg-surface-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf/60"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open link
                  </a>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--err)]/30 bg-[var(--err-bg)] p-3 text-sm text-[var(--err)]">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{result.message ?? 'Unexpected error.'}</span>
          </p>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-wrap gap-2">
          {ok ? (
            <>
              <Link href="/history" className="btn-primary flex-1">
                <History className="h-4 w-4" aria-hidden /> View in history
              </Link>
              <button type="button" onClick={onClose} className="btn-ghost flex-1">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to products
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRetry();
                }}
                className="btn-primary flex-1"
              >
                <RotateCcw className="h-4 w-4" aria-hidden /> Try again
              </button>
              <button type="button" onClick={onClose} className="btn-ghost flex-1">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to products
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

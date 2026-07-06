'use client';
// Client card: shows commission, triggers the payment method via the server action,
// then renders the payment link or redirects to the hosted checkout.
import { useState, useTransition } from 'react';
import {
  Coffee, GraduationCap, Repeat, Bean, CreditCard, ExternalLink, Link2, Loader2, TriangleAlert,
} from 'lucide-react';
import type { Product, PaymentMethod } from '@/config/products';
import { payForProduct } from '@/lib/actions';
import { Chip, InfoHint } from '@/components/ui/Bits';
import { Tip } from '@/components/ui/Tooltip';

const ICONS = { beans: Bean, machine: Coffee, course: GraduationCap, subscription: Repeat } as const;

// What each payment method does (buyer-facing tooltip on the badge).
const METHOD_HELP: Record<PaymentMethod, string> = {
  payment_link: 'Creates a shareable Leafy Pay link. The buyer pays on a hosted page.',
  redirect: 'Redirects to Leafy Pay’s hosted checkout; the PSP captures the card.',
  api_payment: 'Server-to-server charge on a tokenised card. The merchant never sees card data.',
  subscription: 'Redirect to hosted checkout that sets up a recurring subscription.',
};

export default function ProductCard({ product, commission }: { product: Product; commission: number }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean>(true);
  const Icon = ICONS[product.icon];
  const fmt = (n: number) => `${product.currency} ${n.toFixed(2)}`;

  function onPay() {
    setMsg(null);
    setLink(null);
    startTransition(async () => {
      const res = await payForProduct(product.id);
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl; // hosted checkout (PSP captures the card)
        return;
      }
      setOk(!!res.ok);
      if (res.paymentUrl) setLink(res.paymentUrl);
      setMsg(res.message ?? (res.ok ? 'Done' : 'Failed'));
    });
  }

  return (
    <div className="group flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-leaf/40 hover:shadow-glow">
      {/* Warm espresso brand accent on the product icon (brand cue) */}
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand ring-1 ring-line transition group-hover:scale-105">
        <Icon className="h-7 w-7" aria-hidden />
      </div>
      <h3 className="mt-3 font-semibold text-ink">{product.name}</h3>
      <p className="mt-1 flex-1 text-sm text-muted">{product.description}</p>

      <div className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Price</span>
          <b className="text-ink">{fmt(product.price)}</b>
        </div>
        <div className="flex items-center justify-between text-muted">
          <span className="flex items-center gap-1">
            Merchant commission
            <InfoHint label={`Espresso Works keeps ${fmt(commission)} of this sale. Shown for transparency only.`} />
          </span>
          <span>{fmt(commission)}</span>
        </div>
      </div>

      <div className="mt-3">
        <Tip label={METHOD_HELP[product.method]}>
          <span>
            <Chip tone="accent" className="cursor-help">
              <CreditCard className="h-3 w-3" aria-hidden /> {product.methodLabel}
            </Chip>
          </span>
        </Tip>
      </div>

      <Tip label={`Pay ${fmt(product.price)} via ${product.methodLabel}.`}>
        <button onClick={onPay} disabled={pending} className="btn-primary mt-4 w-full">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CreditCard className="h-4 w-4" aria-hidden />}
          {pending ? 'Processing…' : 'Pay'}
        </button>
      </Tip>

      {msg && (
        <p className={`mt-2 flex items-center gap-1.5 text-xs ${ok ? 'text-muted' : 'text-[var(--err)]'}`}>
          {!ok && <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
          {msg}
        </p>
      )}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 break-all text-xs font-medium text-leaf-deep underline"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> {link} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        </a>
      )}
    </div>
  );
}

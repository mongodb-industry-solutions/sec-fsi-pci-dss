'use client';
// Client card: shows the product, its payment method (badge + explanation + tooltip)
// and the commission, triggers the payment method via the server action, then either
// redirects to the hosted checkout or opens the confirmation modal with the result.
import { useState, useTransition } from 'react';
import {
  Coffee, GraduationCap, Repeat, Bean, CreditCard, ExternalLink, Link2, Cpu, Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Product, PaymentMethod } from '@/config/products';
import { payForProduct, type ActionResult } from '@/lib/actions';
import { Chip } from '@/components/ui/Bits';
import { Tip } from '@/components/ui/Tooltip';
import PaymentResultModal from './PaymentResultModal';

const ICONS = { beans: Bean, machine: Coffee, course: GraduationCap, subscription: Repeat } as const;

// Distinct icon per payment method (buyer-facing, keeps the methods visually separable).
const METHOD_ICON: Record<PaymentMethod, LucideIcon> = {
  payment_link: Link2,
  redirect: ExternalLink,
  api_payment: Cpu,
  subscription: Repeat,
};

// One short, human explanation per method (shown under the badge).
const METHOD_BLURB: Record<PaymentMethod, string> = {
  payment_link: 'Generates a shareable link the buyer opens to pay.',
  redirect: 'Opens Leafy Pay’s secure hosted checkout page.',
  api_payment: 'Server-to-server charge on a tokenised card.',
  subscription: 'Hosted checkout that sets up a recurring plan.',
};

// Longer tooltip (on hover AND click).
const METHOD_HELP: Record<PaymentMethod, string> = {
  payment_link: 'Creates a shareable Leafy Pay link. The buyer pays on a hosted page. Nothing is charged until they open it.',
  redirect: 'Sends the browser to Leafy Pay’s hosted checkout, where the PSP securely captures the card. The merchant never sees card data.',
  api_payment: 'Server-to-server charge on a tokenised card using the merchant’s own credentials. The merchant never sees card data.',
  subscription: 'Redirects to Leafy Pay’s hosted checkout to set up a recurring subscription.',
};

// Uniform primary-action label across ALL products for a homogeneous design.
// What actually happens per method is explained in the button tooltip below.
const PAY_LABEL = 'Pay';

export default function ProductCard({ product, commission }: { product: Product; commission: number }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const Icon = ICONS[product.icon];
  const MethodIcon = METHOD_ICON[product.method];
  const fmt = (n: number) => `${product.currency} ${n.toFixed(2)}`;

  function onPay() {
    setResult(null);
    startTransition(async () => {
      const res = await payForProduct(product.id);
      if (res.redirectUrl) {
        window.location.href = res.redirectUrl; // hosted checkout (PSP captures the card)
        return;
      }
      setResult(res);
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

      {/* Payment method: labeled badge + short explanation + tooltip */}
      <div className="mt-3">
        <Tip label={METHOD_HELP[product.method]}>
          <span>
            <Chip tone="accent" className="cursor-help">
              <MethodIcon className="h-3 w-3" aria-hidden /> {product.methodLabel}
            </Chip>
          </span>
        </Tip>
        <p className="mt-1.5 text-xs leading-snug text-muted">{METHOD_BLURB[product.method]}</p>
      </div>

      <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Price</span>
          <b className="text-ink">{fmt(product.price)}</b>
        </div>
        <div className="flex items-center justify-between text-muted">
          <span>Merchant commission</span>
          <span>{fmt(commission)}</span>
        </div>
      </div>

      <Tip label={`${METHOD_HELP[product.method]} You will pay ${fmt(product.price)}.`}>
        <button onClick={onPay} disabled={pending} className="btn-primary mt-4 w-full">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CreditCard className="h-4 w-4" aria-hidden />}
          {pending ? 'Processing…' : PAY_LABEL}
        </button>
      </Tip>

      {result && (
        <PaymentResultModal
          product={product}
          commission={commission}
          result={result}
          onClose={() => setResult(null)}
          onRetry={onPay}
        />
      )}
    </div>
  );
}

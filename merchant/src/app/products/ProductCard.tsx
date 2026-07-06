'use client';
// Client card: shows commission, triggers the payment method via the server action,
// then renders the payment link or redirects to the hosted checkout.
import { useState, useTransition } from 'react';
import type { Product } from '@/config/products';
import { payForProduct } from '@/lib/actions';

export default function ProductCard({ product, commission }: { product: Product; commission: number }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
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
      if (res.paymentUrl) setLink(res.paymentUrl);
      setMsg(res.message ?? (res.ok ? 'Done' : 'Failed'));
    });
  }

  return (
    <div className="rounded-xl border border-espresso/10 bg-white p-5 flex flex-col">
      <div className="text-4xl">{product.image}</div>
      <h3 className="mt-2 font-semibold">{product.name}</h3>
      <p className="text-sm text-espresso-light flex-1">{product.description}</p>
      <div className="mt-3 text-sm">
        <div className="flex justify-between"><span>Price</span><b>{fmt(product.price)}</b></div>
        <div className="flex justify-between text-espresso-light">
          <span>Merchant commission</span><span>{fmt(commission)}</span>
        </div>
      </div>
      <span className="mt-2 inline-block w-fit rounded bg-crema px-2 py-0.5 text-xs">{product.methodLabel}</span>
      <button
        onClick={onPay}
        disabled={pending}
        className="mt-4 rounded bg-espresso text-crema py-2 font-medium disabled:opacity-50"
      >
        {pending ? 'Processing…' : 'Pay'}
      </button>
      {msg && <p className="mt-2 text-xs text-espresso-light">{msg}</p>}
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="mt-1 text-xs text-blue-700 underline break-all">
          {link}
        </a>
      )}
    </div>
  );
}

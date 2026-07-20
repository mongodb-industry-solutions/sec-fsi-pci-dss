// Products (C-13): 4 products, one per payment method; commission shown before confirm.
import { redirect } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import { PRODUCTS, computeCommission } from '@/config/products';
import { getSession } from '@/lib/session';
import ProductCard from './ProductCard';

export default async function ProductsPage() {
  const session = await getSession();
  if (!session) redirect('/');

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <ShoppingBag className="h-6 w-6 text-leaf-deep" aria-hidden /> Shop
      </h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        Every purchase pays via Securit4 Pay. We never see your card details.
      </p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCTS.map((p) => (
          <ProductCard key={p.id} product={p} commission={computeCommission(p.price)} />
        ))}
      </div>
    </div>
  );
}

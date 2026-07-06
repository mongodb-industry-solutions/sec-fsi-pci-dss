// Products (C-13): 4 products, one per payment method; commission shown before confirm.
import { redirect } from 'next/navigation';
import { PRODUCTS, computeCommission } from '@/config/products';
import { getSession } from '@/lib/session';
import ProductCard from './ProductCard';

export default async function ProductsPage() {
  const session = await getSession();
  if (!session) redirect('/');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Shop</h1>
      <p className="text-sm text-espresso-light mb-6">
        Every purchase pays via Leafy Pay. We never see your card details.
      </p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCTS.map((p) => (
          <ProductCard key={p.id} product={p} commission={computeCommission(p.price)} />
        ))}
      </div>
    </div>
  );
}
